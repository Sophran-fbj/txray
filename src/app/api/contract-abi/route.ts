import { NextResponse, type NextRequest } from 'next/server';
import { getAddress, isAddress, type AbiFunction, type Address } from 'viem';
import { isSupportedTxRayChain } from '@/features/txray/chains/chains';
import { parseVerifiedFunctions } from '@/features/txray/decoder/verifiedAbi';
import { checkRateLimit, requestClientKey, scheduleExternalRequest } from '@/lib/server/requestGuard';
import { isRecord } from '@/lib/validation';

const MAX_ABI_CHARS = 512_000;
const UNVERIFIED_PATTERN = /source code not verified|contract not verified/i;

function parseAbiText(raw: unknown): { functions?: AbiFunction[]; unverified?: boolean } {
  if (typeof raw !== 'string' || raw.length > MAX_ABI_CHARS) return {};
  if (UNVERIFIED_PATTERN.test(raw)) return { unverified: true };
  try {
    const functions = parseVerifiedFunctions(JSON.parse(raw));
    return functions ? { functions } : {};
  } catch {
    return {};
  }
}

async function fetchImplementationAbi(
  chainId: number,
  implementation: Address,
  apiKey: string,
  requestSignal: AbortSignal,
): Promise<AbiFunction[] | undefined> {
  try {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.search = new URLSearchParams({
      chainid: String(chainId),
      module: 'contract',
      action: 'getabi',
      address: implementation,
      apikey: apiKey,
    }).toString();
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(4_000)]);
    const response = await scheduleExternalRequest(() => fetch(url, { cache: 'no-store', signal }));
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.status !== '1') return undefined;
    return parseAbiText(payload.result).functions;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const chainId = Number(searchParams.get('chainId') ?? '1');
  const rawAddress = searchParams.get('address');
  if (!isSupportedTxRayChain(chainId) || !rawAddress || !isAddress(rawAddress)) {
    return NextResponse.json({ status: 'unavailable' }, { status: 400 });
  }
  const address = getAddress(rawAddress);

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return NextResponse.json({ status: 'unavailable' }, { status: 503 });

  const rate = await checkRateLimit(`contract-abi:${requestClientKey(request.headers)}`, 30, 60_000);
  const guardHeaders = { 'X-TxRay-Guard': rate.backend };
  if (!rate.allowed) {
    return NextResponse.json({ status: 'unavailable' }, {
      status: 429,
      headers: { ...guardHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
    });
  }

  try {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.search = new URLSearchParams({
      chainid: String(chainId),
      module: 'contract',
      action: 'getsourcecode',
      address,
      apikey: apiKey,
    }).toString();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(4_000)]);
    const response = await scheduleExternalRequest(() => fetch(url, { cache: 'no-store', signal }));
    if (response.ok) {
      const payload: unknown = await response.json();
      if (isRecord(payload)) {
        if (typeof payload.result === 'string' && UNVERIFIED_PATTERN.test(payload.result)) {
          return NextResponse.json({ status: 'unverified' }, {
            headers: { ...guardHeaders, 'Cache-Control': 'public, max-age=60, s-maxage=300' },
          });
        }

        if (Array.isArray(payload.result) && isRecord(payload.result[0])) {
          const entry = payload.result[0];
          const direct = parseAbiText(entry.ABI);
          const isProxy = entry.Proxy === '1' || entry.Proxy === 1 || entry.Proxy === true;
          const rawImpl = typeof entry.Implementation === 'string' ? entry.Implementation.trim() : '';
          const implAddress = isProxy && isAddress(rawImpl) ? getAddress(rawImpl) : undefined;
          const distinctImpl =
            implAddress && implAddress.toLowerCase() !== address.toLowerCase()
              ? implAddress
              : undefined;

          const implFunctions = distinctImpl
            ? await fetchImplementationAbi(chainId, distinctImpl, apiKey, request.signal)
            : undefined;

          if (direct.functions || implFunctions) {
            return NextResponse.json(
              {
                status: 'verified',
                functions: direct.functions ?? [],
                ...(implFunctions && distinctImpl
                  ? { implementation: { address: distinctImpl, functions: implFunctions } }
                  : {}),
              },
              { headers: { ...guardHeaders, 'Cache-Control': 'public, max-age=300, s-maxage=3600' } },
            );
          }

          if (direct.unverified) {
            return NextResponse.json({ status: 'unverified' }, {
              headers: { ...guardHeaders, 'Cache-Control': 'public, max-age=60, s-maxage=300' },
            });
          }
        }
      }
    }
  } catch {
    // Keep explorer failures independent from selector-based decoding.
  }

  return NextResponse.json({ status: 'unavailable' }, { status: 502, headers: guardHeaders });
}
