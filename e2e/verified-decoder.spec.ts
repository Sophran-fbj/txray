import { expect, test } from '@playwright/test';
import { encodeFunctionData, parseAbi } from 'viem';

test('decodes a pasted approval against the supplied target ABI and selected network', async ({ page }) => {
  const address = '0x0000000000000000000000000000000000000011';
  const functions = parseAbi([
    'function approve(address operator, uint256 nftId)',
    'function ownerOf(uint256) view returns (address)',
    'function getApproved(uint256) view returns (address)',
    'function isApprovedForAll(address,address) view returns (bool)',
    'function supportsInterface(bytes4) view returns (bool)',
  ]);
  const data = encodeFunctionData({ abi: functions, functionName: 'approve', args: [address, 0n] });
  const requests: string[] = [];
  await page.route('**/api/contract-abi?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const chainId = params.get('chainId');
    requests.push(`${chainId}:${params.get('address')}`);
    await route.fulfill({ json: chainId === '8453' ? { status: 'verified', functions } : { status: 'unverified' } });
  });

  await page.goto('/tools/txray/decoder');
  await page.getByRole('button', { name: 'calldata', exact: true }).click();
  await page.locator('#decoder-network').selectOption('8453');
  await page.getByLabel('calldata', { exact: true }).fill(data);
  await expect(page.getByText('本地选择器表')).toBeVisible();
  expect(requests).toEqual([]);

  await page.getByLabel('目标合约地址（可选）').fill(address);
  await expect(page.getByText(/目标合约已验证 ABI/)).toBeVisible();
  await expect(page.getByText(/此调用请求授权指定 token ID 的单件 NFT/)).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'nftId' })).toContainText('Token ID');

  await page.locator('#decoder-network').selectOption('1');
  await expect(page.getByText(/本地选择器表.*目标地址暂无已验证 ABI/)).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'nftId' })).toHaveCount(0);
  expect(requests).toEqual([`8453:${address}`, `1:${address}`]);
});
