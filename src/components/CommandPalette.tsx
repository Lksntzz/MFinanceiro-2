import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CreditCard, Landmark, Plus, Search, Settings, Sparkles, Tags, Upload, Wallet } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';

import { supabase } from '../lib/supabase';

type CommandItem = {
  id: string;
  label: string;
  description: string;
  keywords: string;
  path: string;
  icon: React.ComponentType<{ size?: number }>;
};

const BASE_COMMANDS: CommandItem[] = [
  { id: 'launch', label: 'Lançar movimentação', description: 'Registrar uma entrada ou saída', keywords: 'lançar despesa receita entrada saída novo', path: '/app/lancar', icon: Plus },
  { id: 'movements', label: 'Movimentações', description: 'Abrir histórico financeiro', keywords: 'histórico lançamentos movimentações', path: '/app/movimentacoes', icon: Wallet },
  { id: 'import', label: 'Importar extrato', description: 'Trazer lançamentos do banco', keywords: 'importar extrato arquivo banco', path: '/app/movimentacoes/importar', icon: Upload },
  { id: 'agenda', label: 'Agenda Financeira', description: 'Ver próximos compromissos', keywords: 'agenda calendário vencimento contas', path: '/app/agenda', icon: CalendarDays },
  { id: 'recurrences', label: 'Recorrências', description: 'Contas fixas e assinaturas', keywords: 'recorrência assinatura aluguel mensal', path: '/app/agenda/recorrencias', icon: CalendarDays },
  { id: 'accounts', label: 'Contas financeiras', description: 'Saldos e conta principal', keywords: 'conta saldo banco carteira', path: '/app/planejamento/contas', icon: Wallet },
  { id: 'categories', label: 'Categorias', description: 'Organizar finalidade dos lançamentos', keywords: 'categoria classificação gasto', path: '/app/planejamento/categorias', icon: Tags },
  { id: 'cards', label: 'Cartões e parcelas', description: 'Limites, faturas e parcelamentos', keywords: 'cartão fatura parcela crédito', path: '/app/planejamento/cartoes', icon: CreditCard },
  { id: 'investments', label: 'Investimentos', description: 'Abrir carteira patrimonial', keywords: 'investimentos carteira patrimônio aporte', path: '/app/investimentos', icon: Landmark },
  { id: 'insights', label: 'Insights', description: 'Interpretar seus números', keywords: 'insights análise alerta recomendação', path: '/app/analises/insights', icon: Sparkles },
  { id: 'preferences', label: 'Preferências', description: 'Personalização, privacidade e notificações', keywords: 'preferências configurações privacidade tutorial notificações', path: '#preferences', icon: Settings },
];

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default function CommandPalette({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dynamicCommands, setDynamicCommands] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mf:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mf:open-command-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    let active = true;
    void Promise.all([
      supabase.from('mf_account_balances').select('id,name').eq('user_id', userId).eq('is_active', true).limit(20),
      supabase.from('mf_credit_cards').select('id,name').eq('user_id', userId).limit(20),
    ]).then(([accountsResult, cardsResult]) => {
      if (!active) return;
      const accountCommands = (accountsResult.data || []).map((item: any) => ({
        id: `account:${item.id}`, label: item.name || 'Conta financeira', description: 'Abrir em Contas financeiras', keywords: `conta banco saldo ${item.name || ''}`, path: '/app/planejamento/contas', icon: Wallet,
      }));
      const cardCommands = (cardsResult.data || []).map((item: any) => ({
        id: `card:${item.id}`, label: item.name || 'Cartão', description: 'Abrir em Cartões e parcelas', keywords: `cartão fatura limite ${item.name || ''}`, path: '/app/planejamento/cartoes', icon: CreditCard,
      }));
      setDynamicCommands([...accountCommands, ...cardCommands]);
    }).catch(() => setDynamicCommands([]));
    return () => { active = false; };
  }, [open, userId]);

  const commands = useMemo(() => {
    const search = normalize(query);
    const all = [...BASE_COMMANDS, ...dynamicCommands];
    if (!search) return all.slice(0, 12);
    return all.filter((item) => normalize(`${item.label} ${item.description} ${item.keywords}`).includes(search)).slice(0, 14);
  }, [dynamicCommands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, commands.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function choose(item: CommandItem) {
    setOpen(false);
    if (item.path === '#preferences') {
      window.dispatchEvent(new Event('mf:open-preferences'));
      return;
    }
    navigate(item.path);
  }

  function handlePaletteKeyDown(event: React.KeyboardEvent) {
    if (!commands.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % commands.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + commands.length) % commands.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(commands[activeIndex] || commands[0]);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mf-command-backdrop" role="dialog" aria-modal="true" aria-label="Busca rápida do MF" onKeyDown={handlePaletteKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="mf-command-palette">
        <div className="mf-command-search"><Search size={18} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ferramenta ou ação…" aria-label="Buscar no MF" aria-controls="mf-command-results" aria-activedescendant={commands[activeIndex] ? `mf-command-${commands[activeIndex].id}` : undefined} /><kbd>Esc</kbd></div>
        <div id="mf-command-results" className="mf-command-results" role="listbox">
          {commands.map((item, index) => {
            const Icon = item.icon;
            return <button id={`mf-command-${item.id}`} ref={(element) => { resultRefs.current[index] = element; }} key={item.id} type="button" onClick={() => choose(item)} onMouseEnter={() => setActiveIndex(index)} role="option" aria-selected={activeIndex === index} className={activeIndex === index ? 'active' : ''}>
              <span className="mf-command-icon"><Icon size={16} /></span>
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </button>;
          })}
          {!commands.length && <p className="mf-command-empty">Nenhum resultado. Tente “lançar”, “cartão”, “agenda” ou “importar”.</p>}
        </div>
        <footer><span><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> abre esta busca</span><span>↑ ↓ para escolher · Enter para abrir</span></footer>
      </section>
    </div>,
    document.body,
  );
}
