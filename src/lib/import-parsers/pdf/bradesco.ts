import { PdfBankParser } from './types';
import { parseByDateAndCurrencyLines, parseByBlockRegex } from './utils';

export const parseBradescoPdf: PdfBankParser = (context) => {
  // Tenta primeiro a leitura detalhada, que é mais precisa para tabelas
  const fromLines = parseByDateAndCurrencyLines(context);
  if (fromLines.length > 0) return fromLines;

  // Se falhar, usa Regex de bloco, melhorada para pegar descrições complexas
  // Esta regex procura [data] [descrição] [valor], sendo mais tolerante a números no meio.
  const blockRegex = /(\d{2}[./-]\d{2}[./-]\d{4})\s+(.+?)\s+(R\$\s*-?\d[\d.]*,\d{2})/g;
  
  const normalizedText = context.fullText.replace(/\s+/g, ' ').trim();
  const extracted = [];
  let match;
  
  while ((match = blockRegex.exec(normalizedText)) !== null) {
    const signedAmount = context.parseAmount(match[3]);
    if (Math.abs(signedAmount) <= 0) continue;
    
    extracted.push({
      rawDate: match[1],
      description: match[2].trim(),
      signedAmount,
      confidence: 0.8
    });
  }
  
  return extracted;
};
