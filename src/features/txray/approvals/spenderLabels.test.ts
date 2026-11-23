import { describe, expect, it } from 'vitest';
import { getSpenderLabel } from './spenderLabels';

describe('spenderLabels', () => {
  it('resolves canonical CREATE2 spenders on all four supported chains', () => {
    const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    for (const chainId of [1, 8453, 42161, 10]) {
      expect(getSpenderLabel(permit2, chainId)).toEqual({
        name: 'Uniswap Permit2',
        trusted: true,
      });
    }
  });

  it('keeps chain-specific addresses isolated across networks', () => {
    const baseSwapRouter02 = '0x2626664c2603336e57b271c5c0b26f421741e481';
    expect(getSpenderLabel(baseSwapRouter02, 8453)?.name).toBe('Uniswap SwapRouter02');
    expect(getSpenderLabel(baseSwapRouter02, 1)).toBeUndefined();
    expect(getSpenderLabel(baseSwapRouter02, 42161)).toBeUndefined();
    expect(getSpenderLabel(baseSwapRouter02, 10)).toBeUndefined();

    const baseAavePool = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
    expect(getSpenderLabel(baseAavePool, 8453)?.name).toBe('Aave V3 Pool');
    expect(getSpenderLabel(baseAavePool, 1)).toBeUndefined();
  });

  it('returns undefined for unsupported chains', () => {
    expect(
      getSpenderLabel('0x000000000022D473030F116dDEE9F6B43aC78BA3', 999),
    ).toBeUndefined();
  });
});
