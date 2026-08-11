import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import {
  createSupabaseMockState,
  E2E_USERS,
  installSupabaseMock,
  type SupabaseMockState,
} from './support/supabase-mock';

const statementFixture = fileURLToPath(new URL('./fixtures/statement.csv', import.meta.url));

let state: SupabaseMockState;

async function loginAs(page: Page, email: string, password: string) {
  await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app(?:$|\/)/);
}

async function openMovement(page: Page, description: string) {
  const search = page.getByPlaceholder('Buscar lançamento, categoria ou valor');
  await search.fill(description);
  const group = page.getByRole('button').filter({ hasText: /1 lançamentos?/ }).first();
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  state = createSupabaseMockState();
  await installSupabaseMock(page, state);
  await page.goto('/');
});

test('autenticação preserva resposta genérica de acesso e entra com conta existente', async ({ page }) => {
  await page.getByRole('button', { name: 'Ainda não tenho acesso' }).click();
  await page.getByLabel('Nome').fill('Alice E2E');
  await page.getByLabel('E-mail').fill(E2E_USERS.alice.email);
  await page.getByRole('button', { name: 'Solicitar acesso' }).click();

  await expect(page.getByRole('heading', { name: 'Solicitação recebida' })).toBeVisible();
  await expect(page.getByText('Se o endereço estiver apto, o MF enviará as próximas instruções por e-mail.')).toBeVisible();
  await expect(page.getByText(/conta encontrada/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Voltar para entrar' }).click();
  await loginAs(page, E2E_USERS.alice.email, E2E_USERS.alice.password);
  await expect(page.getByRole('heading', { name: 'Workspace Alice' })).toBeVisible();
});

test('lançamento manual percorre a UI, persiste e reaparece no ledger sem F5', async ({ page }) => {
  await loginAs(page, E2E_USERS.alice.email, E2E_USERS.alice.password);
  await page.getByRole('button', { name: 'Lançar' }).click();

  await expect(page.getByRole('heading', { name: 'Lançar movimentação' })).toBeVisible();
  await page.getByLabel('Valor').fill('48.90');
  await page.getByLabel('Conta').selectOption('acc-alice');
  await page.getByLabel('Categoria').selectOption({ label: 'Alimentação' });
  await page.getByLabel('Descrição').fill('Mercado E2E');
  await page.getByRole('button', { name: 'Salvar lançamento' }).click();

  await expect(page.getByText('Lançamento salvo.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/movimentacoes$/);
  await openMovement(page, 'Mercado E2E');

  const createCall = state.rpcCalls.find((call) => call.name === 'mf_create_finance_entry_v3');
  expect(createCall?.email).toBe(E2E_USERS.alice.email);
  expect(createCall?.body.p_description).toBe('Mercado E2E');
  expect(Number(createCall?.body.p_amount)).toBe(48.9);
});

test('importação CSV registra lote, expõe conciliação e desfaz o lote preservando auditoria', async ({ page }) => {
  await loginAs(page, E2E_USERS.alice.email, E2E_USERS.alice.password);
  await page.goto('/app/movimentacoes/importar');

  await expect(page.getByRole('heading', { name: 'Importar Extratos' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(statementFixture);
  await expect(page.getByText('Conta financeira do extrato')).toBeVisible();

  await page.getByLabel('Conta financeira do extrato').selectOption('acc-alice');
  await page.getByLabel(/Revisei os itens selecionados/i).check();
  const confirmImport = page.getByRole('button', { name: /Confirmar Importacao/i });
  await expect(confirmImport).toBeEnabled();
  await confirmImport.click();

  await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
  await expect(page.getByText('2 lançamento(s) novo(s) foram adicionados ao ledger.')).toBeVisible();

  const importCall = state.rpcCalls.find((call) => call.name === 'mf_commit_statement_import_v2');
  expect(importCall?.email).toBe(E2E_USERS.alice.email);
  expect(importCall?.body.p_entries).toHaveLength(2);
  expect(importCall?.body.p_balance_mode).toBe('keep');

  await page.getByRole('button', { name: 'Voltar às movimentações' }).click();
  await openMovement(page, 'Padaria E2E');

  await page.goto('/app/movimentacoes/lotes');
  await expect(page.getByRole('heading', { name: 'Lotes importados' })).toBeVisible();
  await page.getByRole('button', { name: /statement\.csv/i }).click();
  await expect(page.getByText('Padaria E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Recebimento E2E', { exact: true })).toBeVisible();

  page.once('dialog', async (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Desfazer lote/i }).click();
  await expect(page.getByText('lote desfeito', { exact: true })).toBeVisible();
  await expect(page.getByText(/Desfeito em/)).toBeVisible();

  await page.goto('/app/movimentacoes');
  await page.getByPlaceholder('Buscar lançamento, categoria ou valor').fill('Padaria E2E');
  await expect(page.getByText('Nenhum lançamento encontrado.')).toBeVisible();
});

test('logout e troca de usuário não reutilizam o ledger da sessão anterior', async ({ page }) => {
  await loginAs(page, E2E_USERS.alice.email, E2E_USERS.alice.password);
  await page.goto('/app/movimentacoes');
  await openMovement(page, 'Exclusivo Alice');

  await page.getByTitle('Sair').click();
  await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible();

  await loginAs(page, E2E_USERS.bruno.email, E2E_USERS.bruno.password);
  await expect(page.getByRole('heading', { name: 'Workspace Bruno' })).toBeVisible();
  await page.goto('/app/movimentacoes');

  const search = page.getByPlaceholder('Buscar lançamento, categoria ou valor');
  await search.fill('Exclusivo Alice');
  await expect(page.getByText('Nenhum lançamento encontrado.')).toBeVisible();

  await search.fill('Exclusivo Bruno');
  const group = page.getByRole('button').filter({ hasText: /1 lançamentos?/ }).first();
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.getByText('Exclusivo Bruno', { exact: true })).toBeVisible();
  await expect(page.getByText('Exclusivo Alice', { exact: true })).toHaveCount(0);

  const cacheKeys = await page.evaluate(() => Object.keys(window.sessionStorage).filter((key) => key.startsWith('mfinanceiro:ledger-page:v1:')));
  expect(cacheKeys.some((key) => key.endsWith('00000000-0000-4000-8000-0000000000a1'))).toBe(true);
  expect(cacheKeys.some((key) => key.endsWith('00000000-0000-4000-8000-0000000000b2'))).toBe(true);
});
