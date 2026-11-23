import { expect, test } from '@playwright/test';

test('theme switches in one click and survives navigation and reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  await expect(page.getByRole('button', { name: '切换到石墨主题' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '切换到暖砂主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sandstone');

  await page.getByRole('link', { name: /授权检查/ }).first().click();
  await expect(page).toHaveURL(/\/tools\/txray\/approvals/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sandstone');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sandstone');
  await expect(page.getByRole('button', { name: '切换到暖砂主题' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '切换到冷白主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'frost');
  await page.getByRole('button', { name: '切换到石墨主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');

  await page.getByRole('button', { name: '切换到冷白主题' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'frost');
});

test('header brand, nav tabs, and controls do not shift horizontally across routes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'desktop header horizontal alignment check');

  const measureHeader = async () => {
    const header = page.locator('header');
    const brandBox = await header.getByRole('link', { name: 'TxRay' }).boundingBox();
    const navApprovalsBox = await header.getByRole('link', { name: '授权检查' }).boundingBox();
    const navDecoderBox = await header.getByRole('link', { name: '交易解码' }).boundingBox();
    const navSignatureBox = await header.getByRole('link', { name: '签名风险' }).boundingBox();
    const navCasesBox = await header.getByRole('link', { name: '案例库' }).boundingBox();
    const navArticlesBox = await header.getByRole('link', { name: '原理文章' }).boundingBox();
    const themeBox = await header.getByRole('group', { name: '切换主题' }).boundingBox();
    const langBox = await header.getByRole('button', { name: '中文' }).boundingBox();

    expect(brandBox).not.toBeNull();
    expect(navApprovalsBox).not.toBeNull();
    expect(navDecoderBox).not.toBeNull();
    expect(navSignatureBox).not.toBeNull();
    expect(navCasesBox).not.toBeNull();
    expect(navArticlesBox).not.toBeNull();
    expect(themeBox).not.toBeNull();
    expect(langBox).not.toBeNull();

    return {
      brand: brandBox!.x,
      navApprovals: navApprovalsBox!.x,
      navDecoder: navDecoderBox!.x,
      navSignature: navSignatureBox!.x,
      navCases: navCasesBox!.x,
      navArticles: navArticlesBox!.x,
      theme: themeBox!.x,
      lang: langBox!.x,
    };
  };

  await page.goto('/tools/txray/approvals?demo=1');
  await expect(page.getByText('USDC', { exact: true })).toBeVisible();
  const baseline = await measureHeader();

  const header = page.locator('header');
  const routeTransitions = [
    { linkName: '交易解码', url: /\/tools\/txray\/decoder/ },
    { linkName: '签名风险', url: /\/tools\/signature-risk/ },
    { linkName: '案例库', url: /\/cases/ },
    { linkName: '原理文章', url: /\/articles/ },
    { linkName: 'TxRay', url: /\/$/ },
  ];

  for (const step of routeTransitions) {
    await header.getByRole('link', { name: step.linkName }).click();
    await expect(page).toHaveURL(step.url);
    const current = await measureHeader();
    for (const key of Object.keys(baseline) as Array<keyof typeof baseline>) {
      expect(Math.abs(current[key] - baseline[key])).toBeLessThanOrEqual(1);
    }
  }
});
