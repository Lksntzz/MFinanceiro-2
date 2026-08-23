import { expect, test } from '@playwright/test';

const baseURL = process.env.MF_E2E_BASE_URL;
const email = process.env.MF_E2E_EMAIL;
const password = process.env.MF_E2E_PASSWORD;

if (!baseURL || !email || !password) {
  throw new Error(
    'MF_E2E_BASE_URL, MF_E2E_EMAIL e MF_E2E_PASSWORD são obrigatórios para o smoke autenticado.',
  );
}

test.use({ baseURL, viewport: { width: 1440, height: 900 } });

test('login, busca, agenda, privacidade e preferências', async ({ page }) => {
  await page.goto('/');
  await page
    .getByPlaceholder('seu@email.com')
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByPlaceholder('seu@email.com').fill(email);

  await expect(page.getByText('Acesse sua conta')).toBeVisible({
    timeout: 8_000,
  });
  await page.getByPlaceholder('Sua senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/app(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByLabel('Navegação financeira')).toBeVisible();

  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+K' : 'Control+K',
  );
  await expect(
    page.getByRole('dialog', { name: 'Busca rápida do MF' }),
  ).toBeVisible();
  await page.getByLabel('Buscar no MF').fill('Agenda');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/agenda/, { timeout: 10_000 });

  const privacyBefore = await page
    .locator('html')
    .getAttribute('data-mf-private');
  await page.keyboard.press('Alt+P');
  await expect
    .poll(() => page.locator('html').getAttribute('data-mf-private'))
    .not.toBe(privacyBefore);

  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+K' : 'Control+K',
  );
  await page.getByLabel('Buscar no MF').fill('Preferências');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: /Preferências/i }),
  ).toBeVisible();
  await expect(page.getByText('Tutoriais e onboarding')).toBeVisible();
  await expect(page.getByText('Seus dados')).toBeVisible();
});
