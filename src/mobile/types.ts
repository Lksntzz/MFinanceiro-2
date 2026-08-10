export type MobileCaptureKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'card_purchase'
  | 'scan';

export type MobileReviewConfidence = 'high' | 'medium' | 'low';

export type MobileScannedDraft = {
  amount?: number;
  description?: string;
  merchant?: string;
  category?: string;
  dueDate?: string;
  documentKind?: string;
  barcode?: string;
  pixPayload?: string;
  confidence: MobileReviewConfidence;
};

export type MobileNavItem = {
  key: 'home' | 'transactions' | 'cards' | 'more';
  label: string;
  path: string;
};
