import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, requestClientKey } from '@/lib/server/requestGuard';
import { isRecord } from '@/lib/validation';

// 服务端反查函数选择器 → 签名（openchain 签名数据库）。
// 放服务端：① 在国内 dev 下走 DEV_PROXY；② 避免浏览器跨域。
export async function GET(req: NextRequest) {
  const rateLimit = await checkRateLimit(
    `decode-sig:${requestClientKey(req.headers)}`,
    30,
    60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { signature: null, error: '请求过于频繁，请稍后重试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
          'X-TxRay-Guard': rateLimit.backend,
        },
      },
    );
  }

  const selector = req.nextUrl.searchParams.get('selector')?.toLowerCase();
  if (!selector || !/^0x[0-9a-f]{8}$/.test(selector)) {
    return NextResponse.json({ signature: null, error: '无效 selector' }, { status: 400 });
  }

  try {
    const url = `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}&filter=true`;
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`OpenChain HTTP ${res.status}`);
    const json: unknown = await res.json();
    const signature = readSignature(json, selector);
    return NextResponse.json(
      { signature },
      {
        headers: {
          'Cache-Control': signature
            ? 'public, max-age=86400, s-maxage=604800'
            : 'public, max-age=30, s-maxage=60',
          'X-TxRay-Guard': rateLimit.backend,
        },
      },
    );
  } catch (e) {
    // 反查失败不致命：解码器仍可只显示选择器
    console.error('[decode-sig] OpenChain lookup failed', {
      selector,
      message: e instanceof Error ? e.message : 'unknown error',
    });
    return NextResponse.json(
      { signature: null, error: '签名数据库暂时不可用' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function readSignature(value: unknown, selector: string): string | null {
  if (!isRecord(value) || value.ok === false || !isRecord(value.result) || !isRecord(value.result.function)) {
    throw new Error('Invalid OpenChain response');
  }
  const list = value.result.function[selector];
  if (list === undefined || list === null || (Array.isArray(list) && list.length === 0)) return null;
  const first = Array.isArray(list) ? list[0] : undefined;
  if (!isRecord(first) || typeof first.name !== 'string' || !first.name) {
    throw new Error('Invalid OpenChain signature result');
  }
  return first.name;
}
