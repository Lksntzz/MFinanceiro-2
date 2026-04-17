import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ImportedTransaction } from '../../../types';
import { getPdfBankParser, resolvePdfBank } from './index';
import { parseAmount, parsePdfDateToIso, normalizeHeader } from './utils';
import { PdfParserContext } from './types';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function inferCategoryFromStatement(description: string, type: 'income' | 'expense'): string {
  const text = normalizeHeader(description);

  if (/(rendimento|rendimentos|juros)/.test(text)) return 'Rendimentos';
  if (/(pixrecebido|recebido)/.test(text)) return 'Transferencia';
  if (/(pixenviado|enviado)/.test(text)) return 'Transferencia';
  if (/(dinheiroreservado|reservado|reserva)/.test(text)) return 'Reserva';
  if (/(uber|autopass|99|taxi|estacionamento|combustivel|posto)/.test(text)) return 'Transporte';
  if (/(ifood|pizzaria|esfiha|supermercado|mercado|food|coffee|padaria|doce|restaurante)/.test(text)) return 'Alimentacao';
  if (/(farmacia|clinica|hospital|medic)/.test(text)) return 'Saude';

  return type === 'income' ? 'Receita' : 'Despesa';
}

function generateId(prefix: string, index: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${index}`;
}

function normalizeBankLabel(bank: string): string {
  switch (bank) {
    case 'mercadopago': return 'Mercado Pago';
    case 'nubank': return 'Nubank';
    case 'inter': return 'Inter';
    case 'bradesco': return 'Bradesco';
    case 'santander': return 'Santander';
    case 'c6bank': return 'C6 Bank';
    default: return 'Importado PDF';
  }
}

export async function parsePdfStatement(file: File, selectedBank: string): Promise<ImportedTransaction[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const lines: string[] = [];
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; text: string }[]>();

    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], text: item.str });
      fullText += ` ${item.str}`;
    }

    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = rows.get(y)!
        .sort((a, b) => a.x - b.x)
        .map(part => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) lines.push(line);
    }
  }

  const bank = resolvePdfBank(selectedBank, fullText);
  const parser = getPdfBankParser(bank);
  const context: PdfParserContext = {
    lines,
    fullText,
    normalize: normalizeHeader,
    parseAmount,
  };
  const extracted = parser(context);
  const bankSource = normalizeBankLabel(bank);

  return extracted.map((entry, index) => {
    const amount = Math.abs(entry.signedAmount);
    const type: 'income' | 'expense' = entry.signedAmount >= 0 ? 'income' : 'expense';
    const description = entry.description || 'Sem descricao';
    const status: ImportedTransaction['status'] = description !== 'Sem descricao' && amount > 0 ? 'ready' : 'error';
    return {
      id: generateId(`pdf-${bank}`, index),
      date: parsePdfDateToIso(entry.rawDate),
      description,
      amount,
      source_id: entry.sourceId,
      type,
      category: inferCategoryFromStatement(description, type),
      status,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : (status === 'ready' ? 0.9 : 0.35),
      original_description: description,
      bank_source: bankSource,
      running_balance: entry.runningBalance
    };
  });
}
