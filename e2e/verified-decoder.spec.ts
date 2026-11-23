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

test('decodes calls through a verified proxy implementation ABI and discloses the implementation address', async ({ page }) => {
  const proxy = '0x0000000000000000000000000000000000000011';
  const implementation = '0x0000000000000000000000000000000000000022';
  const erc20 = parseAbi([
    'function approve(address spender, uint256 allowanceValue) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function transferFrom(address,address,uint256) returns (bool)',
  ]);
  const data = encodeFunctionData({ abi: erc20, functionName: 'approve', args: [proxy, 50n] });

  await page.route('**/api/contract-abi?**', async (route) => {
    await route.fulfill({
      json: {
        status: 'verified',
        functions: [],
        implementation: { address: implementation, functions: erc20 },
      },
    });
  });

  await page.goto('/tools/txray/decoder');
  await page.getByRole('button', { name: 'calldata', exact: true }).click();
  await page.getByLabel('calldata', { exact: true }).fill(data);
  await page.getByLabel('目标合约地址（可选）').fill(proxy);

  await expect(page.getByText(/经代理实现合约 ABI 解码/)).toBeVisible();
  await expect(page.getByRole('link', { name: `实现合约: ${implementation}` })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'allowanceValue' })).toHaveCount(1);
});
