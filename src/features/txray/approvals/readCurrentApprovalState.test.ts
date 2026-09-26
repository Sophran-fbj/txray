import { describe, expect, it, vi } from 'vitest';
import { getAddress, zeroAddress, type PublicClient } from 'viem';
import type { ApprovalIndexPayload } from './approvalIndex';
import { readCurrentApprovalState } from './readCurrentApprovalState';
import { PERMIT2_ADDRESS } from './permit2';

const owner = getAddress('0x0000000000000000000000000000000000000001');
const token = getAddress('0x0000000000000000000000000000000000000002');
const spender = getAddress('0x0000000000000000000000000000000000000003');
const index: ApprovalIndexPayload = {
  erc20: [], nft: [], nftToken: [{ token, tokenId: '7' }], permit2: [],
  coverage: { status: 'complete', truncatedSources: [], maxRecordsPerSource: 1000 },
};

function clientFor(currentOwner: string, approved: string): PublicClient {
  return { multicall: vi.fn().mockResolvedValue([
    { status: 'success', result: currentOwner },
    { status: 'success', result: approved },
  ]) } as unknown as PublicClient;
}

describe('current ERC-721 token approvals', () => {
  it('shows the current spender only while the token is still owned by the queried wallet', async () => {
    const result = await readCurrentApprovalState(clientFor(owner, spender), owner, index);
    expect(result.nftToken).toEqual([{ token, tokenId: '7', spender }]);
    expect(result.failedReads).toBe(0);
  });

  it('drops stale approvals after a transfer or revoke', async () => {
    expect((await readCurrentApprovalState(clientFor(spender, spender), owner, index)).nftToken).toEqual([]);
    expect((await readCurrentApprovalState(clientFor(owner, zeroAddress), owner, index)).nftToken).toEqual([]);
  });
});

describe('Permit2 underlying ERC-20 allowance', () => {
  it('reads the owner-to-Permit2 allowance for each active token', async () => {
    const multicall = vi.fn()
      .mockResolvedValueOnce([{ status: 'success', result: [100n, 4102444800n, 0n] }])
      .mockResolvedValueOnce([{ status: 'success', result: 3n }]);
    const client = { multicall } as unknown as PublicClient;
    const result = await readCurrentApprovalState(client, owner, {
      ...index, nftToken: [], permit2: [{ token, spender }],
    });

    expect(result.permit2TokenAllowances[token.toLowerCase()]).toBe(3n);
    expect(multicall).toHaveBeenCalledTimes(2);
    expect(multicall.mock.calls[1][0].contracts[0]).toMatchObject({
      address: token, functionName: 'allowance', args: [owner, PERMIT2_ADDRESS],
    });
  });
});
