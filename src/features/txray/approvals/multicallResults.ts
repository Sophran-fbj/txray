import { isRecord } from '@/lib/validation';

export function readBigIntResult(result: unknown): bigint | undefined {
  if (!isRecord(result) || result.status !== 'success') return undefined;
  return typeof result.result === 'bigint' ? result.result : undefined;
}

export function readBooleanResult(result: unknown): boolean | undefined {
  if (!isRecord(result) || result.status !== 'success') return undefined;
  return typeof result.result === 'boolean' ? result.result : undefined;
}

export function readPermit2Result(
  result: unknown,
): readonly [bigint, bigint, bigint] | undefined {
  if (
    !isRecord(result) ||
    result.status !== 'success' ||
    !Array.isArray(result.result)
  ) {
    return undefined;
  }
  const [amount, rawExpiration, rawNonce] = result.result;
  const expiration = parseUint48(rawExpiration);
  const nonce = parseUint48(rawNonce);
  return typeof amount === 'bigint' && expiration !== undefined && nonce !== undefined
    ? [amount, expiration, nonce]
    : undefined;
}

function parseUint48(value: unknown): bigint | undefined {
  // viem represents small ABI integers such as uint48 as numbers.
  const integer = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;
  return typeof integer === 'bigint' && integer >= 0n && integer < 2n ** 48n ? integer : undefined;
}

export function readSuccessResult(result: unknown): unknown {
  if (!isRecord(result) || result.status !== 'success') return undefined;
  return result.result;
}
