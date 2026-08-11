import { test, expect } from '@playwright/test';

const baseURL = process.env.MF_E2E_BASE_URL;
const email = process.env.MF_E2E_EMAIL;
const password = process.env.MF_E2E_PASSWORD;

if (!baseURL || !email || !password) {
  throw new Error('MF_E2E_BASE_URL, MF_E2E_EMAIL e MF_E2E_PASSWORD são obrigatórios para o smoke autenticado.');
}

test.use({ baseURL, viewport: { width: 1440, height: 900 } });

async function dismissAutomaticTour(page) {
  const tour = page.getByRole('dialog', { name: /Tutorial:/ });
  try {
    await tour.waitFor({ state: 'visible', timeout: 1_500 });
  } catch {
    return;
  }
  await page.getByRole('button', { name: 'Pular tour' }).click();
  await page.getByRole('button', { name: 'Pular tudo' }).click();
  await expect(tour).toBeHidden();
}

test('login, busca, agenda, privacidade e preferências', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByLabel('E-mail').fill(email);

  await expect(page.getByText('Acesse sua conta')).toBeVisible({ timeout: 8_000 });
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/app(?:\/|$)/, { timeout: 15_000 });
  await dismissAutomaticTour(page);
  await expect(page.getByLabel('Navegação financeira')).toBeVisible();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('dialog', { name: 'Busca rápida do MF' })).toBeVisible();
  await page.getByLabel('Buscar no MF').fill('Agenda');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/agenda/, { timeout: 10_000 });

  const privacyBefore = await page.locator('html').getAttribute('data-mf-private');
  await page.keyboard.press('Alt+P');
  await expect.poll(() => page.locator('html').getAttribute('data-mf-private')).not.toBe(privacyBefore);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByLabel('Buscar no MF').fill('Preferências');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Preferências/i })).toBeVisible();
  await expect(page.getByText('Tutoriais e onboarding')).toBeVisible();
  await expect(page.getByText('Seus dados')).toBeVisible();
});
