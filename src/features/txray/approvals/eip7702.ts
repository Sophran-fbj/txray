import { getAddress, type Address } from 'viem';

// EIP-7702 delegation designator prefix: 0xef0100 || 20-byte implementation address (23 bytes total).
export const EIP7702_PREFIX = '0xef0100';
const EIP7702_DESIGNATOR_HEX_LENGTH = 48;

export type AccountCodeInspection =
  | { status: 'eoa' }
  | { status: 'contract'; byteLength: number }
  | { status: 'delegated'; delegate: Address }
  | { status: 'unavailable' };

export function parseAccountCode(code: string | undefined): AccountCodeInspection {
  if (code === undefined || code === '0x') {
    return { status: 'eoa' };
  }
  if (!/^0x[0-9a-fA-F]*$/.test(code) || (code.length - 2) % 2 !== 0) {
    return { status: 'unavailable' };
  }
  const lower = code.toLowerCase();
  if (lower.startsWith(EIP7702_PREFIX) && lower.length === EIP7702_DESIGNATOR_HEX_LENGTH) {
    return {
      status: 'delegated',
      delegate: getAddress(`0x${lower.slice(8)}`),
    };
  }
  return {
    status: 'contract',
    byteLength: (lower.length - 2) / 2,
  };
}
