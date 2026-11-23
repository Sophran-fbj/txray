import { expect, test } from '@playwright/test';

test('case lab filters cases cleanly and launches decoder and signature-risk cases', async ({
  page,
}) => {
  await page.route('**/api/contract-abi*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'unverified',
        chainId: 1,
        address: '0x9999999999999999999999999999999999999999',
      }),
    }),
  );

  await page.goto('/cases');

  await expect(page.getByRole('heading', { name: '典型钓鱼与风险案例库' })).toBeVisible();
  await expect(page.locator('article[data-case-id]')).toHaveCount(6);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '批量与路由' }).click();
  await expect(page.locator('article[data-case-id]')).toHaveCount(3);
  await expect(page.locator('article[data-case-id="safe-multisend-delegatecall"]')).toBeVisible();

  await page
    .locator('article[data-case-id="safe-multisend-delegatecall"]')
    .getByRole('link', { name: /在交易解码中查看/ })
    .click();

  await expect(page).toHaveURL(/\/tools\/txray\/decoder\?case=safe-multisend-delegatecall$/);
  await expect(page.getByTestId('active-case-banner')).toContainText(
    'Safe MultiSend 压缩包中的内层 delegatecall 与授权',
  );
  await expect(page.getByTestId('static-decode-notice')).toBeVisible();
  await expect(page.getByText('Safe · MultiSend 批量打包')).toBeVisible();
  await expect(page.getByText('DELEGATECALL', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('最大额度（若为 ERC-20）')).toBeVisible();

  await page.goto('/cases');
  await page.getByRole('button', { name: '签名钓鱼' }).click();
  await expect(page.locator('article[data-case-id]')).toHaveCount(2);

  await page
    .locator('article[data-case-id="seaport-zero-return-nft"]')
    .getByRole('link', { name: /在签名分析中查看/ })
    .click();

  await expect(page).toHaveURL(/\/tools\/signature-risk\?case=seaport-zero-return-nft$/);
  await expect(page.getByTestId('active-case-banner')).toContainText(
    '伪造为正常挂单的 Seaport 零元扫单签名',
  );
  await expect(page.getByRole('heading', { name: '订单资产流向对照' })).toBeVisible();
  await expect(page.getByText(/没有任何资产回到你自己的地址（零回报）/)).toBeVisible();
});
