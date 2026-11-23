'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import {
  decodeFunctionData,
  parseAbiItem,
  toFunctionSignature,
  zeroAddress,
  type AbiFunction,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type Transaction,
} from 'viem';
import {
  KNOWN_SIGNATURES,
  type Danger,
  type KnownExplainKey,
} from './signatures';
import { isRecord } from '@/lib/validation';
import { classifyApprovalAmount, type ApprovalAmountScope } from '@/lib/web3/approvalAmount';
import { findLocalBuiltinAbis } from './call-tree/abis';
import {
  fetchVerifiedAbi,
  getApprovalInterface,
  matchVerifiedCall,
  type VerifiedAbiResult,
  type VerifiedCall,
} from './verifiedAbi';
export { isMaxUintValue } from '@/lib/web3/approvalAmount';

export interface DecodedParam {
  name?: string;
  type: string;
  value: string;
  isAddress: boolean;
  approvalAmountScope?: ApprovalAmountScope;
  ambiguousApprovalAmount?: boolean;
  isTokenId?: boolean;
}

export interface DecodedResult {
  source: 'calldata' | 'tx';
  signatureSource: 'verified' | 'local' | 'database' | 'unknown';
  abiStatus?: 'matched' | 'no-match' | 'unverified' | 'unavailable' | 'proxy-historical';
  verifiedCall?: VerifiedCall;
  to?: Address;
  selector: string;
  signature: string | null;
  functionName: string | null;
  params: DecodedParam[];
  danger: Danger;
  explainKey?: KnownExplainKey;
  raw: Hex;
  /** 交易 hash 来源时携带的主链币数量（calldata 输入时为 undefined）。 */
  txValue?: bigint | null;
}

type SignatureLookup = (selector: string) => Promise<string | null>;
export type DecoderInputMode = 'tx' | 'calldata';
export type DecoderTransaction = Pick<Transaction, 'hash' | 'from' | 'to' | 'input' | 'value' | 'blockNumber'>;

export class NoCalldataError extends Error {
  constructor() {
    super('这笔交易没有可解码的 calldata');
    this.name = 'NoCalldataError';
  }
}

export function isTxHash(value: string): value is Hash {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isCalldata(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{8,}$/.test(value) && (value.length - 2) % 2 === 0;
}

export function useDecoder(input: string, chainId = 1, mode?: DecoderInputMode, calldataTarget?: Address) {
  const client = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const value = input.trim();
  const fromHash = mode === 'tx' || (mode === undefined && isTxHash(value));
  const hash = fromHash && isTxHash(value) ? value : undefined;
  const transactionQuery = useQuery<DecoderTransaction>({
    queryKey: ['decode-transaction', chainId, hash?.toLowerCase()],
    enabled: Boolean(client && hash),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (!client || !hash) throw new Error('目标链 RPC 或交易哈希不可用');
      return client.getTransaction({ hash });
    },
  });

  const transaction = transactionQuery.data;
  const isHistoricalTx = fromHash ? transaction?.blockNumber != null : false;
  const calldata = fromHash ? transaction?.input : value;
  const target = fromHash ? transaction?.to ?? undefined : calldataTarget;
  const callQuery = useQuery<DecodedResult>({
    queryKey: ['decode', chainId, fromHash ? hash?.toLowerCase() : null, isHistoricalTx, calldata?.toLowerCase(), target?.toLowerCase()],
    enabled: calldata !== undefined && isCalldata(calldata) && (!fromHash || Boolean(transaction?.to)),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (!calldata || !isCalldata(calldata)) throw new Error('不是有效的 calldata');
      const contractAbi = target ? await queryClient.fetchQuery({
        queryKey: ['decoder-verified-abi', chainId, target.toLowerCase()],
        queryFn: ({ signal }) => fetchVerifiedAbi(chainId, target, signal),
        staleTime: (query) => query.state.data?.status === 'unavailable' ? 30_000 : 300_000,
        retry: false,
      }) : undefined;
      return decodeCalldata(calldata, fetchSignature, { transaction, target, contractAbi });
    },
  });

  return { transactionQuery, callQuery };
}

export async function decodeInput(
  client: PublicClient | undefined,
  value: string,
  lookupSignature: SignatureLookup = fetchSignature,
  mode?: DecoderInputMode,
): Promise<DecodedResult> {
  if (mode === 'tx' || (!mode && isTxHash(value))) {
    if (!isTxHash(value)) throw new Error('不是有效的交易哈希');
    if (!client) throw new Error('读取交易 hash 需要目标链 RPC');
    const transaction = await client.getTransaction({ hash: value });
    if (!transaction.input || transaction.input === '0x') {
      throw new NoCalldataError();
    }
    return decodeCalldata(transaction.input, lookupSignature, { transaction, target: transaction.to ?? undefined });
  }
  return decodeCalldata(value, lookupSignature);
}

export async function decodeCalldata(
  calldata: string,
  lookupSignature: SignatureLookup,
  context?: {
    transaction?: Pick<DecoderTransaction, 'value'> & Partial<Pick<DecoderTransaction, 'blockNumber'>>;
    target?: Address;
    contractAbi?: VerifiedAbiResult;
  },
): Promise<DecodedResult> {
  if (!isCalldata(calldata)) {
    throw new Error('不是有效的 calldata（应为 0x + 至少 4 字节方法选择器）');
  }

  const selector = calldata.slice(0, 10).toLowerCase();
  const local = KNOWN_SIGNATURES[selector];
  const isHistoricalTx = context?.transaction?.blockNumber != null;
  const verifiedMatch = matchVerifiedCall(context?.contractAbi, selector, {
    allowProxyImplementation: !isHistoricalTx,
  });
  const verifiedParams = verifiedMatch && decodeParams(verifiedMatch.abi, calldata);
  const verifiedCall: VerifiedCall | undefined =
    verifiedMatch && verifiedParams
      ? {
          abi: verifiedMatch.abi,
          approvalInterface: getApprovalInterface(verifiedMatch.abi, verifiedMatch.functions),
          viaProxyImplementation: verifiedMatch.viaProxyImplementation,
        }
      : undefined;

  let localBuiltinAbi: AbiFunction | undefined;
  let localBuiltinParams: DecodedParam[] | undefined;
  if (!verifiedCall && !local) {
    for (const candidate of findLocalBuiltinAbis(selector)) {
      const decoded = decodeParams(candidate, calldata);
      if (decoded) {
        localBuiltinAbi = candidate;
        localBuiltinParams = decoded;
        break;
      }
    }
  }

  const signature = verifiedCall
    ? toFunctionSignature(verifiedCall.abi)
    : local?.signature ??
      (localBuiltinAbi ? toFunctionSignature(localBuiltinAbi) : await lookupSignature(selector));
  const item = verifiedCall?.abi ?? localBuiltinAbi ?? parseFunctionSignature(signature);
  const decodedParams = verifiedParams ?? localBuiltinParams ?? (item && decodeParams(item, calldata));
  const params = decodedParams ?? [];
  const functionName = item && decodedParams ? item.name : null;
  const signatureSource = verifiedCall
    ? 'verified'
    : local || (localBuiltinAbi && localBuiltinParams)
      ? 'local'
      : signature
        ? 'database'
        : 'unknown';
  const abiStatus = verifiedCall
    ? 'matched'
    : isHistoricalTx &&
        context?.contractAbi?.status === 'verified' &&
        context.contractAbi.implementation
      ? 'proxy-historical'
      : context?.contractAbi?.status === 'verified'
        ? 'no-match'
        : context?.contractAbi?.status;
  const known = functionName && (!verifiedCall || !local || signature === toFunctionSignature(`function ${local.signature}`)) ? local : undefined;

  let danger: Danger = known?.danger ?? 'none';
  let explainKey: KnownExplainKey | undefined = known?.explainKey;
  if (known && selector === '0x095ea7b3') {
    const amount = params[1];
    const approvalInterface = verifiedCall?.approvalInterface;
    if (approvalInterface === 'erc721' && amount) {
      amount.isTokenId = true;
      const revoked = params[0]?.value.toLowerCase() === zeroAddress;
      danger = revoked ? 'none' : 'medium';
      explainKey = revoked ? 'nftTokenApprovalRevoked' : 'nftTokenApproval';
    } else if (amount) {
      setApprovalAmountScope(amount, approvalInterface === undefined);
      if (approvalInterface === 'erc20') explainKey = 'erc20Approval';
      if (amount.value === '0') {
        danger = approvalInterface === 'erc20' ? 'none' : 'medium';
        explainKey = approvalInterface === 'erc20' ? 'erc20ApprovalRevoked' : 'approveZeroAmbiguous';
      } else if (amount.approvalAmountScope === 'max') {
        danger = 'high';
      }
    }
  }
  if (known && selector === '0xd505accf') setApprovalAmountScope(params[2], false);
  if (known && selector === '0xa22cb465' && params[1]?.value === 'false') {
    danger = 'none';
    explainKey = 'approvalForAllRevoked';
  }

  return {
    source: context?.transaction ? 'tx' : 'calldata',
    to: context?.target,
    signatureSource,
    abiStatus,
    verifiedCall,
    selector,
    signature,
    functionName,
    params,
    danger,
    explainKey,
    raw: calldata,
    txValue: context?.transaction?.value,
  };
}

function parseFunctionSignature(signature: string | null): AbiFunction | undefined {
  if (!signature) return undefined;
  try {
    const item = parseAbiItem(`function ${signature}`);
    if (item.type === 'function') return item;
  } catch {
    // Unknown or ambiguous signature database entries still leave the raw calldata available.
  }
}

function decodeParams(item: AbiFunction, data: Hex): DecodedParam[] | undefined {
  try {
    const decoded = decodeFunctionData({ abi: [item], data });
    return item.inputs.map((input, index) => ({
      name: input.name,
      type: input.type,
      value: formatValue(decoded.args?.[index]),
      isAddress: input.type === 'address',
    }));
  } catch {
    return undefined;
  }
}

function setApprovalAmountScope(param: DecodedParam | undefined, ambiguous: boolean) {
  if (!param || !/^\d+$/.test(param.value)) return;
  param.approvalAmountScope = classifyApprovalAmount(BigInt(param.value), 256);
  param.ambiguousApprovalAmount = ambiguous;
}

async function fetchSignature(selector: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/decode-sig?selector=${selector}`);
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isRecord(value)) return null;
    return typeof value.signature === 'string' ? value.signature : null;
  } catch {
    return null;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return JSON.stringify(value, (_, nested) =>
      typeof nested === 'bigint' ? nested.toString() : nested,
    );
  }
  return String(value);
}
