import type { Address, PublicClient } from 'viem';
import { isRecord } from '@/lib/validation';
import {
  parseApprovalIndexPayload,
  type ApprovalBlockRange,
  type ApprovalIndexPayload,
} from './approvalIndex';
import { readCurrentApprovalState } from './readCurrentApprovalState';
import { enrichApprovals } from './enrichApprovals';
import type { ApprovalScanResult, ApprovalWarning } from './types';

export async function fetchApprovalIndex(
  owner: Address,
  chainId: number,
  options?: { signal?: AbortSignal; continuation?: { snapshotBlock: number; range: ApprovalBlockRange } },
): Promise<ApprovalIndexPayload> {
  const params = new URLSearchParams({ owner, chainId: String(chainId) });
  if (options?.continuation) {
    const { snapshotBlock, range } = options.continuation;
    params.set('snapshot', String(snapshotBlock));
    params.set('range', `${range.source}:${range.fromBlock}:${range.toBlock}`);
  }
  const response = await fetch(`/api/approvals?${params}`, { signal: options?.signal });
  const json: unknown = await response.json();
  if (!response.ok) {
    if (
      isRecord(json) &&
      isRecord(json.error) &&
      typeof json.error.message === 'string'
    ) {
      throw new Error(json.error.message);
    }
    throw new Error('获取授权记录失败');
  }

  return parseApprovalIndexPayload(json);
}

export async function readApprovals(
  client: PublicClient,
  owner: Address,
  index: ApprovalIndexPayload,
): Promise<ApprovalScanResult> {
  const warnings: ApprovalWarning[] = [];
  if (index.coverage.status === 'partial') {
    warnings.push(index.coverage.ranges ? { code: 'index-ranges-incomplete' } : {
      code: 'index-truncated',
      maxRecordsPerSource: index.coverage.maxRecordsPerSource,
    });
  }

  const current = await readCurrentApprovalState(client, owner, index);
  if (current.failedReads > 0) {
    warnings.push({ code: 'current-reads-failed', count: current.failedReads });
  }

  const enriched = await enrichApprovals(client, owner, current);
  if (enriched.failedDecimals > 0) {
    warnings.push({ code: 'decimals-failed', count: enriched.failedDecimals });
  }
  if (enriched.failedBalances > 0) {
    warnings.push({ code: 'balances-failed', count: enriched.failedBalances });
  }

  return {
    index,
    approvals: enriched.approvals,
    status: warnings.length ? 'partial' : 'complete',
    warnings,
  };
}
