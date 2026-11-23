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
  const fungibleTokens = uniqueTokens([...current.erc20, ...current.permit2]);
  const fungibleKeys = new Set(fungibleTokens.map((token) => token.toLowerCase()));
  const nftTokens = uniqueTokens([...current.nft, ...current.nftToken])
    .filter((token) => !fungibleKeys.has(token.toLowerCase()));
  const [metadata, balances, nftMetadata] = await Promise.all([
    runInChunks<Address, unknown>(
      fungibleTokens,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.flatMap((token) => [
            {
              address: token,
              abi: erc20Abi,
              functionName: 'symbol',
            } as const,
            {
              address: token,
              abi: erc20Abi,
              functionName: 'decimals',
            } as const,
          ]),
        }),
    ),
    runInChunks<Address, unknown>(
      fungibleTokens,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.map((token) => ({
            address: token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [owner],
          })),
        }),
    ),
    runInChunks<Address, unknown>(
      nftTokens,
      MULTICALL_CHUNK_SIZE,
      (chunk) =>
        client.multicall({
          allowFailure: true,
          contracts: chunk.map((token) => ({
            address: token,
            abi: erc721Abi,
            functionName: 'symbol' as const,
          })),
        }),
    ),
  ]);

  const fungibleData = new Map(fungibleTokens.map((token, index) => [token.toLowerCase(), {
    symbol: readSuccessResult(metadata[index * 2]),
    decimals: readSuccessResult(metadata[index * 2 + 1]),
    balance: readBigIntResult(balances[index]),
  }]));
  const nftSymbols = new Map(nftTokens.map((token, index) => [
    token.toLowerCase(), readSuccessResult(nftMetadata[index]),
  ]));
  const tokenData = [...fungibleData.values()];
  const failedDecimals = tokenData.filter((data) => data.decimals === undefined).length;
  const failedBalances = tokenData.filter((data) => data.balance === undefined).length;

  function readSymbol(token: Address): string {
    const key = token.toLowerCase();
    const result = fungibleData.get(key)?.symbol ?? nftSymbols.get(key);
    return result !== undefined ? String(result) : shortAddress(token);
  }

  function readDisplay(token: Address, rawAmount: bigint, upstream?: { allowance: bigint | undefined }): FungibleApprovalDisplay {
    const data = fungibleData.get(token.toLowerCase());
    const symbol = readSymbol(token);
    const balance = data?.balance;
    const decimalsResult = data?.decimals;
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

  const erc20: Erc20Approval[] = current.erc20.map((pair) => ({
    kind: 'erc20',
    id: pairKey(pair.token, pair.spender),
    token: pair.token,
    spender: pair.spender,
    allowance: pair.allowance,
    ...readDisplay(pair.token, pair.allowance),
  }));
  const permit2: Permit2Approval[] = current.permit2.map((pair) => ({
    kind: 'permit2',
    id: `p2-${pairKey(pair.token, pair.spender)}`,
    token: pair.token,
    spender: pair.spender,
    amount: pair.amount,
    expiration: pair.expiration,
    upstreamAllowance: current.permit2TokenAllowances[pair.token.toLowerCase()],
    ...readDisplay(pair.token, pair.amount, {
      allowance: current.permit2TokenAllowances[pair.token.toLowerCase()],
    }),
  }));
  const nft: NftApproval[] = current.nft.map((pair) => ({
    kind: 'nft',
    id: pairKey(pair.token, pair.spender),
    token: pair.token,
    spender: pair.spender,
    symbol: readSymbol(pair.token),
  }));
  const nftToken: NftTokenApproval[] = current.nftToken.map((pair) => ({
    kind: 'nft-token',
    id: `nft-token-${pairKey(pair.token, pair.spender)}-${pair.tokenId}`,
    token: pair.token,
    spender: pair.spender,
    tokenId: pair.tokenId,
    symbol: readSymbol(pair.token),
  }));

  return {
    approvals: [...erc20, ...permit2, ...nft, ...nftToken].sort(
      (left, right) => Number(hasBroadApproval(right)) - Number(hasBroadApproval(left)),
    ),
    failedDecimals,
    failedBalances,
  };
}

function uniqueTokens(pairs: readonly { token: Address }[]): Address[] {
  return [...new Map(pairs.map(({ token }) => [token.toLowerCase(), token])).values()];
}

const pairKey = (token: Address, spender: Address) =>
  `${token.toLowerCase()}-${spender.toLowerCase()}`;

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
