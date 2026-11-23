export type ApprovalAmountScope = 'max' | 'large' | 'finite';

const UINT256_MAX = 2n ** 256n - 1n;
const UINT160_MAX = 2n ** 160n - 1n;
const LARGE_UINT256_ALLOWANCE = 2n ** 200n;
const LARGE_UINT160_ALLOWANCE = 2n ** 150n;

export function classifyApprovalAmount(amount: bigint, width: 160 | 256): ApprovalAmountScope {
  const maximum = width === 160 ? UINT160_MAX : UINT256_MAX;
  const large = width === 160 ? LARGE_UINT160_ALLOWANCE : LARGE_UINT256_ALLOWANCE;
  if (amount === maximum) return 'max';
  return amount > large && amount < maximum ? 'large' : 'finite';
}

export function isMaxUintValue(type: string, value: string): boolean {
  const match = /^uint(\d{0,3})$/.exec(type);
  if (!match || !/^\d+$/.test(value)) return false;
  const bits = match[1] ? Number(match[1]) : 256;
  if (bits < 8 || bits > 256 || bits % 8 !== 0) return false;
  return BigInt(value) === 2n ** BigInt(bits) - 1n;
}
