import { describe, expect, it } from 'vitest';
import { articles } from '@/content/articles';
import { getRiskCase, riskCases, riskCaseHref } from '@/content/riskCases';
import { analyzeTypedData } from '@/features/signature-risk/analyzer';
import { buildCallTree } from '@/features/txray/decoder/call-tree/decode';
import type { CallNode, RiskFinding } from '@/features/txray/decoder/call-tree/types';

function collectFindings(node: CallNode): RiskFinding[] {
  return [...node.riskFindings, ...node.children.flatMap(collectFindings)];
}

describe('riskCases registry', () => {
  it('contains unique IDs and references existing explanatory articles', () => {
    const ids = new Set(riskCases.map((item) => item.id));
    expect(ids.size).toBe(riskCases.length);
    expect(riskCases.length).toBeGreaterThanOrEqual(6);

    const articleSlugs = new Set(articles.map((article) => article.slug));
    for (const item of riskCases) {
      expect(articleSlugs.has(item.articleSlug)).toBe(true);
      expect(getRiskCase(item.id)).toEqual(item);
      expect(riskCaseHref(item)).toContain(`?case=${item.id}`);
    }
  });

  it('produces concrete high-severity findings when executed through TxRay analyzers', () => {
    for (const item of riskCases) {
      if (item.tool === 'decoder') {
        const tree = buildCallTree(
          {
            to: item.target ?? null,
            value: null,
            data: item.calldata,
          },
          { chainId: item.chainId },
        );
        const findings = collectFindings(tree.root);
        expect(findings.some((finding) => finding.severity === 'high')).toBe(true);
      } else {
        const analysis = analyzeTypedData(item.payload);
        expect(analysis.schemaValidated).toBe(true);
        expect(analysis.danger).toBe('high');
        if (item.id === 'seaport-zero-return-nft') {
          expect(analysis.orderSummary?.zeroReturnToOfferer).toBe(true);
        }
      }
    }
  });
});
