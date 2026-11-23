import { getAddress, isAddress, type Address } from 'viem';
import { isRecord } from '@/lib/validation';

export interface ApprovalPair {
  token: Address;
  spender: Address;
}

export interface NftTokenIndex {
  token: Address;
  tokenId: string;
}

export const APPROVAL_SOURCES = ['erc20', 'nft', 'permit2Approval', 'permit2Permit'] as const;
export type ApprovalSource = (typeof APPROVAL_SOURCES)[number];

export interface ApprovalBlockRange {
  source: ApprovalSource;
  fromBlock: number;
  toBlock: number;
}

export interface ApprovalRangeCoverage extends ApprovalBlockRange {
  status: 'complete' | 'pending' | 'failed' | 'saturated';
}

export interface ApprovalIndexPayload {
  erc20: ApprovalPair[];
  nft: ApprovalPair[];
  nftToken: NftTokenIndex[];
  permit2: ApprovalPair[];
  coverage: {
    status: 'complete' | 'partial';
    truncatedSources: string[];
    maxRecordsPerSource: number;
    snapshotBlock?: number;
    ranges?: ApprovalRangeCoverage[];
  };
}

export function isApprovalSource(value: unknown): value is ApprovalSource {
  return APPROVAL_SOURCES.some((source) => source === value);
}

export function isBlockNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseRanges(value: unknown, snapshotBlock: number): ApprovalRangeCoverage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('授权索引缺少区块范围');
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('授权索引返回了无效的区块范围');
    const { source, fromBlock, toBlock, status } = item;
    if (!isApprovalSource(source) || !isBlockNumber(fromBlock) ||
      !isBlockNumber(toBlock) || fromBlock > toBlock || toBlock > snapshotBlock ||
      (status !== 'complete' && status !== 'pending' && status !== 'failed' && status !== 'saturated')) {
      throw new Error('授权索引返回了无效的区块范围');
    }
    return { source, fromBlock, toBlock, status };
  });
}

function parseNftTokens(value: unknown): NftTokenIndex[] {
  if (!Array.isArray(value)) throw new Error('授权索引响应缺少 nftToken');
  return value.map((item) => {
    if (!isRecord(item) || typeof item.token !== 'string' || !isAddress(item.token) ||
      typeof item.tokenId !== 'string' || item.tokenId.length > 78 || !/^\d+$/.test(item.tokenId) ||
      BigInt(item.tokenId) >= 2n ** 256n) {
      throw new Error('授权索引返回了无效的 nftToken');
    }
    return { token: getAddress(item.token), tokenId: item.tokenId };
  });
}

function parsePairs(value: unknown, field: string): ApprovalPair[] {
  if (!Array.isArray(value)) throw new Error(`授权索引响应缺少 ${field}`);
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.token !== 'string' ||
      typeof item.spender !== 'string' ||
      !isAddress(item.token) ||
      !isAddress(item.spender)
    ) {
      throw new Error(`授权索引返回了无效的 ${field} 地址`);
    }
    return { token: getAddress(item.token), spender: getAddress(item.spender) };
  });
}

export function parseApprovalIndexPayload(value: unknown): ApprovalIndexPayload {
  if (!isRecord(value)) throw new Error('授权索引返回了无效响应');
  if (isRecord(value.error)) {
    throw new Error(
      typeof value.error.message === 'string'
        ? value.error.message
        : '授权索引查询失败',
    );
  }
  if (!isRecord(value.coverage)) {
    throw new Error('授权索引响应缺少覆盖范围信息');
  }

  const coverageStatus = value.coverage.status;
  const truncatedSources = value.coverage.truncatedSources;
  const maxRecordsPerSource = value.coverage.maxRecordsPerSource;
  const snapshotBlock = value.coverage.snapshotBlock;
  if (
    (coverageStatus !== 'complete' && coverageStatus !== 'partial') ||
    !Array.isArray(truncatedSources) ||
    !truncatedSources.every((source) => typeof source === 'string') ||
    typeof maxRecordsPerSource !== 'number' ||
    !Number.isSafeInteger(maxRecordsPerSource) ||
    maxRecordsPerSource <= 0
  ) {
    throw new Error('授权索引返回了无效的覆盖范围信息');
  }

  let rangeCoverage: Pick<ApprovalIndexPayload['coverage'], 'snapshotBlock' | 'ranges'> = {};
  if (snapshotBlock !== undefined || value.coverage.ranges !== undefined) {
    if (!isBlockNumber(snapshotBlock)) throw new Error('授权索引返回了无效的截止区块');
    const ranges = parseRanges(value.coverage.ranges, snapshotBlock);
    const hasIncompleteRange = ranges.some((range) => range.status !== 'complete');
    if (hasIncompleteRange !== (coverageStatus === 'partial')) {
      throw new Error('授权索引覆盖状态与区块范围不一致');
    }
    rangeCoverage = { snapshotBlock, ranges };
  }

  return {
    erc20: parsePairs(value.erc20, 'erc20'),
    nft: parsePairs(value.nft, 'nft'),
    nftToken: parseNftTokens(value.nftToken),
    permit2: parsePairs(value.permit2, 'permit2'),
    coverage: {
      status: coverageStatus,
      truncatedSources,
      maxRecordsPerSource,
      ...rangeCoverage,
    },
  };
}

export function sameApprovalRange(left: ApprovalBlockRange, right: ApprovalBlockRange): boolean {
  return left.source === right.source && left.fromBlock === right.fromBlock && left.toBlock === right.toBlock;
}

export function mergeApprovalIndex(
  current: ApprovalIndexPayload,
  requested: ApprovalBlockRange,
  next: ApprovalIndexPayload,
): ApprovalIndexPayload {
  const currentRanges = current.coverage.ranges;
  const updatedRanges = next.coverage.ranges;
  if (!currentRanges || !updatedRanges || current.coverage.snapshotBlock !== next.coverage.snapshotBlock ||
    !currentRanges.some((range) => sameApprovalRange(range, requested) && range.status !== 'complete')) {
    throw new Error('授权续扫区块与原扫描不一致');
  }

  let expectedStart = requested.fromBlock;
  for (const range of updatedRanges) {
    if (range.source !== requested.source || range.fromBlock !== expectedStart) {
      throw new Error('授权续扫返回了不连续的区块范围');
    }
    expectedStart = range.toBlock + 1;
  }
  if (expectedStart !== requested.toBlock + 1) throw new Error('授权续扫未返回完整区块范围');

  const ranges = currentRanges.flatMap((range) => sameApprovalRange(range, requested) ? updatedRanges : [range]);
  const truncatedSources = [...new Set(ranges
    .filter((range) => range.status === 'pending' || range.status === 'saturated')
    .map((range) => range.source))];
  const pairKey = (pair: ApprovalPair) => `${pair.token.toLowerCase()}:${pair.spender.toLowerCase()}`;
  return {
    erc20: mergeCandidates(current.erc20, next.erc20, pairKey),
    nft: mergeCandidates(current.nft, next.nft, pairKey),
    nftToken: mergeCandidates(current.nftToken, next.nftToken, (item) => `${item.token.toLowerCase()}:${item.tokenId}`),
    permit2: mergeCandidates(current.permit2, next.permit2, pairKey),
    coverage: {
      ...current.coverage,
      status: ranges.every((range) => range.status === 'complete') ? 'complete' : 'partial',
      truncatedSources,
      ranges,
    },
  };
}

function mergeCandidates<T>(previous: T[], next: T[], key: (item: T) => string): T[] {
  return [...new Map([...previous, ...next].map((item) => [key(item), item])).values()];
}
