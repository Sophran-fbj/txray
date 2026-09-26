import { describe, expect, it } from 'vitest';
import { spendablePermit2Amount } from './enrichApprovals';

describe('Permit2 immediately spendable amount', () => {
  it('is limited by internal permission, token balance, and ERC-20 allowance to Permit2', () => {
    expect(spendablePermit2Amount(100n, 80n, 25n)).toBe(25n);
    expect(spendablePermit2Amount(10n, 80n, 25n)).toBe(10n);
    expect(spendablePermit2Amount(100n, 8n, 25n)).toBe(8n);
  });

  it('keeps zero separate from an unknown upstream read', () => {
    expect(spendablePermit2Amount(100n, 80n, 0n)).toBe(0n);
    expect(spendablePermit2Amount(100n, 80n, undefined)).toBeUndefined();
    expect(spendablePermit2Amount(100n, undefined, 25n)).toBeUndefined();
  });
});
