import {
  erc20Abi,
  erc721Abi,
  formatUnits,
  type Address,
  type PublicClient,
} from 'viem';
import { runInChunks } from '@/lib/web3/runInChunks';
import { hasBroadApproval } from './approvalScope';
import {
  readBigIntResult,
  readSuccessResult,
} from './multicallResults';
import type { CurrentApprovalState } from './readCurrentApprovalState';
import type {
  Approval,
  Erc20Approval,
  FungibleApprovalDisplay,
  NftApproval,
  NftTokenApproval,
  Permit2Approval,
} from './types';

const MULTICALL_CHUNK_SIZE = 100;

export function spendablePermit2Amount(
  internal: bigint,
  balance: bigint | undefined,
  upstream: bigint | undefined,
): bigint | undefined {
  if (balance === undefined || upstream === undefined) return undefined;
  return [internal, balance, upstream].reduce((low, value) => value < low ? value : low);
}

export interface EnrichedApprovals {
  approvals: Approval[];
  failedDecimals: number;
  failedBalances: number;
}

export async function enrichApprovals(
  client: PublicClient,
  owner: Address,
  current: CurrentApprovalState,
): Promise<EnrichedApprovals> {
  const fungible = [...current.erc20, ...current.permit2];
  const allNft = [...current.nft, ...current.nftToken];
  const [metadata, balances, nftMetadata] = await Promise.all([
    runInChunks<(typeof fungible)[number], unknown>(
      fungible,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.flatMap((pair) => [
            {
              address: pair.token,
              abi: erc20Abi,
              functionName: 'symbol',
            } as const,
            {
              address: pair.token,
              abi: erc20Abi,
              functionName: 'decimals',
            } as const,
          ]),
        }),
    ),
    runInChunks<(typeof fungible)[number], unknown>(
      fungible,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.map((pair) => ({
            address: pair.token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [owner],
          })),
        }),
    ),
    runInChunks<(typeof allNft)[number], unknown>(
      allNft,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.map((pair) => ({
            address: pair.token,
            abi: erc721Abi,
            functionName: 'symbol' as const,
          })),
        }),
    ),
  ]);

  const failedDecimals = fungible.filter(
    (_, index) => readSuccessResult(metadata[index * 2 + 1]) === undefined,
  ).length;
  const failedBalances = balances.filter(
    (result) => readBigIntResult(result) === undefined,
  ).length;

  function readDisplay(index: number, rawAmount: bigint, upstream?: { allowance: bigint | undefined }): FungibleApprovalDisplay {
    const token = fungible[index].token;
    const symbolResult = readSuccessResult(metadata[index * 2]);
    const decimalsResult = readSuccessResult(metadata[index * 2 + 1]);
    const balance = readBigIntResult(balances[index]);
    const symbol =
      symbolResult !== undefined ? String(symbolResult) : shortAddress(token);
    const decimals = decimalsResult !== undefined ? Number(decimalsResult) : null;
    const amountText =
      decimals === null
        ? `${rawAmount.toString()} raw`
        : formatUnits(rawAmount, decimals);

    const atRiskAmountRaw = upstream
      ? spendablePermit2Amount(rawAmount, balance, upstream.allowance)
      : balance === undefined ? undefined : rawAmount < balance ? rawAmount : balance;
    if (atRiskAmountRaw === undefined) return { symbol, decimals, amountText };
    return {
      symbol,
      decimals,
      amountText,
      atRiskAmountRaw,
      atRiskAmountText:
        decimals === null
          ? `${atRiskAmountRaw.toString()} raw`
          : formatUnits(atRiskAmountRaw, decimals),
    };
  }

  const erc20: Erc20Approval[] = current.erc20.map((pair, index) => ({
    kind: 'erc20',
    id: pairKey(pair.token, pair.spender),
    token: pair.token,
    spender: pair.spender,
    allowance: pair.allowance,
    ...readDisplay(index, pair.allowance),
  }));
  const permit2: Permit2Approval[] = current.permit2.map((pair, index) => ({
    kind: 'permit2',
    id: `p2-${pairKey(pair.token, pair.spender)}`,
    token: pair.token,
    spender: pair.spender,
    amount: pair.amount,
    expiration: pair.expiration,
    upstreamAllowance: current.permit2TokenAllowances[pair.token.toLowerCase()],
    ...readDisplay(current.erc20.length + index, pair.amount, {
      allowance: current.permit2TokenAllowances[pair.token.toLowerCase()],
    }),
  }));
  const nft: NftApproval[] = current.nft.map((pair, index) => {
    const symbolResult = readSuccessResult(nftMetadata[index]);
    return {
      kind: 'nft',
      id: pairKey(pair.token, pair.spender),
      token: pair.token,
      spender: pair.spender,
      symbol:
        symbolResult !== undefined ? String(symbolResult) : shortAddress(pair.token),
    };
  });
  const nftToken: NftTokenApproval[] = current.nftToken.map((pair, index) => {
    const symbolResult = readSuccessResult(nftMetadata[current.nft.length + index]);
    return {
      kind: 'nft-token',
      id: `nft-token-${pairKey(pair.token, pair.spender)}-${pair.tokenId}`,
      token: pair.token,
      spender: pair.spender,
      tokenId: pair.tokenId,
      symbol: symbolResult !== undefined ? String(symbolResult) : shortAddress(pair.token),
    };
  });

  return {
    approvals: [...erc20, ...permit2, ...nft, ...nftToken].sort(
      (left, right) => Number(hasBroadApproval(right)) - Number(hasBroadApproval(left)),
    ),
    failedDecimals,
    failedBalances,
  };
}

const pairKey = (token: Address, spender: Address) =>
  `${token.toLowerCase()}-${spender.toLowerCase()}`;

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
