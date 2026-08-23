import { expect, test } from '@playwright/test';

const baseUrl = String(process.env.MF_VISUAL_BASE_URL || '').replace(/\/$/, '');

async function openStable(page, path = '/') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.beforeAll(() => {
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error('MF_VISUAL_BASE_URL deve apontar para um Preview HTTPS explícito.');
  }
});

test('public access shell remains usable on desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStable(page);

  await expect(page.getByRole('heading', { name: 'MFinanceiro', exact: true })).toBeVisible();
  await expect(page.getByText('Solicite seu acesso', { exact: true })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[placeholder="Seu nome"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: testInfo.outputPath('login-desktop.png'),
    fullPage: true,
  });
});

test('public access shell remains usable on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStable(page);

  await expect(page.getByText('Solicite seu acesso', { exact: true })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const formBox = await page.locator('form').boundingBox();
  expect(formBox).not.toBeNull();
  expect(formBox.width).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath('login-mobile.png'),
    fullPage: true,
  });
});

test('admin entry shell is visually reachable without invoking OAuth', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStable(page, '/admin-login');

  await expect(page.getByText('Acesso administrativo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Entrar com GitHub/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: testInfo.outputPath('admin-login-desktop.png'),
    fullPage: true,
  });
});
