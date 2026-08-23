import type { DataQualityIssue } from '../../lib/financial-quality';
import type { UserPreferences } from '../../lib/user-preferences';
import type { CreditCard, FixedBill, Transaction } from '../../types';

const MAX_DISMISSED_ALERTS = 250;

export type DashboardNotification = {
  id: string;
  type: 'fixed' | 'card' | 'quality';
  title: string;
  amount: number;
  dueDate?: number;
  status: 'pending' | 'attention';
  detail?: string;
  actionPath?: string;
  actionLabel?: string;
  originalData: FixedBill | CreditCard | DataQualityIssue;
};

type NotificationInput = {
  fixedBills: FixedBill[];
  cards: CreditCard[];
  qualityIssues: DataQualityIssue[];
  dismissedIds: string[];
  monthKey: string;
  preferences: UserPreferences['notifications'];
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export function dismissedAlertsKey(userId: string): string {
  return `mf-dismissed-alerts:v1:${userId}`;
}

export function sanitizeDismissedAlerts(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === 'string')
        .slice(-MAX_DISMISSED_ALERTS)
    : [];
}

export function loadDismissedAlerts(
  userId: string,
  storage: StorageReader,
): string[] {
  try {
    return sanitizeDismissedAlerts(
      JSON.parse(storage.getItem(dismissedAlertsKey(userId)) || '[]'),
    );
  } catch {
    return [];
  }
}

export function persistDismissedAlerts(
  userId: string,
  ids: string[],
  storage: StorageWriter,
): void {
  try {
    storage.setItem(
      dismissedAlertsKey(userId),
      JSON.stringify(sanitizeDismissedAlerts(ids)),
    );
  } catch {
    // This preference is optional and must not block the dashboard.
  }
}

export function appendDismissedAlert(current: string[], id: string): string[] {
  return current.includes(id)
    ? current
    : sanitizeDismissedAlerts([...current, id]);
}

export function sortTransactionsByDateDesc(
  transactions: Transaction[],
): Transaction[] {
  return [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function buildDashboardNotifications({
  fixedBills,
  cards,
  qualityIssues,
  dismissedIds,
  monthKey,
  preferences,
}: NotificationInput): DashboardNotification[] {
  const dismissed = new Set(dismissedIds);
  const notifications: DashboardNotification[] = [];

  if (preferences.commitments) {
    fixedBills
      .filter((bill) => bill.status !== 'paid')
      .forEach((bill) => {
        const id = `fixed-${bill.id}-${monthKey}`;
        if (!dismissed.has(id)) {
          notifications.push({
            id,
            type: 'fixed',
            title: bill.name,
            amount: Number(bill.amount || 0),
            dueDate: Number(bill.due_day || 1),
            status: 'pending',
            originalData: bill,
          });
        }
      });
  }

  if (preferences.cards) {
    cards
      .filter(
        (card) =>
          Number(card.limit || 0) > 0 &&
          Number(card.used || 0) / Number(card.limit || 1) >= 0.8,
      )
      .forEach((card) => {
        const usagePercent = Math.round(
          (Number(card.used || 0) / Number(card.limit || 1)) * 100,
        );
        const id = `card-limit-${card.id}-${Math.floor(usagePercent / 5) * 5}`;
        if (!dismissed.has(id)) {
          notifications.push({
            id,
            type: 'card',
            title: `${card.name || 'Cartão'} · limite em atenção`,
            amount: Number(card.used || 0),
            dueDate: Number(card.due_day || 1),
            status: 'pending',
            detail: `${usagePercent}% do limite utilizado`,
            originalData: card,
          });
        }
      });
  }

  if (preferences.quality) {
    qualityIssues.slice(0, 3).forEach((issue) => {
      const id = `quality-${issue.id}-${issue.description}`;
      if (!dismissed.has(id)) {
        notifications.push({
          id,
          type: 'quality',
          title: issue.title,
          amount: 0,
          status: 'attention',
          detail: issue.description,
          actionPath: issue.actionPath,
          actionLabel: issue.actionLabel,
          originalData: issue,
        });
      }
    });
  }

  return notifications;
}
