import { getAddress, type Address } from 'viem';
import type { ApprovalPair, NftTokenIndex } from './approvalIndex';

interface ApprovalLog {
  address: string;
  topics: string[];
}

function topicAddress(value: string): Address {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid indexed address');
  return getAddress(`0x${value.slice(-40)}`);
}

/** ERC-20 and ERC-721 Approval events share topic0 but differ in indexed topics. */
export function splitApprovalLogs(logs: readonly ApprovalLog[]): {
  erc20: ApprovalPair[];
  nftToken: NftTokenIndex[];
} {
  const erc20 = new Map<string, ApprovalPair>();
  const nftToken = new Map<string, NftTokenIndex>();

  for (const log of logs) {
    try {
      const token = getAddress(log.address);
      if (log.topics.length === 3) {
        const spender = topicAddress(log.topics[2]);
        erc20.set(`${token.toLowerCase()}:${spender.toLowerCase()}`, { token, spender });
      } else if (log.topics.length === 4 && /^0x[0-9a-fA-F]{64}$/.test(log.topics[3])) {
        const tokenId = BigInt(log.topics[3]).toString();
        nftToken.set(`${token.toLowerCase()}:${tokenId}`, { token, tokenId });
      }
    } catch {
      // The indexer may contain malformed individual logs; keep valid entries.
    }
  }

  return { erc20: [...erc20.values()], nftToken: [...nftToken.values()] };
}
