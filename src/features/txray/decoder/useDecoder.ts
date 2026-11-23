'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import {
  decodeFunctionData,
  parseAbiItem,
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
export { isMaxUintValue } from '@/lib/web3/approvalAmount';

export interface DecodedParam {
  name?: string;
  type: string;
  value: string;
  isAddress: boolean;
  approvalAmountScope?: ApprovalAmountScope;
}

export interface DecodedResult {
  source: 'calldata' | 'tx';
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

export function useDecoder(input: string, chainId = 1, mode?: DecoderInputMode) {
  const client = usePublicClient({ chainId });
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
  const calldata = fromHash ? transaction?.input : value;
  const callQuery = useQuery<DecodedResult>({
    queryKey: ['decode', chainId, fromHash ? hash?.toLowerCase() : null, calldata?.toLowerCase()],
    enabled: calldata !== undefined && isCalldata(calldata) && (!fromHash || Boolean(transaction?.to)),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (!calldata || !isCalldata(calldata)) throw new Error('不是有效的 calldata');
      return transaction
        ? decodeCalldata(calldata, fetchSignature, transaction)
        : decodeInput(undefined, calldata, fetchSignature, 'calldata');
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
    return decodeCalldata(transaction.input, lookupSignature, transaction);
  }
  return decodeCalldata(value, lookupSignature);
}

async function decodeCalldata(
  calldata: string,
  lookupSignature: SignatureLookup,
  transaction?: Pick<DecoderTransaction, 'to' | 'value'>,
): Promise<DecodedResult> {
  if (!isCalldata(calldata)) {
    throw new Error('不是有效的 calldata（应为 0x + 至少 4 字节方法选择器）');
  }

  const selector = calldata.slice(0, 10).toLowerCase();
  const known = KNOWN_SIGNATURES[selector];
  const signature = known?.signature ?? (await lookupSignature(selector));

  let params: DecodedParam[] = [];
  let functionName: string | null = null;
  if (signature) {
    try {
      const item = parseAbiItem(`function ${signature}`);
      if (item.type === 'function') {
        const decoded = decodeFunctionData({ abi: [item], data: calldata });
        functionName = item.name;
        const args = decoded.args ?? [];
        params = item.inputs.map((input, index) => ({
          name: input.name,
          type: input.type,
          value: formatValue(args[index]),
          isAddress: input.type === 'address',
        }));
      }
    } catch {
      // A signature database match can be ambiguous; preserve the signature and raw data.
    }
  }

  let danger: Danger = functionName ? known?.danger ?? 'none' : 'none';
  let explainKey: KnownExplainKey | undefined = functionName ? known?.explainKey : undefined;
  const approvalAmount = functionName && (selector === '0x095ea7b3' ? params[1] : selector === '0xd505accf' ? params[2] : undefined);
  if (approvalAmount && /^\d+$/.test(approvalAmount.value)) {
    approvalAmount.approvalAmountScope = classifyApprovalAmount(BigInt(approvalAmount.value), 256);
  }
  if (functionName && selector === '0x095ea7b3') {
    // approve(address,uint256) is shared by ERC-20 and ERC-721. Without a
    // verified target ABI, zero can mean ERC-20 revocation or NFT tokenId 0.
    if (params[1]?.value === '0') {
      danger = 'medium';
      explainKey = 'approveZeroAmbiguous';
    } else if (params[1]?.approvalAmountScope === 'max') {
      danger = 'high';
    }
  }
  if (functionName && selector === '0xa22cb465' && params[1]?.value === 'false') {
    danger = 'none';
    explainKey = 'approvalForAllRevoked';
  }

  return {
    source: transaction ? 'tx' : 'calldata',
    to: transaction?.to ?? undefined,
    selector,
    signature,
    functionName,
    params,
    danger,
    explainKey,
    raw: calldata,
    txValue: transaction ? transaction.value ?? null : undefined,
  };
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
