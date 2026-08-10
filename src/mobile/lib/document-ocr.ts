import { supabase } from '../../lib/supabase';

export type DocumentOcrMetadata = {
  extraction_kind?: string;
  document_kind?: string;
  merchant_name?: string | null;
  description?: string | null;
  amount?: number | null;
  due_date?: string | null;
  document_date?: string | null;
  reference_period?: string | null;
  payment_status?: 'pending' | 'paid' | 'unknown' | string;
  category_hint?: string | null;
  field_confidence?: Record<string, number>;
  warnings?: string[];
  requires_human_review?: boolean;
};

export type DocumentOcrResult = {
  extractionId: string;
  documentConfidence: number;
  metadata: DocumentOcrMetadata;
};

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_OCR_FILE_SIZE = 8 * 1024 * 1024;

export const DOCUMENT_OCR_ENABLED = import.meta.env.VITE_DOCUMENT_OCR_ENABLED === 'true';

function safeFileName(name: string) {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 140) || 'documento';
}

function normalizedMetadata(value: unknown): DocumentOcrMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as DocumentOcrMetadata;
}

export async function analyzeDocumentWithOcr(options: {
  file: File;
  userId: string;
  accountId?: string | null;
  captureSource: string;
}): Promise<DocumentOcrResult | null> {
  if (!DOCUMENT_OCR_ENABLED) return null;

  const { file, userId, accountId, captureSource } = options;
  if (!ALLOWED_MIME_TYPES.has(file.type)) throw new Error('OCR disponível apenas para PDF, JPEG, PNG ou WebP.');
  if (file.size < 1 || file.size > MAX_OCR_FILE_SIZE) throw new Error('O OCR visual aceita documentos de até 8 MB. Você ainda pode revisar este arquivo manualmente no MF Scan.');

  const objectPath = `${userId}/mobile-document-ocr/${crypto.randomUUID()}-${safeFileName(file.name || 'documento')}`;
  let uploaded = false;
  let extractionId = '';

  try {
    const { error: uploadError } = await supabase.storage
      .from('mf-import-documents')
      .upload(objectPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    uploaded = true;

    const { data: extraction, error: insertError } = await supabase
      .from('mf_document_extractions')
      .insert({
        user_id: userId,
        account_id: accountId || null,
        source_file_path: objectPath,
        source_file_name: (file.name || 'documento').slice(0, 240),
        source_mime_type: file.type,
        source_file_size: file.size,
        document_type: 'other',
        status: 'uploaded',
        result_metadata: {
          uploaded_from: captureSource,
          extraction_kind: 'mobile_document',
          requires_human_review: true,
        },
      })
      .select('id')
      .single();
    if (insertError || !extraction?.id) throw insertError || new Error('Não foi possível preparar o documento para OCR.');
    extractionId = String(extraction.id);

    const { data, error: invokeError } = await supabase.functions.invoke('document-ocr', {
      body: { extractionId },
    });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(String(data.error));

    const metadata = normalizedMetadata(data?.metadata);
    return {
      extractionId,
      documentConfidence: Math.max(0, Math.min(1, Number(data?.documentConfidence || 0))),
      metadata,
    };
  } catch (error) {
    if (extractionId) {
      await supabase
        .from('mf_document_extractions')
        .update({
          status: 'failed',
          error_message: (error instanceof Error ? error.message : 'Falha no OCR documental.').slice(0, 1000),
          completed_at: new Date().toISOString(),
        })
        .eq('id', extractionId)
        .eq('user_id', userId);
    } else if (uploaded) {
      await supabase.storage.from('mf-import-documents').remove([objectPath]);
    }
    throw error;
  }
}

export async function completeDocumentOcrExtraction(extractionId: string, userId: string) {
  if (!extractionId) return;
  const { error } = await supabase
    .from('mf_document_extractions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', extractionId)
    .eq('user_id', userId);
  if (error) throw error;
}
