import { NextResponse, type NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { isSupportedTxRayChain } from '@/features/txray/chains/chains';
import { parseVerifiedFunctions } from '@/features/txray/decoder/verifiedAbi';
import { checkRateLimit, requestClientKey, scheduleExternalRequest } from '@/lib/server/requestGuard';
import { isRecord } from '@/lib/validation';

const MAX_ABI_CHARS = 512_000;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const chainId = Number(searchParams.get('chainId') ?? '1');
  const address = searchParams.get('address');
  if (!isSupportedTxRayChain(chainId) || !address || !isAddress(address)) {
    return NextResponse.json({ status: 'unavailable' }, { status: 400 });
  }

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return NextResponse.json({ status: 'unavailable' }, { status: 503 });

  const rate = await checkRateLimit(`contract-abi:${requestClientKey(request.headers)}`, 30, 60_000);
  const guardHeaders = { 'X-TxRay-Guard': rate.backend };
  if (!rate.allowed) {
    return NextResponse.json({ status: 'unavailable' }, {
      status: 429, headers: { ...guardHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
    });
  }

  try {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.search = new URLSearchParams({
      chainid: String(chainId), module: 'contract', action: 'getabi', address: getAddress(address), apikey: apiKey,
    }).toString();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(4_000)]);
    const response = await scheduleExternalRequest(() => fetch(url, { cache: 'no-store', signal }));
    if (response.ok) {
      const result: unknown = await response.json();
      if (isRecord(result) && typeof result.result === 'string' && result.result.length <= MAX_ABI_CHARS) {
        if (result.status === '1') {
          const functions = parseVerifiedFunctions(JSON.parse(result.result));
          if (functions) return NextResponse.json({ status: 'verified', functions }, {
            headers: { ...guardHeaders, 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
          });
        } else if (/source code not verified|contract not verified/i.test(result.result)) {
          return NextResponse.json({ status: 'unverified' }, {
            headers: { ...guardHeaders, 'Cache-Control': 'public, max-age=60, s-maxage=300' },
          });
        }
      }
    }
  } catch {
    // Keep explorer failures independent from selector-based decoding.
  }

  return NextResponse.json({ status: 'unavailable' }, { status: 502, headers: guardHeaders });
}
