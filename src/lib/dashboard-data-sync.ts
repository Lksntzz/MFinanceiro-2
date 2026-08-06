import { supabase } from './supabase';

declare global {
  interface Window {
    __mfDashboardDataSyncInstalled?: boolean;
  }
}

const TABLES_TO_SYNC = [
  'mf_credit_cards',
  'mf_card_installments',
  'mf_user_settings',
  'mf_fixed_bills',
  'mf_daily_bills',
];

if (typeof window !== 'undefined' && !window.__mfDashboardDataSyncInstalled) {
  window.__mfDashboardDataSyncInstalled = true;

  const client = supabase as any;
  const originalChannel = client.channel.bind(client);

  client.channel = (name: string, options?: any) => {
    const channel = originalChannel(name, options);

    if (!String(name).startsWith('dashboard-')) return channel;

    const originalOn = channel.on.bind(channel);
    let expanded = false;

    channel.on = (type: string, filter: any, callback: (...args: any[]) => void) => {
      const result = originalOn(type, filter, callback);

      if (
        !expanded &&
        type === 'postgres_changes' &&
        filter?.schema === 'public' &&
        filter?.table === 'mf_finance_ledger_entries'
      ) {
        expanded = true;
        TABLES_TO_SYNC.forEach((table) => {
          originalOn(type, { ...filter, table }, callback);
        });
      }

      return result;
    };

    return channel;
  };
}

export {};
