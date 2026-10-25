import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCsvTransactions } from '../src/features/importer/csv-parser';
import { normalizeImportedTransactions } from '../src/features/importer/import-file';
import {
  toggleImportedTransaction,
  updateImportedTransaction,
} from '../src/features/importer/import-review';
import {
  isValidStatementDate,
  parseStatementDate,
} from '../src/features/importer/statement-parser-utils';
import { parsePdfDateToIso } from '../src/lib/import-parsers/pdf/utils';

const csv =
  'Data;Descricao;Valor\n14/08/2026;PIX recebido;100,00\n;SEM DATA;50,00\n10/25/2026;DATA USA;20,00\n31/02/2026;DIA INEXISTENTE;10,00\n';

describe('datas na importação de extratos', () => {
  it('data válida continua funcionando', () => {
    assert.equal(parseStatementDate('14/08/2026').slice(0, 10), '2026-08-14');
    assert.equal(parseStatementDate('2026-08-14').slice(0, 10), '2026-08-14');
  });

  it('data ausente ou impossível não vira hoje nem "rola" o calendário', () => {
    for (const raw of [
      '',
      'abc',
      '10/25/2026',
      '31/02/2026',
      '00/00/2026',
      '12',
    ])
      assert.equal(parseStatementDate(raw), '', raw);
    assert.equal(isValidStatementDate('2026-02-31'), false);
    assert.equal(isValidStatementDate('2026-08-14T12:00:00.000Z'), true);
  });

  it('linhas com data inválida entram como erro, sem data inventada', () => {
    const rows = normalizeImportedTransactions(
      parseCsvTransactions(csv, 'auto'),
    );
    assert.equal(rows[0].status, 'ready');
    for (const row of rows.slice(1)) {
      assert.equal(row.status, 'error', row.description);
      assert.equal(row.date, '', row.description);
    }
  });

  it('linha sem data não pode ser aprovada até a data ser corrigida', () => {
    const rows = normalizeImportedTransactions(
      parseCsvTransactions(csv, 'auto'),
    );
    const bad = rows[1];
    assert.equal(toggleImportedTransaction(rows, bad.id)[1].status, 'error');
    const fixed = updateImportedTransaction(rows, bad.id, {
      date: '2026-08-15',
    });
    assert.equal(fixed[1].status, 'ready');
  });

  it('editar a descrição não derruba uma linha válida para erro', () => {
    const rows = normalizeImportedTransactions(
      parseCsvTransactions(csv, 'auto'),
    );
    const edited = updateImportedTransaction(rows, rows[0].id, {
      description: 'PIX Maria',
    });
    assert.equal(edited[0].status, 'ready');
  });

  it('PDF: data impossível volta vazia e dia/mês sem ano não cai no futuro', () => {
    assert.equal(parsePdfDateToIso('31/02/2026'), '');
    assert.equal(parsePdfDateToIso('sem data'), '');
    assert.equal(parsePdfDateToIso('14/08/2026').slice(0, 10), '2026-08-14');
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 86_400_000);
    const dd = String(future.getUTCDate()).padStart(2, '0');
    const mm = String(future.getUTCMonth() + 1).padStart(2, '0');
    const iso = parsePdfDateToIso(`${dd}/${mm}`);
    assert.ok(new Date(iso).getTime() <= now.getTime() + 7 * 86_400_000);
  });
});
