import {
  TransactionReceiptNotFoundError,
  decodeEventLog,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
} from 'viem';

const fungibleEvents = [
  parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)'),
] as const;
const nftEvents = [
  parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
  parseAbiItem('event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)'),
] as const;
const collectionApproval = parseAbiItem('event ApprovalForAll(address indexed owner, address indexed operator, bool approved)');

const transferTopic = toEventSelector(fungibleEvents[0]);
const approvalTopic = toEventSelector(fungibleEvents[1]);
const collectionApprovalTopic = toEventSelector(collectionApproval);
const MAX_RECEIPT_LOGS = 100;

type ReceiptLog = Pick<Log, 'address' | 'topics' | 'data'>;

export type ReceiptEvent = {
  contract: Address;
  from: Address;
  to: Address;
} & (
  | { kind: 'transfer' | 'approval'; format: 'erc20' | 'erc721'; value: bigint }
  | { kind: 'approvalForAll'; approved: boolean }
);

export type TransactionExecution = { status: 'pending' } | {
  status: 'success' | 'reverted' | 'unknown';
  blockNumber: bigint;
  contractAddress: Address | null;
  events: ReceiptEvent[];
  unrecognizedLogs: number;
  omittedLogs: number;
};

export async function readTransactionExecution(
  client: Pick<PublicClient, 'getTransactionReceipt'>,
  transaction: { hash: Hash; blockNumber: bigint | null },
): Promise<TransactionExecution> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: transaction.hash });
    const status = receipt.status === 'success' || receipt.status === 'reverted' ? receipt.status : 'unknown';
    const logs = receipt.logs.slice(0, MAX_RECEIPT_LOGS);
    const events = logs.flatMap((log) => {
      const event = decodeReceiptEvent(log);
      return event ? [event] : [];
    });
    return {
      status,
      blockNumber: receipt.blockNumber,
      contractAddress: receipt.contractAddress ?? null,
      events,
      unrecognizedLogs: logs.length - events.length,
      omittedLogs: receipt.logs.length - logs.length,
    };
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError && transaction.blockNumber === null) {
      return { status: 'pending' };
    }
    throw error;
  }
}

export function decodeReceiptEvent(log: ReceiptLog): ReceiptEvent | undefined {
  const { address: contract, data, topics } = log;
  const indexedAddress = /^0x0{24}[0-9a-f]{40}$/i;
  if (!indexedAddress.test(topics[1] ?? '') || !indexedAddress.test(topics[2] ?? '')) return undefined;

  try {
    const topic = topics[0]?.toLowerCase();
    if (topic === collectionApprovalTopic && topics.length === 3 && /^0x0{63}[01]$/.test(data)) {
      const { args } = decodeEventLog({ abi: [collectionApproval], data, topics });
      return { kind: 'approvalForAll', contract, from: args.owner, to: args.operator, approved: args.approved };
    }

    // ERC-20 and ERC-721 share these topics. The indexed fields distinguish the standard log layouts.
    if (topic !== transferTopic && topic !== approvalTopic) return undefined;
    if (topics.length === 3 && /^0x[0-9a-f]{64}$/i.test(data)) {
      const event = decodeEventLog({ abi: fungibleEvents, data, topics });
      return event.eventName === 'Transfer'
        ? { kind: 'transfer', format: 'erc20', contract, from: event.args.from, to: event.args.to, value: event.args.value }
        : { kind: 'approval', format: 'erc20', contract, from: event.args.owner, to: event.args.spender, value: event.args.value };
    }
    if (topics.length === 4 && data === '0x') {
      const event = decodeEventLog({ abi: nftEvents, data, topics });
      return event.eventName === 'Transfer'
        ? { kind: 'transfer', format: 'erc721', contract, from: event.args.from, to: event.args.to, value: event.args.tokenId }
        : { kind: 'approval', format: 'erc721', contract, from: event.args.owner, to: event.args.approved, value: event.args.tokenId };
    }
  } catch {
    // A malformed log must not hide the transaction receipt or the other events.
  }
}
