import type { MobileScannedDraft } from '../types';

export type FinancialCodeKind = 'pix' | 'boleto' | 'collection' | 'unknown';

export type ParsedFinancialCode = {
  kind: FinancialCodeKind;
  label: string;
  rawValue: string;
  draft: MobileScannedDraft;
  dynamicPix?: boolean;
  pixKey?: string;
  pixUrl?: string;
  txid?: string;
  bankCode?: string;
};

type TlvMap = Record<string, string>;

function parseTlv(payload: string): TlvMap {
  const fields: TlvMap = {};
  let cursor = 0;

  while (cursor + 4 <= payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const lengthText = payload.slice(cursor + 2, cursor + 4);
    const length = Number(lengthText);
    if (!/^\d{2}$/.test(id) || !Number.isInteger(length) || length < 0) break;

    const valueStart = cursor + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > payload.length) break;

    fields[id] = payload.slice(valueStart, valueEnd);
    cursor = valueEnd;
  }

  return fields;
}

function moneyFromDigits(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  const cents = Number(value);
  if (!Number.isFinite(cents) || cents <= 0) return undefined;
  return cents / 100;
}

function boletoDueDateFromFactor(factorText: string) {
  if (!/^\d{4}$/.test(factorText)) return undefined;
  const factor = Number(factorText);
  if (!Number.isFinite(factor) || factor < 1000) return undefined;

  // FEBRABAN/CAIXA restarted the due-date factor at 1000 on 2025-02-22.
  const base = new Date(Date.UTC(2025, 1, 22));
  base.setUTCDate(base.getUTCDate() + (factor - 1000));
  return base.toISOString().slice(0, 10);
}

function lineToBankBarcode(digits: string) {
  if (!/^\d{47}$/.test(digits)) return undefined;
  const bankCurrency = digits.slice(0, 4);
  const generalDv = digits.slice(32, 33);
  const factorAndAmount = digits.slice(33, 47);
  const freeField = `${digits.slice(4, 9)}${digits.slice(10, 20)}${digits.slice(21, 31)}`;
  const barcode = `${bankCurrency}${generalDv}${factorAndAmount}${freeField}`;
  return /^\d{44}$/.test(barcode) ? barcode : undefined;
}

function parsePix(rawValue: string): ParsedFinancialCode | undefined {
  const payload = rawValue.trim();
  if (
    !payload.includes('BR.GOV.BCB.PIX') &&
    !payload.toLowerCase().includes('br.gov.bcb.pix')
  )
    return undefined;

  const top = parseTlv(payload);
  let pixAccount: TlvMap | undefined;

  for (let id = 26; id <= 51; id += 1) {
    const value = top[String(id)];
    if (!value) continue;
    const nested = parseTlv(value);
    if (nested['00']?.toLowerCase() === 'br.gov.bcb.pix') {
      pixAccount = nested;
      break;
    }
  }

  const merchant = top['59']?.trim();
  const amount = top['54'] ? Number(top['54']) : undefined;
  const additional = top['62'] ? parseTlv(top['62']) : {};
  const pixUrl = pixAccount?.['25']?.trim();
  const pixKey = pixAccount?.['01']?.trim();
  const dynamicPix = Boolean(pixUrl);
  const usableAmount =
    Number.isFinite(amount) && Number(amount) > 0 ? Number(amount) : undefined;

  return {
    kind: 'pix',
    label: dynamicPix ? 'Pix cobrança dinâmico' : 'Pix QR Code',
    rawValue: payload,
    dynamicPix,
    pixKey,
    pixUrl,
    txid: additional['05']?.trim(),
    draft: {
      amount: usableAmount,
      description: merchant ? `Pix - ${merchant}` : 'Cobrança Pix',
      merchant,
      documentKind: dynamicPix ? 'pix_dynamic' : 'pix_static',
      pixPayload: payload,
      confidence: usableAmount && merchant ? 'high' : 'medium',
    },
  };
}

function parseBankBoleto(rawValue: string): ParsedFinancialCode | undefined {
  const digits = rawValue.replace(/\D/g, '');
  const barcode =
    digits.length === 47
      ? lineToBankBarcode(digits)
      : digits.length === 44
        ? digits
        : undefined;
  if (!barcode || barcode.startsWith('8')) return undefined;

  const factor = barcode.slice(5, 9);
  const amountDigits = barcode.slice(9, 19);
  const amount = moneyFromDigits(amountDigits);
  const dueDate = boletoDueDateFromFactor(factor);

  return {
    kind: 'boleto',
    label:
      digits.length === 47
        ? 'Linha digitável de boleto'
        : 'Código de barras de boleto',
    rawValue: digits,
    bankCode: barcode.slice(0, 3),
    draft: {
      amount,
      description: 'Boleto bancário',
      dueDate,
      documentKind: 'boleto',
      barcode,
      confidence: amount ? 'medium' : 'low',
    },
  };
}

function parseCollectionCode(
  rawValue: string,
): ParsedFinancialCode | undefined {
  const digits = rawValue.replace(/\D/g, '');
  if ((digits.length !== 44 && digits.length !== 48) || !digits.startsWith('8'))
    return undefined;

  return {
    kind: 'collection',
    label: 'Conta/convênio com código de barras',
    rawValue: digits,
    draft: {
      description: 'Conta ou convênio',
      documentKind: 'collection_barcode',
      barcode: digits,
      confidence: 'low',
    },
  };
}

export function parseFinancialCode(rawValue: string): ParsedFinancialCode {
  const clean = rawValue.trim();
  return (
    parsePix(clean) ||
    parseBankBoleto(clean) ||
    parseCollectionCode(clean) || {
      kind: 'unknown',
      label: 'Código não identificado',
      rawValue: clean,
      draft: {
        description: 'Documento financeiro',
        documentKind: 'unknown_code',
        confidence: 'low',
      },
    }
  );
}
