import { expect, test } from '@playwright/test';

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
