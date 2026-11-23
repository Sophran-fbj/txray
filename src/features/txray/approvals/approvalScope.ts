import { classifyApprovalAmount } from '@/lib/web3/approvalAmount';
import type { Approval } from './types';

export function getApprovalScope(approval: Approval) {
  switch (approval.kind) {
    case 'erc20': return classifyApprovalAmount(approval.allowance, 256);
    case 'permit2': return classifyApprovalAmount(approval.amount, 160);
    case 'nft': return 'collection';
    case 'nft-token': return 'single';
  }
}

export function hasBroadApproval(approval: Approval): boolean {
  const scope = getApprovalScope(approval);
  return scope === 'max' || scope === 'large' || scope === 'collection';
}
