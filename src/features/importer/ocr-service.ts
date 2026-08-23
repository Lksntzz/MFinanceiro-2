import { supabase } from '../../lib/supabase';
import type { ImportedTransaction } from '../../types';
import { hashImportFile, inferFileMimeType } from './import-file';
import { generateTransactionId } from './statement-parser-utils';

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function extractStatementWithOcr(
  file: File,
  accountId: string,
): Promise<{
  extractionId: string;
  transactions: ImportedTransaction[];
  documentConfidence: number;
  statementBalance?: number;
  warnings: string[];
}> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user)
    throw new Error('Sua sessão expirou antes do OCR. Entre novamente.');
  if (!accountId)
    throw new Error('Selecione a conta financeira antes de usar o OCR.');

  const extractionId = crypto.randomUUID();
  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-180) || 'extrato';
  const storagePath = `${userData.user.id}/${extractionId}/${safeName}`;
  const fileHash = await hashImportFile(file);
  const sourceMimeType = inferFileMimeType(file);
  const { error: uploadError } = await supabase.storage
    .from('mf-import-documents')
    .upload(storagePath, file, { upsert: false, contentType: sourceMimeType });
  if (uploadError) throw uploadError;

  const { data: extraction, error: extractionError } = await supabase
    .from('mf_document_extractions')
    .insert({
      id: extractionId,
      user_id: userData.user.id,
      account_id: accountId,
      source_file_path: storagePath,
      source_file_name: file.name,
      source_mime_type: sourceMimeType,
      source_file_size: file.size,
      source_file_hash: fileHash || null,
      document_type: 'statement',
      status: 'uploaded',
    })
    .select('id')
    .single();
  if (extractionError || !extraction) {
    await supabase.storage.from('mf-import-documents').remove([storagePath]);
    throw (
      extractionError ||
      new Error('Não foi possível registrar o documento para OCR.')
    );
  }

  const { data, error: functionError } = await supabase.functions.invoke(
    'statement-ocr',
    {
      body: { extractionId: extraction.id },
    },
  );
  if (functionError) throw functionError;
  if (data?.error) throw new Error(String(data.error));

  let statementBalance = optionalFiniteNumber(data?.statementBalance);
  if (statementBalance === undefined) {
    const { data: extractionResult } = await supabase
      .from('mf_document_extractions')
      .select('result_metadata')
      .eq('id', extraction.id)
      .eq('user_id', userData.user.id)
      .single();
    const metadata = extractionResult?.result_metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      statementBalance = optionalFiniteNumber(
        (metadata as Record<string, unknown>).statement_balance,
      );
    }
  }

  const rawItems = Array.isArray(data?.items)
    ? (data.items as Array<Record<string, unknown>>)
    : [];
  const transactions = rawItems.map((item, index) => {
    const signedAmount = Number(item.signed_amount || 0);
    const type: ImportedTransaction['type'] =
      item.transaction_type === 'income' || signedAmount > 0
        ? 'income'
        : 'expense';
    const confidence = Math.min(
      1,
      Math.max(0, Number(item.overall_confidence || 0)),
    );
    const description =
      String(item.description || '').trim() || 'Sem descricao';
    const date = String(item.transaction_date || '');
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      description !== 'Sem descricao' &&
      Math.abs(signedAmount) > 0;
    return {
      id: generateTransactionId('ocr', index),
      extraction_item_id: String(item.id || '') || undefined,
      date: date || new Date().toISOString().slice(0, 10),
      description,
      amount: Math.abs(signedAmount),
      source_id: String(item.external_id || '') || undefined,
      type,
      category: String(item.category_name || 'Geral'),
      status:
        valid && confidence >= 0.85 ? 'ready' : valid ? 'pending' : 'error',
      confidence,
      original_description: description,
      bank_source: String(item.source_name || 'OCR/IA'),
      running_balance: optionalFiniteNumber(item.running_balance),
      source: 'ocr_ai',
      review_status: 'pending',
    } satisfies ImportedTransaction;
  });

  return {
    extractionId: extraction.id,
    transactions,
    documentConfidence: Math.min(
      1,
      Math.max(0, Number(data?.documentConfidence || 0)),
    ),
    statementBalance,
    warnings: Array.isArray(data?.warnings)
      ? data.warnings.map(String)
      : [
          'Revise as linhas e confirme manualmente os itens com confiança abaixo de 85%.',
        ],
  };
}
