import type { Approval } from './types';
import type { SpenderRisk } from './useSpenderRisk';
import { hasBroadApproval } from './approvalScope';

export type ApprovalFilter = 'all' | 'attention' | 'broad';
export type ApprovalSort = 'risk' | 'exposure' | 'asset';

export interface ApprovalSummary {
  total: number;
  attention: number;
  broad: number;
  highRiskSpender: number;
  pricedExposureUsd: number;
  pricedCount: number;
  unpricedCount: number;
}

export function isAttentionApproval(
  approval: Approval,
  risks: Record<string, SpenderRisk> | undefined,
): boolean {
  const risk = risks?.[approval.spender.toLowerCase()];
  return hasBroadApproval(approval) || !risk || risk.level !== 'known';
}

export function summarizeApprovals(
  approvals: Approval[],
  risks: Record<string, SpenderRisk> | undefined,
  prices: Record<string, number> | undefined,
): ApprovalSummary {
  let attention = 0;
  let broad = 0;
  let highRiskSpender = 0;
  let pricedExposureUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const approval of approvals) {
    if (isAttentionApproval(approval, risks)) {
      attention += 1;
    }
    if (hasBroadApproval(approval)) {
      broad += 1;
    }
    const level = risks?.[approval.spender.toLowerCase()]?.level;
    if (level === 'malicious' || level === 'eoa') {
      highRiskSpender += 1;
    }
    if (approval.kind !== 'nft' && approval.kind !== 'nft-token') {
      const value = exposureUsd(approval, prices);
      if (value !== undefined) {
        pricedExposureUsd += value;
        pricedCount += 1;
      } else {
        unpricedCount += 1;
      }
    }
  }

  return {
    total: approvals.length,
    attention,
    broad,
    highRiskSpender,
    pricedExposureUsd,
    pricedCount,
    unpricedCount,
  };
}

export function selectApprovals(
  approvals: Approval[],
  risks: Record<string, SpenderRisk> | undefined,
  prices: Record<string, number> | undefined,
  filter: ApprovalFilter,
  sort: ApprovalSort,
): Approval[] {
  const selected = approvals.filter((approval) => {
    if (filter === 'all') return true;
    if (filter === 'broad') return hasBroadApproval(approval);
    return isAttentionApproval(approval, risks);
  });

  return selected.sort((a, b) => {
    if (sort === 'asset') {
      return a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id);
    }
    if (sort === 'exposure') {
      const aValue = exposureUsd(a, prices);
      const bValue = exposureUsd(b, prices);
      if (aValue !== undefined && bValue !== undefined && aValue !== bValue) {
        return bValue - aValue;
      }
      if (aValue !== undefined && bValue === undefined) return -1;
      if (aValue === undefined && bValue !== undefined) return 1;
    }
    return (
      riskPriority(b, risks) - riskPriority(a, risks) ||
      Number(hasBroadApproval(b)) - Number(hasBroadApproval(a)) ||
      a.symbol.localeCompare(b.symbol) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function formatUsd(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (value >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('en-US', { maximumSignificantDigits: 2 });
}

function riskPriority(
  approval: Approval,
  risks: Record<string, SpenderRisk> | undefined,
): number {
  const level = risks?.[approval.spender.toLowerCase()]?.level;
  switch (level) {
    case 'malicious': return 5;
    case 'eoa': return 4;
    case 'new': return 3;
    case 'unknown': return 2;
    case 'known': return 0;
    default: return 1;
  }
}

function exposureUsd(
  approval: Approval,
  prices: Record<string, number> | undefined,
): number | undefined {
  if (approval.kind === 'nft' || approval.kind === 'nft-token' || !approval.atRiskAmountText) return undefined;
  const price = prices?.[approval.token.toLowerCase()];
  if (price === undefined) return undefined;
  const value = Number(approval.atRiskAmountText) * price;
  return Number.isFinite(value) ? value : undefined;
}
