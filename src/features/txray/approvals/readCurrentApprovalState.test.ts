import { describe, expect, it, vi } from 'vitest';
import { ContractFunctionRevertedError, decodeFunctionResult, encodeErrorResult, encodeFunctionResult, getAddress, parseAbi, zeroAddress, type PublicClient } from 'viem';
import type { ApprovalIndexPayload } from './approvalIndex';
import { readCurrentApprovalState } from './readCurrentApprovalState';
import { PERMIT2_ADDRESS, permit2Abi } from './permit2';

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

  it('excludes a confirmed nonexistent token and keeps other reverts incomplete', async () => {
    const abi = parseAbi(['error ERC721NonexistentToken(uint256 tokenId)']);
    const data = encodeErrorResult({ abi, errorName: 'ERC721NonexistentToken', args: [7n] });
    const failure = { status: 'failure', error: new ContractFunctionRevertedError({ abi, data, functionName: 'ownerOf' }) };
    const unavailable = { status: 'failure', error: new Error('RPC unavailable') };
    const client = { multicall: vi.fn().mockResolvedValueOnce([failure, unavailable]).mockResolvedValueOnce([unavailable, unavailable]) } as unknown as PublicClient;
    await expect(readCurrentApprovalState(client, owner, index)).resolves.toMatchObject({ nftToken: [], failedReads: 0 });
    await expect(readCurrentApprovalState(client, owner, index)).resolves.toMatchObject({ nftToken: [], failedReads: 1 });
  });
});

describe('Permit2 underlying ERC-20 allowance', () => {
  it('reads the owner-to-Permit2 allowance for each active token', async () => {
    const abi = { abi: permit2Abi, functionName: 'allowance' } as const;
    const data = encodeFunctionResult({ ...abi, result: [100n, 4102444800, 0] });
    const multicall = vi.fn()
      .mockResolvedValueOnce([{ status: 'success', result: decodeFunctionResult({ ...abi, data }) }])
      .mockResolvedValueOnce([{ status: 'success', result: 3n }]);
    const client = { multicall } as unknown as PublicClient;
    const result = await readCurrentApprovalState(client, owner, {
      ...index, nftToken: [], permit2: [{ token, spender }],
    });

    expect(result.permit2TokenAllowances[token.toLowerCase()]).toBe(3n);
    expect(result.permit2).toEqual([{ token, spender, amount: 100n, expiration: 4102444800 }]);
    expect(result.failedReads).toBe(0);
    expect(multicall).toHaveBeenCalledTimes(2);
    expect(multicall.mock.calls[1][0].contracts[0]).toMatchObject({
      address: token, functionName: 'allowance', args: [owner, PERMIT2_ADDRESS],
    });
  });
});
