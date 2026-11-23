import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import type { Approval } from './types';
import { getApprovalScope } from './approvalScope';
import type { SpenderRisk } from './useSpenderRisk';
import { selectApprovals, summarizeApprovals } from './viewOptions';

const token = '0x0000000000000000000000000000000000000001' as Address;
const known = '0x0000000000000000000000000000000000000002' as Address;
const unknown = '0x0000000000000000000000000000000000000003' as Address;
const malicious = '0x0000000000000000000000000000000000000004' as Address;

function approval(id: string, spender: Address, allowance: bigint, exposure?: string): Approval {
  return {
    kind: 'erc20', id, token, spender, symbol: id, decimals: 18,
    amountText: allowance.toString(), atRiskAmountText: exposure, allowance,
  };
}

function risk(level: SpenderRisk['level']): SpenderRisk {
  return {
    level, codeVerified: true, reason: '',
    threat: { status: 'unavailable', sourceName: '', sourceUrl: '', publicDelayDays: 0 },
  };
}

const approvals = [
  approval('known', known, 100n, '100'),
  approval('unknown', unknown, 100n),
  approval('malicious', malicious, 2n ** 256n - 1n, '1'),
];
const risks = {
  [known.toLowerCase()]: risk('known'),
  [unknown.toLowerCase()]: risk('unknown'),
  [malicious.toLowerCase()]: risk('malicious'),
};

describe('approval view options', () => {
  it('shows uncertain and unlimited approvals in the attention filter', () => {
    expect(selectApprovals(approvals, risks, undefined, 'attention', 'risk').map((a) => a.id))
      .toEqual(['malicious', 'unknown']);
    expect(selectApprovals(approvals, undefined, undefined, 'attention', 'risk'))
      .toHaveLength(3);
  });

  it('sorts priced exposure first without treating missing prices as zero risk', () => {
    expect(selectApprovals(approvals, risks, { [token.toLowerCase()]: 2 }, 'all', 'exposure')
      .map((a) => a.id)).toEqual(['known', 'malicious', 'unknown']);
  });

  it('does not mutate the fetched approval order', () => {
    selectApprovals(approvals, risks, undefined, 'all', 'risk');
    expect(approvals.map((a) => a.id)).toEqual(['known', 'unknown', 'malicious']);
  });

  it('keeps a single NFT out of the broad approvals filter', () => {
    const single: Approval = {
      kind: 'nft-token', id: 'single', token, spender: known,
      symbol: 'NFT', tokenId: '7',
    };
    expect(selectApprovals([single], risks, undefined, 'broad', 'risk')).toEqual([]);
    expect(selectApprovals([single], risks, undefined, 'all', 'risk')).toEqual([single]);
  });

  it('distinguishes very large finite allowances from type maximums', () => {
    const veryLarge = approval('large', known, 2n ** 256n - 2n);
    expect(getApprovalScope(veryLarge)).toBe('large');
    expect(getApprovalScope(approvals[2])).toBe('max');
    expect(selectApprovals([veryLarge], risks, undefined, 'broad', 'risk')).toEqual([veryLarge]);
  });

  it('summarizes attention, broad scope, high-risk spenders, and priced vs unpriced exposure', () => {
    const token2 = '0x0000000000000000000000000000000000000009' as Address;
    const mixed: Approval[] = [
      ...approvals,
      {
        kind: 'permit2',
        id: 'permit2-priced',
        token: token2,
        spender: known,
        symbol: 'WETH',
        decimals: 18,
        amountText: '无限',
        amount: 2n ** 160n - 1n,
        expiration: 4102444800,
        atRiskAmountText: '1.5',
      },
      {
        kind: 'nft',
        id: 'nft-collection',
        token: token2,
        spender: unknown,
        symbol: 'BAYC',
      },
    ];

    const summary = summarizeApprovals(mixed, risks, {
      [token.toLowerCase()]: 2,
      [token2.toLowerCase()]: 2000,
    });

    expect(summary).toEqual({
      total: 5,
      attention: 4,
      broad: 3,
      highRiskSpender: 1,
      pricedExposureUsd: 3202,
      pricedCount: 3,
      unpricedCount: 1,
    });
  });
});
