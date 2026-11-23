import { describe, expect, it, vi } from 'vitest';
import { TransactionReceiptNotFoundError, encodeAbiParameters, padHex, toEventSelector, type Hex } from 'viem';
import { decodeReceiptEvent, readTransactionExecution } from './transactionExecution';

const hash = padHex('0x01', { size: 32 });
const sender = '0x0000000000000000000000000000000000000011';
const recipient = '0x0000000000000000000000000000000000000022';
const token = '0x0000000000000000000000000000000000000033';

function eventLog(signature: string, data: Hex, tokenId?: bigint) {
  const topics: [Hex, ...Hex[]] = [toEventSelector(signature), padHex(sender, { size: 32 }), padHex(recipient, { size: 32 })];
  if (tokenId !== undefined) topics.push(encodeAbiParameters([{ type: 'uint256' }], [tokenId]));
  return { address: token, topics, data } as const;
}

describe('receipt events', () => {
  const transfer = 'Transfer(address,address,uint256)';
  const approval = 'Approval(address,address,uint256)';

  it.each([['transfer', transfer], ['approval', approval]] as const)('distinguishes ERC-20 and ERC-721 %s by log layout', (kind, signature) => {
    const rawAmount = encodeAbiParameters([{ type: 'uint256' }], [50n]);
    expect(decodeReceiptEvent(eventLog(signature, rawAmount))).toEqual({
      kind, format: 'erc20', contract: token, from: sender, to: recipient, value: 50n,
    });
    expect(decodeReceiptEvent(eventLog(signature, '0x', 0n))).toMatchObject({ kind, format: 'erc721', value: 0n });
  });

  it('reads collection revocation and skips ambiguous or malformed layouts', () => {
    const signature = 'ApprovalForAll(address,address,bool)';
    expect(decodeReceiptEvent(eventLog(signature, padHex('0x00', { size: 32 })))).toMatchObject({
      kind: 'approvalForAll', approved: false, from: sender, to: recipient,
    });
    expect(decodeReceiptEvent(eventLog(signature, padHex('0x02', { size: 32 })))).toBeUndefined();
    expect(decodeReceiptEvent(eventLog(transfer, '0x'))).toBeUndefined();
  });
});

describe('transaction execution', () => {
  it('marks a known unmined transaction pending when its receipt does not exist', async () => {
    const error = new TransactionReceiptNotFoundError({ hash });
    const client = { getTransactionReceipt: vi.fn().mockRejectedValue(error) };
    await expect(readTransactionExecution(client, { hash, blockNumber: null })).resolves.toEqual({ status: 'pending' });
    await expect(readTransactionExecution(client, { hash, blockNumber: 10n })).rejects.toThrow(error);
  });

  it('keeps network errors distinct from pending', async () => {
    const client = { getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC unavailable')) };
    await expect(readTransactionExecution(client, { hash, blockNumber: null })).rejects.toThrow('RPC unavailable');
  });

  it('reports missing legacy status and bounds the number of inspected logs', async () => {
    const otherLog = eventLog('Other(address,address)', '0x');
    const client = { getTransactionReceipt: vi.fn().mockResolvedValue({
      blockNumber: 10n, logs: Array.from({ length: 101 }, () => otherLog),
    }) };
    await expect(readTransactionExecution(client, { hash, blockNumber: 10n })).resolves.toMatchObject({
      status: 'unknown', contractAddress: null, events: [], unrecognizedLogs: 100, omittedLogs: 1,
    });
  });
});
