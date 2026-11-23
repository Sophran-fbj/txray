import { BaseError, ContractFunctionRevertedError, erc20Abi, erc721Abi, getAddress, isAddress, parseAbiItem, zeroAddress, type Address, type PublicClient } from 'viem';
import { runInChunks } from '@/lib/web3/runInChunks';
import { isRecord } from '@/lib/validation';
import type { ApprovalIndexPayload, ApprovalPair, NftTokenIndex } from './approvalIndex';
import { PERMIT2_ADDRESS, permit2Abi } from './permit2';
import {
  readBigIntResult,
  readBooleanResult,
  readPermit2Result,
  readSuccessResult,
} from './multicallResults';

const MULTICALL_CHUNK_SIZE = 100;
const nftOwnerAbi = [...erc721Abi, parseAbiItem('error ERC721NonexistentToken(uint256 tokenId)')] as const;
const isAddressResult = (value: unknown): value is Address =>
  typeof value === 'string' && isAddress(value);

function isMissingNft(result: unknown, tokenId: string): boolean {
  if (!isRecord(result) || result.status !== 'failure' || !(result.error instanceof BaseError)) return false;
  const reverted = result.error.walk((error) => error instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError &&
    reverted.data?.errorName === 'ERC721NonexistentToken' && reverted.data.args?.[0] === BigInt(tokenId);
}

export interface LiveErc20Approval extends ApprovalPair {
  allowance: bigint;
}

export interface LivePermit2Approval extends ApprovalPair {
  amount: bigint;
  expiration: number;
}

export interface LiveNftTokenApproval extends NftTokenIndex {
  spender: Address;
}

export interface CurrentApprovalState {
  erc20: LiveErc20Approval[];
  nft: ApprovalPair[];
  nftToken: LiveNftTokenApproval[];
  permit2: LivePermit2Approval[];
  permit2TokenAllowances: Record<string, bigint | undefined>;
  failedReads: number;
}

export async function readCurrentApprovalState(
  client: PublicClient,
  owner: Address,
  index: ApprovalIndexPayload,
): Promise<CurrentApprovalState> {
  const [allowances, nftApproved, nftTokenState, permit2Allowances] = await Promise.all([
    runInChunks<ApprovalPair, unknown>(index.erc20, MULTICALL_CHUNK_SIZE, (chunk) =>
      client.multicall({
        allowFailure: true,
        contracts: chunk.map((pair) => ({
          address: pair.token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, pair.spender],
        })),
      }),
    ),
    runInChunks<ApprovalPair, unknown>(index.nft, MULTICALL_CHUNK_SIZE, (chunk) =>
      client.multicall({
        allowFailure: true,
        contracts: chunk.map((pair) => ({
          address: pair.token,
          abi: erc721Abi,
          functionName: 'isApprovedForAll',
          args: [owner, pair.spender],
        })),
      }),
    ),
    runInChunks<NftTokenIndex, unknown>(index.nftToken, MULTICALL_CHUNK_SIZE, (chunk) =>
      client.multicall({
        allowFailure: true,
        contracts: chunk.flatMap((item) => [
          {
            address: item.token,
            abi: nftOwnerAbi,
            functionName: 'ownerOf' as const,
            args: [BigInt(item.tokenId)] as const,
          },
          {
            address: item.token,
            abi: erc721Abi,
            functionName: 'getApproved' as const,
            args: [BigInt(item.tokenId)] as const,
          },
        ]),
      }),
    ),
    runInChunks<ApprovalPair, unknown>(
      index.permit2,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.map((pair) => ({
            address: PERMIT2_ADDRESS,
            abi: permit2Abi,
            functionName: 'allowance',
            args: [owner, pair.token, pair.spender],
          })),
        }),
    ),
  ]);

  let failedReads =
    allowances.filter((result) => readBigIntResult(result) === undefined).length +
    nftApproved.filter((result) => readBooleanResult(result) === undefined).length +
    permit2Allowances.filter((result) => readPermit2Result(result) === undefined)
      .length;

  const erc20 = index.erc20.flatMap((pair, itemIndex) => {
    const allowance = readBigIntResult(allowances[itemIndex]);
    return allowance !== undefined && allowance > 0n ? [{ ...pair, allowance }] : [];
  });
  const nft = index.nft.filter(
    (_, itemIndex) => readBooleanResult(nftApproved[itemIndex]) === true,
  );
  const nftToken = index.nftToken.flatMap((item, itemIndex) => {
    const ownerResult = nftTokenState[itemIndex * 2];
    if (isMissingNft(ownerResult, item.tokenId)) return [];
    const currentOwner = readSuccessResult(ownerResult);
    if (!isAddressResult(currentOwner)) {
      failedReads += 1;
      return [];
    }
    if (currentOwner.toLowerCase() !== owner.toLowerCase()) return [];

    const approved = readSuccessResult(nftTokenState[itemIndex * 2 + 1]);
    if (!isAddressResult(approved)) {
      failedReads += 1;
      return [];
    }
    if (approved.toLowerCase() === zeroAddress) return [];
    return [{ ...item, spender: getAddress(approved) }];
  });
  const now = Math.floor(Date.now() / 1000);
  const permit2 = index.permit2.flatMap((pair, itemIndex) => {
    const result = readPermit2Result(permit2Allowances[itemIndex]);
    if (!result) return [];
    const [amount, expiration] = result;
    return amount > 0n && Number(expiration) > now
      ? [{ ...pair, amount, expiration: Number(expiration) }]
      : [];
  });

  const permit2Tokens = [...new Set(permit2.map((item) => item.token.toLowerCase()))]
    .map((token) => getAddress(token));
  const upstreamResults = await runInChunks<Address, unknown>(
    permit2Tokens,
    MULTICALL_CHUNK_SIZE,
    (chunk) => client.multicall({
      allowFailure: true,
      contracts: chunk.map((token) => ({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, PERMIT2_ADDRESS],
      })),
    }),
  );
  const permit2TokenAllowances: Record<string, bigint | undefined> = {};
  permit2Tokens.forEach((token, index) => {
    const allowance = readBigIntResult(upstreamResults[index]);
    permit2TokenAllowances[token.toLowerCase()] = allowance;
    if (allowance === undefined) failedReads += 1;
  });

  return { erc20, nft, nftToken, permit2, permit2TokenAllowances, failedReads };
}
