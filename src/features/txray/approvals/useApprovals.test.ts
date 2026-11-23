import { describe, expect, it } from 'vitest';
import { parseApprovalIndexPayload } from './useApprovals';
import { mergeApprovalIndex, type ApprovalRangeCoverage } from './approvalIndex';

const VALID_PAIR = {
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
};

describe('mergeApprovalIndex', () => {
  const initialRange = { source: 'erc20', fromBlock: 0, toBlock: 10, status: 'failed' } as const;
  const firstHalf = { ...initialRange, toBlock: 5, status: 'complete' } as const;
  const secondHalf = { ...initialRange, fromBlock: 6, status: 'pending' } as const;

  function payload(ranges: ApprovalRangeCoverage[]) {
    return parseApprovalIndexPayload({
      erc20: [VALID_PAIR], nft: [], nftToken: [], permit2: [],
      coverage: {
        status: ranges.every((range) => range.status === 'complete') ? 'complete' : 'partial',
        truncatedSources: [], maxRecordsPerSource: 10_000, snapshotBlock: 10, ranges,
      },
    });
  }

  it('keeps candidates and coverage when resuming successive ranges', () => {
    const nft = { ...initialRange, source: 'nft', status: 'complete' } as const;
    const partial = mergeApprovalIndex(payload([initialRange, nft]), initialRange, payload([firstHalf, secondHalf]));
    expect(partial.coverage).toMatchObject({ status: 'partial', ranges: [firstHalf, secondHalf, nft] });
    const complete = mergeApprovalIndex(partial, secondHalf, payload([{ ...secondHalf, status: 'complete' }]));
    expect(complete.coverage.status).toBe('complete');
    expect(complete.erc20).toHaveLength(1);
  });

  it('rejects a continuation that skips a block', () => {
    expect(() => mergeApprovalIndex(payload([initialRange]), initialRange, payload([
      firstHalf, { ...secondHalf, fromBlock: 7 },
    ]))).toThrow(/不连续/);
  });
});

describe('parseApprovalIndexPayload', () => {
  it('preserves explicit partial coverage from the indexer', () => {
    const result = parseApprovalIndexPayload({
      erc20: [VALID_PAIR],
      nft: [],
      nftToken: [],
      permit2: [],
      coverage: {
        status: 'partial',
        truncatedSources: ['erc20'],
        maxRecordsPerSource: 10_000,
      },
    });

    expect(result.coverage.status).toBe('partial');
    expect(result.erc20).toHaveLength(1);
  });

  it('rejects malformed addresses instead of trusting API JSON', () => {
    expect(() =>
      parseApprovalIndexPayload({
        erc20: [{ token: 'not-an-address', spender: VALID_PAIR.spender }],
        nft: [],
        nftToken: [],
        permit2: [],
        coverage: {
          status: 'complete',
          truncatedSources: [],
          maxRecordsPerSource: 10_000,
        },
      }),
    ).toThrow(/无效/);
  });

  it('parses a token-scoped NFT candidate with a bounded token ID', () => {
    const result = parseApprovalIndexPayload({
      erc20: [], nft: [], permit2: [],
      nftToken: [{ token: VALID_PAIR.token, tokenId: '7' }],
      coverage: { status: 'complete', truncatedSources: [], maxRecordsPerSource: 10_000 },
    });
    expect(result.nftToken).toEqual([{ token: VALID_PAIR.token, tokenId: '7' }]);
  });

  it('surfaces stable API error messages', () => {
    expect(() =>
      parseApprovalIndexPayload({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' },
      }),
    ).toThrow('请求过于频繁，请稍后重试');
  });
});
