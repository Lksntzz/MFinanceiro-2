import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, Download, EyeOff, LayoutDashboard, RotateCcw, Settings, ShieldCheck, Sparkles, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useApp } from '../context/AppContext';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { exportFinancialData } from '../lib/export-financial-data';
import { loadUserActivity, type ActivityEvent } from '../lib/activity-log';
import { HOME_WIDGET_OPTIONS, loadUserPreferences, type HomeWidgetId, type NotificationPreferenceKey } from '../lib/user-preferences';

function formatActivityDate(value: string) {
  try { return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; }
}

export default function PreferencesCenter({ userId }: { userId: string }) {
  const { isPrivate, setIsPrivate } = useApp();
  const { preferences, setPreferences } = useUserPreferences(userId);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const show = () => {
      setPreferences(loadUserPreferences(userId));
      setOpen(true);
    };
    window.addEventListener('mf:open-preferences', show);
    return () => window.removeEventListener('mf:open-preferences', show);
  }, [setPreferences, userId]);

  useEffect(() => {
    if (!open) return;
    void loadUserActivity(userId).then(setActivity);
    const onActivity = () => void loadUserActivity(userId).then(setActivity);
    window.addEventListener('mf:activity-recorded', onActivity);
    return () => window.removeEventListener('mf:activity-recorded', onActivity);
  }, [open, userId]);

  useEffect(() => {
    document.documentElement.classList.toggle('mf-user-reduced-motion', preferences.reducedMotion);
    document.documentElement.classList.toggle('mf-user-high-contrast', preferences.highContrast);
    document.documentElement.classList.toggle('mf-compact-home', preferences.compactHome);
  }, [preferences.compactHome, preferences.highContrast, preferences.reducedMotion]);

  const selectedCount = preferences.homeWidgets.length;
  const notificationRows = useMemo<Array<{ key: NotificationPreferenceKey; label: string; description: string }>>(() => [
    { key: 'commitments', label: 'Compromissos', description: 'Vencidas, vencendo hoje e próximas contas.' },
    { key: 'cards', label: 'Cartões', description: 'Uso elevado de limite e atenção com faturas.' },
    { key: 'quality', label: 'Qualidade dos dados', description: 'Cadastros incompletos e possíveis inconsistências.' },
    { key: 'release', label: 'Novidades do MF', description: 'Comunicados de atualização do produto.' },
  ], []);

  function toggleHomeWidget(id: HomeWidgetId) {
    const active = preferences.homeWidgets.includes(id);
    if (active && selectedCount <= 3) {
      setMessage('Mantenha pelo menos três blocos na Início para preservar uma visão financeira útil.');
      return;
    }
    if (!active && selectedCount >= 5) {
      setMessage('A Início aceita até cinco blocos. Desmarque um bloco antes de escolher outro.');
      return;
    }
    setMessage(null);
    setPreferences({ ...preferences, homeWidgets: active ? preferences.homeWidgets.filter((item) => item !== id) : [...preferences.homeWidgets, id] });
  }

  function resetTours() {
    try {
      const suffix = `:${userId}`;
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith('mf-tour:') && (key.endsWith(suffix) || key === `mf-tour:all-skipped:${userId}`)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch { /* optional */ }
    setPreferences({ ...preferences, toursAutoStart: true });
    setMessage('Tours reativados. Eles voltam a aparecer apenas nas ferramentas ainda não concluídas.');
  }

  async function exportData() {
    setExporting(true); setMessage(null);
    try { await exportFinancialData(userId); setMessage('Exportação preparada. O arquivo contém os dados estruturados da sua conta.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível exportar os dados.'); }
    finally { setExporting(false); }
  }

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="mf-preferences-backdrop" role="dialog" aria-modal="true" aria-labelledby="mf-preferences-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="mf-preferences-panel">
        <header><div><p>MF Financeiro</p><h2 id="mf-preferences-title"><Settings size={19} />Preferências</h2><span>Escolha como o MF orienta, notifica e apresenta seus dados.</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Fechar preferências"><X size={18} /></button></header>
        <div className="mf-preferences-scroll">
          {message && <div className="mf-preferences-message" role="status">{message}</div>}
          <section className="mf-preference-section"><div className="mf-preference-title"><LayoutDashboard size={17} /><div><strong>Início</strong><small>Escolha de três a cinco blocos que merecem prioridade.</small></div></div><div className="mf-home-widget-options">{HOME_WIDGET_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={preferences.homeWidgets.includes(item.id)} onChange={() => toggleHomeWidget(item.id)} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div><label className="mf-setting-row"><span><strong>Modo compacto</strong><small>Reduz a altura dos cards na Início.</small></span><input type="checkbox" checked={preferences.compactHome} onChange={(event) => setPreferences({ ...preferences, compactHome: event.target.checked })} /></label></section>
          <section className="mf-preference-section"><div className="mf-preference-title"><Bell size={17} /><div><strong>Notificações</strong><small>Menos volume, mais relevância.</small></div></div>{notificationRows.map((item) => <label className="mf-setting-row" key={item.key}><span><strong>{item.label}</strong><small>{item.description}</small></span><input type="checkbox" checked={preferences.notifications[item.key]} onChange={(event) => setPreferences({ ...preferences, notifications: { ...preferences.notifications, [item.key]: event.target.checked } })} /></label>)}</section>
          <section className="mf-preference-section"><div className="mf-preference-title"><Sparkles size={17} /><div><strong>Tutoriais e onboarding</strong><small>Atualizações do sistema não reiniciam seus tours.</small></div></div><label className="mf-setting-row"><span><strong>Abrir tours automaticamente</strong><small>Somente em ferramentas que você ainda não concluiu ou pulou.</small></span><input type="checkbox" checked={preferences.toursAutoStart} onChange={(event) => setPreferences({ ...preferences, toursAutoStart: event.target.checked })} /></label><button type="button" className="mf-preference-secondary" onClick={resetTours}><RotateCcw size={14} />Reativar tours</button></section>
          <section className="mf-preference-section"><div className="mf-preference-title"><EyeOff size={17} /><div><strong>Privacidade e acessibilidade</strong><small>Controle visual sem alterar os dados.</small></div></div><label className="mf-setting-row"><span><strong>Ocultar valores agora</strong><small>Atalho rápido para uso em público ou compartilhamento de tela.</small></span><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} /></label><label className="mf-setting-row"><span><strong>Privacidade por padrão</strong><small>Preferência usada ao abrir novas sessões.</small></span><input type="checkbox" checked={preferences.privacyDefault} onChange={(event) => setPreferences({ ...preferences, privacyDefault: event.target.checked })} /></label><label className="mf-setting-row"><span><strong>Reduzir movimento</strong><small>Desativa animações não essenciais dentro do MF.</small></span><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => setPreferences({ ...preferences, reducedMotion: event.target.checked })} /></label><label className="mf-setting-row"><span><strong>Contraste reforçado</strong><small>Aumenta contraste de bordas, textos auxiliares e foco.</small></span><input type="checkbox" checked={preferences.highContrast} onChange={(event) => setPreferences({ ...preferences, highContrast: event.target.checked })} /></label></section>
          <section className="mf-preference-section"><div className="mf-preference-title"><ShieldCheck size={17} /><div><strong>Seus dados</strong><small>Portabilidade sem incluir arquivos privados automaticamente.</small></div></div><button type="button" className="mf-preference-primary" onClick={() => void exportData()} disabled={exporting}><Download size={15} />{exporting ? 'Preparando exportação…' : 'Exportar meus dados'}</button></section>
          <section className="mf-preference-section"><div className="mf-preference-title"><Activity size={17} /><div><strong>Atividade recente</strong><small>Registro de ações importantes para conferência.</small></div></div><div className="mf-activity-list">{activity.length ? activity.slice(0, 12).map((item) => <article key={item.id}><span><strong>{item.summary}</strong><small>{item.entity_type} · {formatActivityDate(item.created_at)}</small></span></article>) : <p>Nenhuma alteração relevante registrada neste dispositivo ainda.</p>}</div></section>
        </div>
      </section>
    </div>, document.body,
  );
}
