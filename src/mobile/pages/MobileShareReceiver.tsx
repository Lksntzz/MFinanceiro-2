import React, { useEffect, useMemo, useState } from 'react';
import { FileImage, FileText, Loader2, Share2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';

import { supabase } from '../../lib/supabase';
import type { FinancialAccount, TransactionCategory } from '../../types';
import { MOBILE_ROUTES } from '../routes';
import { getMobileSharedPayload, removeMobileSharedPayload, sharedFileToFile, type MobileSharedPayload } from '../lib/mobile-share-store';
import MobileScan from './MobileScan';
import './mobile-share.css';

type MobileShareReceiverProps = {
  userId: string;
};

export default function MobileShareReceiver({ userId }: MobileShareReceiverProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const shareId = params.get('id') || '';
  const shareError = params.get('error') || '';
  const [payload, setPayload] = useState<MobileSharedPayload | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (shareError) {
        if (active) {
          setError(shareError === 'too-large'
            ? 'O conteúdo compartilhado ultrapassa o limite de 20 MB.'
            : 'O compartilhamento chegou sem conteúdo utilizável.');
          setLoading(false);
        }
        return;
      }

      if (!shareId) {
        if (active) {
          setError('Não foi encontrado um conteúdo compartilhado para revisar.');
          setLoading(false);
        }
        return;
      }

      try {
        const [shared, accountsResult, categoriesResult] = await Promise.all([
          getMobileSharedPayload(shareId),
          supabase.from('mf_financial_accounts').select('*').eq('user_id', userId).order('is_default', { ascending: false }).order('name'),
          supabase.from('mf_transaction_categories').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
        ]);

        if (!shared) throw new Error('O compartilhamento expirou ou já foi removido deste aparelho.');
        if (accountsResult.error) throw accountsResult.error;
        if (categoriesResult.error) throw categoriesResult.error;

        if (!active) return;
        setPayload(shared);
        setAccounts((accountsResult.data || []) as FinancialAccount[]);
        setCategories((categoriesResult.data || []) as TransactionCategory[]);
      } catch (loadError: any) {
        if (active) setError(loadError?.message || 'Não foi possível preparar o conteúdo compartilhado.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [shareError, shareId, userId]);

  const sharedText = useMemo(() => {
    if (!payload) return '';
    return [payload.title, payload.text, payload.url].map((value) => value.trim()).filter(Boolean).join('\n');
  }, [payload]);

  const selectedFile = payload?.files[selectedFileIndex] ? sharedFileToFile(payload.files[selectedFileIndex]) : null;

  if (loading) {
    return <div className="mf-mobile-share-state"><Loader2 className="animate-spin" size={30} /><strong>Recebendo no MF</strong><span>Preparando o conteúdo compartilhado com segurança.</span></div>;
  }

  if (error || !payload) {
    return (
      <div className="mf-mobile-share-state">
        <Share2 size={32} />
        <strong>Não foi possível abrir o compartilhamento</strong>
        <span>{error || 'Tente compartilhar novamente para o MF Financeiro.'}</span>
        <button type="button" className="mf-mobile-primary-button" onClick={() => navigate(MOBILE_ROUTES.home)}>Abrir o MF</button>
      </div>
    );
  }

  if (payload.files.length > 1 && !selectedFile) {
    return null;
  }

  if (payload.files.length > 1) {
    return (
      <div className="mf-mobile-share-picker">
        <header>
          <span className="mf-mobile-eyebrow">Compartilhar para o MF</span>
          <h1>Qual documento revisar?</h1>
          <p>O MF processa um documento por vez para evitar misturar valores e vencimentos.</p>
        </header>
        <div className="mf-mobile-share-files">
          {payload.files.map((file, index) => (
            <button key={`${file.name}-${index}`} type="button" data-active={selectedFileIndex === index} onClick={() => setSelectedFileIndex(index)}>
              {file.type.startsWith('image/') ? <FileImage size={20} /> : <FileText size={20} />}
              <span><strong>{file.name || `Documento ${index + 1}`}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></span>
            </button>
          ))}
        </div>
        <button type="button" className="mf-mobile-primary-button" onClick={() => setSelectedFileIndex((value) => value)}>Revisar selecionado</button>
        <button type="button" className="mf-mobile-secondary-button" onClick={() => navigate(MOBILE_ROUTES.home)}>Cancelar</button>
      </div>
    );
  }

  return (
    <MobileScan
      userId={userId}
      accounts={accounts}
      categories={categories}
      onSaved={async () => {
        if (shareId) await removeMobileSharedPayload(shareId);
      }}
      initialFile={selectedFile}
      initialText={selectedFile ? '' : sharedText}
      captureSource="MF Share Mobile"
    />
  );
}
