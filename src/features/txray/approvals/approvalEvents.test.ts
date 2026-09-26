import { describe, expect, it } from 'vitest';
import { splitApprovalLogs } from './approvalEvents';

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const OWNER = '0xFb3C2B2769A2119f349233A44A640F090C907667';
const SPENDER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const topic = (value: string) => `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

describe('splitApprovalLogs', () => {
  it('separates ERC-20 allowances from per-token ERC-721 approvals sharing Approval topic0', () => {
    const result = splitApprovalLogs([
      { address: TOKEN, topics: [APPROVAL_TOPIC, topic(OWNER), topic(SPENDER)] },
      { address: TOKEN, topics: [APPROVAL_TOPIC, topic(OWNER), topic(SPENDER), topic('0x07')] },
    ]);

    expect(result.erc20).toEqual([{ token: TOKEN, spender: SPENDER }]);
    expect(result.nftToken).toEqual([{ token: TOKEN, tokenId: '7' }]);
  });

  it('deduplicates historical changes to the same NFT token ID', () => {
    const log = { address: TOKEN, topics: [APPROVAL_TOPIC, topic(OWNER), topic(SPENDER), topic('0x07')] };
    expect(splitApprovalLogs([log, log]).nftToken).toHaveLength(1);
  });
});
