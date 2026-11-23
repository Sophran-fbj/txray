import { expect, test } from '@playwright/test';
import { mainnet } from 'viem/chains';

const rpcHost = new URL(mainnet.rpcUrls.default.http[0]).host;

test('resumes and retries approval ranges within the same snapshot', async ({ page }) => {
  const requests: (string | null)[] = [];
  const snapshotBlock = 10;
  const completed = { fromBlock: 0, toBlock: snapshotBlock, status: 'complete' };
  const pending = { source: 'erc20', fromBlock: 6, toBlock: snapshotBlock, status: 'pending' };
  const failed = { ...completed, source: 'nft', status: 'failed' };

  await page.route('**/api/approvals?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const range = params.get('range');
    requests.push(range);
    if (range) expect(params.get('snapshot')).toBe(String(snapshotBlock));
    const ranges = range === 'erc20:6:10' ? [{ ...pending, status: 'complete' }]
      : range === 'nft:0:10' ? [{ ...failed, status: 'complete' }]
        : [
          { ...completed, source: 'erc20', toBlock: 5 }, pending, failed,
          { ...completed, source: 'permit2Approval' }, { ...completed, source: 'permit2Permit' },
        ];
    await route.fulfill({ json: {
      erc20: [], nft: [], nftToken: [], permit2: [],
      coverage: {
        status: range ? 'complete' : 'partial', truncatedSources: range ? [] : ['erc20'],
        maxRecordsPerSource: 10_000, snapshotBlock, ranges,
      },
    } });
  });

  await page.goto('/tools/txray/approvals');
  await page.locator('#approval-address').fill('0x0000000000000000000000000000000000000001');
  const incomplete = page.getByText('扫描结果不完整，不能据此判断该地址安全');
  await expect(incomplete).toBeVisible();
  await expect(page.getByText('历史扫描范围 · 截至区块 10')).toBeVisible();

  const continueRange = page.getByRole('button', { name: '扫描此区间' });
  await continueRange.click();
  await expect(continueRange).toHaveCount(0);
  await expect(incomplete).toBeVisible();

  await page.getByRole('button', { name: '重试此区间' }).click();
  await expect(incomplete).toHaveCount(0);
  expect(requests).toEqual([null, 'erc20:6:10', 'nft:0:10']);
});

test('flags an EIP-7702 delegated EOA even when the approval list is empty', async ({ page }) => {
  const owner = '0x00000000000000000000000000000000000000aa';
  const delegate = '0x00000000000000000000000000000000000000bb';
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
    if (method === 'eth_getCode') {
      const addr = typeof params?.[0] === 'string' ? params[0].toLowerCase() : '';
      const code = addr === owner.toLowerCase() ? `0xef0100${delegate.slice(2)}` : '0x6000';
      await route.fulfill({ headers, json: { jsonrpc: '2.0', id, result: code } });
      return;
    }
    await route.fulfill({ headers, json: { jsonrpc: '2.0', id, result: null } });
  });

  await page.route('**/api/approvals?**', (route) => route.fulfill({
    json: {
      erc20: [], nft: [], nftToken: [], permit2: [],
      coverage: { status: 'complete', truncatedSources: [], maxRecordsPerSource: 10_000, snapshotBlock: 100, ranges: [] },
    },
  }));
  await page.route('**/api/spender-info?**', (route) => route.fulfill({
    json: {
      created: {},
      threat: {
        status: 'available', malicious: [delegate], checkedAt: 1_700_000_000_000, stale: false,
        source: { name: 'Scam Sniffer', repositoryUrl: 'https://github.com/scamsniffer/scam-database', publicDelayDays: 7 },
      },
    },
  }));

  await page.goto(`/tools/txray/approvals?address=${owner}`);
  const alert = page.getByTestId('eip7702-delegation-alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('EIP-7702');
  await expect(alert.getByRole('link', { name: /0x00000000000000000000000000000000000000bb/i })).toBeVisible();
  await expect(alert.getByText('⚠ 已知恶意')).toBeVisible();
  await expect(alert.getByRole('link', { name: /了解 EIP-7702/ })).toHaveAttribute('href', '/articles/eip-7702-delegated-eoa-risk');
});
