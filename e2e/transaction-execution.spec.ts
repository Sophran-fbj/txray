import { expect, test, type Page } from '@playwright/test';
import { padHex, parseAbi, toEventSelector } from 'viem';
import { mainnet } from 'viem/chains';
import { APPROVE_EXAMPLE } from '../src/features/txray/decoder/examples';

const hash = padHex('0x01', { size: 32 });
const blockHash = padHex('0x02', { size: 32 });
const sender = '0x0000000000000000000000000000000000000011';
const target = '0x0000000000000000000000000000000000000022';
const blockNumber = '0x2a';
const rpcHost = new URL(mainnet.rpcUrls.default.http[0]).host;

function receipt(status: '0x0' | '0x1', logs: unknown[] = []) {
  return {
    status, transactionHash: hash, blockHash, blockNumber, from: sender, to: target,
    transactionIndex: '0x0', contractAddress: null, cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
    effectiveGasPrice: '0x1', logsBloom: padHex('0x00', { size: 256 }), logs, type: '0x0',
  };
}

async function mockRpc(page: Page, transaction: Record<string, unknown>, readReceipt: () => object) {
  await page.route('**/api/contract-abi?**', (route) => route.fulfill({ json: { status: 'unverified' } }));
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
  await page.route((url) => url.host === rpcHost || url.host === 'eth-mainnet.g.alchemy.com', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const { id, method, params } = route.request().postDataJSON();
    expect(params).toEqual([hash]);
    if (method === 'eth_getTransactionByHash') {
      await route.fulfill({ headers, json: { jsonrpc: '2.0', id, result: {
        hash, from: sender, to: target, blockNumber, blockHash, input: APPROVE_EXAMPLE, value: '0x0',
        transactionIndex: '0x0', nonce: '0x0', gas: '0x5208', gasPrice: '0x1', type: '0x0', ...transaction,
      } } });
    } else {
      expect(method).toBe('eth_getTransactionReceipt');
      await route.fulfill({ headers, json: { jsonrpc: '2.0', id, ...readReceipt() } });
    }
  });
}

async function openTransaction(page: Page) {
  await page.goto('/tools/txray/decoder');
  await page.getByLabel('交易哈希', { exact: true }).fill(hash);
  return page.getByRole('region', { name: '交易执行结果' });
}

test('keeps calldata decoding available through receipt errors and shows a mined revert', async ({ page }) => {
  let receiptAvailable = false;
  await mockRpc(page, {}, () => receiptAvailable
    ? { result: receipt('0x0') }
    : { error: { code: -32601, message: 'Receipt method unavailable' } });
  const execution = await openTransaction(page);
  await expect(execution.getByText('暂时无法查询回执')).toBeVisible();
  await expect(page.getByText('approve', { exact: true }).first()).toBeVisible();
  receiptAvailable = true;
  await execution.getByRole('button', { name: '刷新回执' }).click();
  await expect(execution.getByText('交易执行回退')).toBeVisible();
  await expect(page.getByText('approve', { exact: true }).first()).toBeVisible();
});

test('shows execution for an empty-input transaction from pending to confirmed', async ({ page }) => {
  let mined = false;
  await mockRpc(page, { blockNumber: null, blockHash: null, input: '0x', value: '0xde0b6b3a7640000' },
    () => ({ result: mined ? receipt('0x1') : null }));
  const execution = await openTransaction(page);
  await expect(execution.getByText('待确认', { exact: true })).toBeVisible();
  await expect(execution.getByText('1 ETH')).toBeVisible();
  await expect(page.getByText('交易输入中没有可解码的函数选择器。')).toBeVisible();
  mined = true;
  await execution.getByRole('button', { name: '刷新回执' }).click();
  await expect(execution.getByText('外层交易执行成功')).toBeVisible();
  await expect(execution.getByText('42', { exact: true })).toBeVisible();
});

test('shows the emitting contract and raw amount for a recorded approval', async ({ page }) => {
  const log = {
    address: target, topics: [toEventSelector('Approval(address,address,uint256)'),
      padHex(sender, { size: 32 }), padHex('0x33', { size: 32 })],
    data: padHex('0x64', { size: 32 }), blockNumber, blockHash, transactionHash: hash,
    transactionIndex: '0x0', logIndex: '0x0', removed: false,
  };
  await mockRpc(page, {}, () => ({ result: receipt('0x1', [log]) }));
  const execution = await openTransaction(page);
  const event = execution.getByRole('listitem').filter({ hasText: '授权事件' });
  await expect(event.getByText('ERC-20 格式')).toBeVisible();
  await expect(event.getByText('100', { exact: true })).toBeVisible();
  await expect(event.getByRole('link', { name: target })).toHaveAttribute('href', `https://etherscan.io/address/${target}`);
});

test('uses the target from a transaction hash for verified ABI decoding', async ({ page }) => {
  await mockRpc(page, {}, () => ({ result: receipt('0x1') }));
  await page.route('**/api/contract-abi?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('chainId')).toBe('1');
    expect(params.get('address')).toBe(target);
    await route.fulfill({ json: { status: 'verified', functions: parseAbi(['function approve(address party, uint256 quantity)']) } });
  });
  await openTransaction(page);
  await expect(page.getByText(/目标合约已验证 ABI/)).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'quantity' })).toHaveCount(1);
});
