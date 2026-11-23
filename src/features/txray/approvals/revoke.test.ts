import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, custom, encodeAbiParameters, getAddress, zeroAddress, type PublicClient } from 'viem';
import { PERMIT2_ADDRESS } from './permit2';
import { createRevokeCall, isApprovalCleared, simulateRevoke } from './revoke';
import type { Approval } from './useApprovals';

const token = getAddress('0x0000000000000000000000000000000000000001');
const spender = getAddress('0x0000000000000000000000000000000000000002');

describe('simulateRevoke', () => {
  const owner = getAddress('0x0000000000000000000000000000000000000003');
  const call = createRevokeCall({ kind: 'erc20', id: 'erc20', token, spender, allowance: 1n,
    symbol: 'TKN', decimals: 18, amountText: '1' });

  it('accepts an empty successful approve result from a deployed ERC-20 without re-simulating', async () => {
    const request = vi.fn(({ method }: { method: string }) => Promise.resolve(method === 'eth_call' ? '0x' : '0x6000'));
    const client = createPublicClient({ transport: custom({ request }) });
    await expect(simulateRevoke(client, owner, call)).resolves.toMatchObject({
      account: owner, address: token, functionName: 'approve', args: [spender, 0n],
      abi: [{ outputs: [] }],
    });
    expect(request.mock.calls.map(([{ method }]) => method)).toEqual(['eth_call', 'eth_getCode']);
  });

  it('rejects empty output from an address without code', async () => {
    const client = createPublicClient({ transport: custom({ request: async () => '0x' }) });
    await expect(simulateRevoke(client, owner, call)).rejects.toThrow();
  });

  it('preserves ERC-20 false results and revert errors', async () => {
    const request = vi.fn().mockResolvedValueOnce(encodeAbiParameters([{ type: 'bool' }], [false]))
      .mockRejectedValueOnce(Object.assign(new Error('execution reverted'), { code: 3 }));
    const client = createPublicClient({ transport: custom({ request }, { retryCount: 0 }) });
    await expect(simulateRevoke(client, owner, call)).rejects.toThrow('合约拒绝清除授权');
    await expect(simulateRevoke(client, owner, call)).rejects.toThrow(/revert/i);
    expect(request.mock.calls.map(([{ method }]) => method)).toEqual(['eth_call', 'eth_call']);
  });
});

describe('createRevokeCall', () => {
  it('builds an ERC-20 zero approval', () => {
    const approval: Approval = {
      kind: 'erc20', id: 'erc20', token, spender, allowance: 1n,
      symbol: 'TKN', decimals: 18, amountText: '1',
    };
    const call = createRevokeCall(approval);
    expect(call).toMatchObject({
      kind: 'erc20', address: token, functionName: 'approve', args: [spender, 0n],
    });
  });

  it('builds an NFT operator revoke', () => {
    const approval: Approval = {
      kind: 'nft', id: 'nft', token, spender, symbol: 'NFT',
    };
    const call = createRevokeCall(approval);
    expect(call).toMatchObject({
      kind: 'nft', address: token, functionName: 'setApprovalForAll',
      args: [spender, false],
    });
  });

  it('revokes a single ERC-721 token without revoking collection operators', () => {
    const approval: Approval = {
      kind: 'nft-token', id: 'nft-token', token, spender, symbol: 'NFT', tokenId: '7',
    };
    expect(createRevokeCall(approval)).toMatchObject({
      kind: 'nft-token', address: token, functionName: 'approve',
      args: [zeroAddress, 7n],
    });
  });

  it('builds a Permit2 zero allowance with zero expiration', () => {
    const approval: Approval = {
      kind: 'permit2', id: 'permit2', token, spender, amount: 1n,
      expiration: 1, symbol: 'TKN', decimals: 18,
      amountText: '1',
    };
    const call = createRevokeCall(approval);
    expect(call).toMatchObject({
      kind: 'permit2', address: PERMIT2_ADDRESS, functionName: 'approve',
      args: [token, spender, 0n, 0],
    });
  });
});

describe('isApprovalCleared', () => {
  const owner = getAddress('0x0000000000000000000000000000000000000003');
  const base = { token, spender, id: 'test', symbol: 'TKN' };
  const fungible = { ...base, decimals: 18, amountText: '1' };
  const cases = [
    { approval: { ...fungible, kind: 'erc20', allowance: 1n }, target: token, fn: 'allowance', args: [owner, spender], active: 1n, cleared: 0n },
    { approval: { ...base, kind: 'nft' }, target: token, fn: 'isApprovedForAll', args: [owner, spender], active: true, cleared: false },
    { approval: { ...base, kind: 'nft-token', tokenId: '7' }, target: token, fn: 'getApproved', args: [7n], active: spender, cleared: zeroAddress },
    { approval: { ...fungible, kind: 'permit2', amount: 1n, expiration: 1 }, target: PERMIT2_ADDRESS, fn: 'allowance', args: [owner, token, spender], active: [1n, 0, 1], cleared: [0n, 0, 1] },
  ] as const;

  it.each(cases)('verifies $approval.kind at the receipt block', async ({ approval, target, fn, args, active, cleared }) => {
    const readContract = vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(cleared);
    const client = { readContract } as unknown as PublicClient;
    await expect(isApprovalCleared(client, owner, approval, 42n)).resolves.toBe(false);
    await expect(isApprovalCleared(client, owner, approval, 42n)).resolves.toBe(true);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: target, functionName: fn, args, blockNumber: 42n }));
  });
});
