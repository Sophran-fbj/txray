'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { mergeApprovalIndex, type ApprovalBlockRange } from './approvalIndex';
import { fetchApprovalIndex, readApprovals } from './readApprovals';
import type { ApprovalScanResult } from './types';

export type {
  Approval,
  ApprovalScanResult,
  ApprovalWarning,
  Erc20Approval,
  NftApproval,
  Permit2Approval,
} from './types';
export { parseApprovalIndexPayload } from './approvalIndex';

export function useApprovals(owner: Address | undefined, chainId = 1) {
  const client = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const queryKey = ['approvals', chainId, owner?.toLowerCase()] as const;
  const query = useQuery<ApprovalScanResult>({
    queryKey,
    enabled: Boolean(owner && client),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!client || !owner) throw new Error('RPC 或查询地址不可用');
      const cached = queryClient.getQueryData<ApprovalScanResult>(queryKey);
      const coverage = cached?.index.coverage;
      const hasSplitRanges = coverage?.ranges?.some((range) =>
        range.fromBlock !== 0 || range.toBlock !== coverage.snapshotBlock,
      );
      const index = cached && (coverage?.status === 'partial' || hasSplitRanges)
        ? cached.index
        : await fetchApprovalIndex(owner, chainId, { signal });
      return readApprovals(client, owner, index);
    },
  });

  const continuation = useMutation({
    mutationKey: [...queryKey, 'continue'],
    mutationFn: async (range: ApprovalBlockRange) => {
      if (!client || !owner) throw new Error('RPC 或查询地址不可用');
      const original = queryClient.getQueryData<ApprovalScanResult>(queryKey)?.index;
      const snapshotBlock = original?.coverage.snapshotBlock;
      if (!original || snapshotBlock === undefined) throw new Error('授权续扫缺少截止区块');
      const next = await fetchApprovalIndex(owner, chainId, { continuation: { snapshotBlock, range } });
      const index = mergeApprovalIndex(original, range, next);
      const result = await readApprovals(client, owner, index);
      if (queryClient.getQueryData<ApprovalScanResult>(queryKey)?.index === original) {
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData<ApprovalScanResult>(queryKey, (current) =>
          current?.index === original ? result : current,
        );
      }
    },
  });

  return {
    ...query,
    continuation,
    restart: () => {
      continuation.reset();
      return queryClient.resetQueries({ queryKey, exact: true });
    },
  };
}
