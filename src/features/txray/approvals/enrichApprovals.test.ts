import { describe, expect, it, vi } from 'vitest';
import { getAddress, type Address, type PublicClient } from 'viem';
import { enrichApprovals, spendablePermit2Amount } from './enrichApprovals';
import type { CurrentApprovalState } from './readCurrentApprovalState';

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

describe('approval metadata reads', () => {
  const owner = '0x0000000000000000000000000000000000000001';
  const firstSpender = '0x0000000000000000000000000000000000000002';
  const secondSpender = '0x0000000000000000000000000000000000000003';
  const token = getAddress('0x000000000000000000000000000000000000dead');
  const lowercaseToken = token.toLowerCase() as Address;
  const collection = '0x0000000000000000000000000000000000000005';
  const current: CurrentApprovalState = {
    erc20: [
      { token, spender: firstSpender, allowance: 20n },
      { token, spender: secondSpender, allowance: 50n },
    ],
    permit2: [{ token: lowercaseToken, spender: firstSpender, amount: 100n, expiration: 4102444800 }],
    permit2TokenAllowances: { [lowercaseToken]: 25n },
    nft: [{ token: collection, spender: firstSpender }],
    nftToken: [{ token: collection, spender: secondSpender, tokenId: '7' }],
    failedReads: 0,
  };

  it('reads metadata and balances once per token while preserving row-specific exposure', async () => {
    const multicall = vi.fn(async ({ contracts }: { contracts: { address: Address; functionName: string }[] }) =>
      contracts.map(({ address, functionName }) => ({ status: 'success', result:
        functionName === 'symbol' ? (address === collection ? 'NFT' : 'COIN') :
          functionName === 'decimals' ? 1 : 30n,
      })),
    );
    const result = await enrichApprovals({ multicall } as unknown as PublicClient, owner, current);
    const reads = multicall.mock.calls.flatMap(([{ contracts }]) => contracts.map(
      ({ address, functionName }) => `${address.toLowerCase()}:${functionName}`,
    ));
    expect(reads.sort()).toEqual([
      `${lowercaseToken}:symbol`, `${lowercaseToken}:decimals`, `${lowercaseToken}:balanceOf`, `${collection}:symbol`,
    ].sort());
    expect(result.approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'erc20', spender: firstSpender, symbol: 'COIN', atRiskAmountText: '2' }),
      expect.objectContaining({ kind: 'erc20', spender: secondSpender, symbol: 'COIN', atRiskAmountText: '3' }),
      expect.objectContaining({ kind: 'permit2', symbol: 'COIN', atRiskAmountText: '2.5' }),
      expect.objectContaining({ kind: 'nft', symbol: 'NFT' }),
      expect.objectContaining({ kind: 'nft-token', symbol: 'NFT' }),
    ]));
  });

  it('counts a failed token read once and keeps exposures unknown for all affected approvals', async () => {
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({ status: 'failure' })),
    );
    const result = await enrichApprovals({ multicall } as unknown as PublicClient, owner, current);
    expect(result.failedDecimals).toBe(1);
    expect(result.failedBalances).toBe(1);
    const fungible = result.approvals.filter((approval) => approval.kind === 'erc20' || approval.kind === 'permit2');
    expect(fungible).toHaveLength(3);
    expect(fungible.every((approval) => approval.decimals === null && approval.atRiskAmountText === undefined)).toBe(true);
  });
});
