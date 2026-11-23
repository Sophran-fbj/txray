import { erc20Abi, erc721Abi, zeroAddress, type Address, type PublicClient } from 'viem';
import type { Approval } from './useApprovals';
import { PERMIT2_ADDRESS, permit2Abi } from './permit2';

export type RevokeCall =
  | {
      kind: 'erc20';
      address: Address;
      abi: typeof erc20Abi;
      functionName: 'approve';
      args: readonly [Address, 0n];
    }
  | {
      kind: 'nft';
      address: Address;
      abi: typeof erc721Abi;
      functionName: 'setApprovalForAll';
      args: readonly [Address, false];
    }
  | {
      kind: 'nft-token';
      address: Address;
      abi: typeof erc721Abi;
      functionName: 'approve';
      args: readonly [Address, bigint];
    }
  | {
      kind: 'permit2';
      address: Address;
      abi: typeof permit2Abi;
      functionName: 'approve';
      args: readonly [Address, Address, 0n, 0];
    };

/** Builds the exact contract call that will be simulated and sent to the wallet. */
export function createRevokeCall(approval: Approval): RevokeCall {
  if (approval.kind === 'erc20') {
    return {
      kind: approval.kind,
      address: approval.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [approval.spender, 0n],
    };
  }

  if (approval.kind === 'nft') {
    return {
      kind: approval.kind,
      address: approval.token,
      abi: erc721Abi,
      functionName: 'setApprovalForAll',
      args: [approval.spender, false],
    };
  }

  if (approval.kind === 'nft-token') {
    return {
      kind: approval.kind,
      address: approval.token,
      abi: erc721Abi,
      functionName: 'approve',
      args: [zeroAddress, BigInt(approval.tokenId)],
    };
  }

  return {
    kind: approval.kind,
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: 'approve',
    args: [approval.token, approval.spender, 0n, 0],
  };
}

export async function isApprovalCleared(
  client: PublicClient,
  owner: Address,
  approval: Approval,
  blockNumber: bigint,
): Promise<boolean> {
  const { token, spender } = approval;
  switch (approval.kind) {
    case 'erc20': {
      const allowance = await client.readContract({
        address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender], blockNumber,
      });
      return allowance === 0n;
    }
    case 'nft': {
      const approved = await client.readContract({
        address: token, abi: erc721Abi, functionName: 'isApprovedForAll', args: [owner, spender], blockNumber,
      });
      return approved === false;
    }
    case 'nft-token': {
      const approved = await client.readContract({
        address: token, abi: erc721Abi, functionName: 'getApproved', args: [BigInt(approval.tokenId)], blockNumber,
      });
      return approved.toLowerCase() === zeroAddress;
    }
    case 'permit2': {
      const [amount] = await client.readContract({
        address: PERMIT2_ADDRESS, abi: permit2Abi, functionName: 'allowance', args: [owner, token, spender], blockNumber,
      });
      return amount === 0n;
    }
  }
}
