
import { PAYMENT_ALIASES, PaymentAlias } from '../data/payment-aliases';

export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD') // Decompõe caracteres acentuados
    .replace(/[\u0300-\u036f]/g, '') // Remove os acentos resultantes
    .replace(/[^a-z0-9 ]/g, ' ') // Remove caracteres especiais mantendo espaços
    .replace(/\s+/g, ' ') // Colapsa múltiplos espaços
    .trim();
}

/**
 * Filtra palavras irrelevantes que costumam vir no extrato
 */
function removeNoise(text: string): string {
  const noise = [
    'pagamento', 'conta', 'fatura', 'servicos', 's.a.', 'sa', 'ltda', 'financeiro', 
    'debito', 'automatico', 'agendamento', 'boleto', 'consumo', 'mensalidade',
    'qr', 'pix', 'pagto'
  ];
  let result = text;
  noise.forEach(n => {
    const regex = new RegExp(`\\b${n}\\b`, 'gi');
    result = result.replace(regex, '');
  });
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Tenta identificar a categoria/empresa de uma descrição de extrato usando a base local estática
 */
export function identifyCompany(description: string): { company: string; category: string; confidence: number; officialName: string } | null {
  const normalizedDesc = normalizeText(description);
  const cleanDesc = removeNoise(normalizedDesc);
  
  if (normalizedDesc.length < 3) return null;

  let bestMatch: { company: string; category: string; confidence: number; officialName: string } | null = null;
  let maxConfidence = 0;

  // Percorre todas as categorias e empresas na base local
  for (const [category, companies] of Object.entries(PAYMENT_ALIASES)) {
    for (const company of companies) {
      let confidence = 0;

      // 1. Verificar aliases (maior peso)
      for (const alias of company.aliases) {
        const normAlias = normalizeText(alias);
        if (normalizedDesc.includes(normAlias) || cleanDesc.includes(normAlias)) {
          confidence = Math.max(confidence, 0.9);
          // Se for match exato ou palavra isolada idêntica
          if (cleanDesc === normAlias || normalizedDesc === normAlias) {
            confidence = 1.0;
          }
        }
      }

      // 2. Verificar keywords (peso médio)
      if (company.keywords) {
        for (const kw of company.keywords) {
          const normKw = normalizeText(kw);
          if (normalizedDesc.includes(normKw)) {
            confidence = Math.max(confidence, 0.85);
          }
        }
      }

      // 3. Verificar Nome Oficial (peso alto)
      const normOfficial = normalizeText(company.officialName);
      if (normalizedDesc.includes(normOfficial)) {
        confidence = Math.max(confidence, 0.95);
      }

      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMatch = {
          company: company.displayName,
          category: category,
          confidence: confidence,
          officialName: company.officialName
        };
      }

      // Se já achamos um match perfeito, podemos parar
      if (maxConfidence === 1.0) break;
    }
    if (maxConfidence === 1.0) break;
  }

  return bestMatch && maxConfidence >= 0.7 ? bestMatch : null;
}
