import { supabase } from '../../lib/supabase';
import {
  ASSET_CLASS_LABELS,
  InvestmentAssetClass,
  InvestmentBetaOperation,
  normalizeSymbol,
  sanitizeNumber,
} from './investment-beta-domain';

export type BetaCloudOperationsResult = {
  available: boolean;
  operations: InvestmentBetaOperation[];
};

export type BetaCloudTargetsResult = {
  available: boolean;
  targets: Partial<Record<InvestmentAssetClass, number>>;
};

function relationUnavailable(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('mf_investment_beta_');
}

function rowToOperation(row: any): InvestmentBetaOperation {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: row.operation_type === 'sell' ? 'sell' : 'buy',
    assetClass: row.asset_class as InvestmentAssetClass,
    symbol: normalizeSymbol(String(row.symbol || '')),
    assetName: row.asset_name || undefined,
    institution: row.institution || undefined,
    accountId: row.account_id || undefined,
    accountName: row.account_name || undefined,
    date: String(row.operation_date || '').slice(0, 10),
    quantity: Math.max(0, sanitizeNumber(row.quantity)),
    unitPrice: Math.max(0, sanitizeNumber(row.unit_price)),
    fees: Math.max(0, sanitizeNumber(row.fees)),
    currency: String(row.currency || 'BRL'),
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

function operationToRow(operation: InvestmentBetaOperation) {
  return {
    id: operation.id,
    user_id: operation.userId,
    operation_type: operation.type,
    asset_class: operation.assetClass,
    symbol: normalizeSymbol(operation.symbol),
    asset_name: operation.assetName || null,
    institution: operation.institution || null,
    account_id: operation.accountId || null,
    account_name: operation.accountName || null,
    operation_date: operation.date,
    quantity: Math.max(0, sanitizeNumber(operation.quantity)),
    unit_price: Math.max(0, sanitizeNumber(operation.unitPrice)),
    fees: Math.max(0, sanitizeNumber(operation.fees)),
    currency: operation.currency || 'BRL',
    created_at: operation.createdAt,
    updated_at: new Date().toISOString(),
  };
}

export async function loadBetaCloudOperations(userId: string): Promise<BetaCloudOperationsResult> {
  const { data, error } = await supabase
    .from('mf_investment_beta_operations')
    .select('*')
    .eq('user_id', userId)
    .order('operation_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    if (relationUnavailable(error)) return { available: false, operations: [] };
    throw error;
  }

  return { available: true, operations: (data || []).map(rowToOperation) };
}

export async function saveBetaCloudOperation(operation: InvestmentBetaOperation): Promise<boolean> {
  const { error } = await supabase
    .from('mf_investment_beta_operations')
    .upsert(operationToRow(operation), { onConflict: 'id' });

  if (error) {
    if (relationUnavailable(error)) return false;
    throw error;
  }
  return true;
}

export async function deleteBetaCloudOperation(userId: string, operationId: string): Promise<boolean> {
  const { error } = await supabase
    .from('mf_investment_beta_operations')
    .delete()
    .eq('id', operationId)
    .eq('user_id', userId);

  if (error) {
    if (relationUnavailable(error)) return false;
    throw error;
  }
  return true;
}

export async function loadBetaCloudTargets(userId: string): Promise<BetaCloudTargetsResult> {
  const { data, error } = await supabase
    .from('mf_investment_beta_targets')
    .select('asset_class,target_percentage')
    .eq('user_id', userId);

  if (error) {
    if (relationUnavailable(error)) return { available: false, targets: {} };
    throw error;
  }

  const targets: Partial<Record<InvestmentAssetClass, number>> = {};
  for (const row of data || []) {
    const assetClass = row.asset_class as InvestmentAssetClass;
    if (!(assetClass in ASSET_CLASS_LABELS)) continue;
    targets[assetClass] = Math.max(0, sanitizeNumber(row.target_percentage));
  }
  return { available: true, targets };
}

export async function saveBetaCloudTargets(
  userId: string,
  targets: Partial<Record<InvestmentAssetClass, number>>,
): Promise<boolean> {
  const rows = (Object.keys(ASSET_CLASS_LABELS) as InvestmentAssetClass[]).map((assetClass) => ({
    user_id: userId,
    asset_class: assetClass,
    target_percentage: Math.min(100, Math.max(0, sanitizeNumber(targets[assetClass]))),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('mf_investment_beta_targets')
    .upsert(rows, { onConflict: 'user_id,asset_class' });

  if (error) {
    if (relationUnavailable(error)) return false;
    throw error;
  }
  return true;
}
