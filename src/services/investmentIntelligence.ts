import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-3-flash-preview";

function getGeminiApiKey(): string | undefined {
  const fromProcessEnv = typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined;
  const apiKey = fromProcessEnv;
  return apiKey && apiKey.trim().length > 0 ? apiKey : undefined;
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.error("Falha ao inicializar cliente Gemini:", error);
    return null;
  }
}

export interface MarketInsight {
  summary: string;
  tendency: 'bull' | 'bear' | 'neutral';
  topAssetTypes: string[];
  tips: string[];
}

export interface InvestmentAdvice {
  recommendedAmount: number;
  strategy: string;
  reasoning: string;
}

export async function getMarketIntelligence(): Promise<MarketInsight> {
  try {
    const ai = getAiClient();
    if (!ai) {
      throw new Error("GEMINI_API_KEY ausente.");
    }

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: "Analise o cenário atual do mercado financeiro brasileiro (Selic, Inflação, Bolsa) e forneça um resumo para investidores pessoa física. Forneça o resultado estritamente em JSON.",
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text.replace(/```json|```/g, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('Error fetching market intelligence:', err);
    return {
      summary: "Não foi possível carregar os insights do mercado agora. Foque em manter uma reserva de emergência sólida em Renda Fixa.",
      tendency: 'neutral',
      topAssetTypes: ['Renda Fixa', 'Tesouro Selic'],
      tips: ['Mantenha aportes constantes', 'Diversifique sua carteira']
    };
  }
}

export async function getPredictiveAnalysis(
  transactions: any[],
  currentBalance: number,
  fixedBills: any[]
): Promise<string> {
  try {
    const ai = getAiClient();
    if (!ai) {
      throw new Error("GEMINI_API_KEY ausente.");
    }

    const prompt = `
      Histórico de Transações (JSON): ${JSON.stringify(transactions.slice(0, 30))}
      Saldo Atual: R$ ${currentBalance}
      Contas Fixas Pendentes: ${JSON.stringify(fixedBills)}
      
      Atue como um analista preditivo. Com base no padrão de gastos dos últimos 30 dias e nas contas fixas, 
      faça uma previsão de 30 dias: o usuário fechará no azul? Existe algum padrão de gasto anômalo? 
      Seja direto, técnico e use insights brasileiros.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    
    return response.text;
  } catch (error) {
    console.error('Error in Predictive Analysis:', error);
    return 'Não foi possível realizar a análise preditiva no momento.';
  }
}

export async function getInvestmentAdvice(
  balance: number, 
  fixedOutflow: number, 
  totalInvested: number,
  activeGoals: any[],
  budgets: any[]
): Promise<InvestmentAdvice> {
  try {
    const ai = getAiClient();
    if (!ai) {
      throw new Error("GEMINI_API_KEY ausente.");
    }

    const prompt = `
      Situação Financeira do Usuário:
      - Saldo Atual: R$ ${balance}
      - Contas Fixas Pendentes: R$ ${fixedOutflow}
      - Total já Investido: R$ ${totalInvested}
      
      Metas Financeiras:
      ${activeGoals.map(g => `- ${g.name}: Alvo R$ ${g.target_amount} (Faltam R$ ${g.target_amount - g.current_amount})`).join('\n')}
      
      Orçamentos Mensais:
      ${budgets.map(b => `- ${b.category}: Limite R$ ${b.limit_amount}`).join('\n')}
      
      Atue como um Advisor Financeiro pessoal de elite (estilo Personal Banker). 
      Com base nisso, quanto ele deve investir hoje? Priorize a reserva de emergência e as metas mais próximas.
      Retorne estritamente em JSON.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text.replace(/```json|```/g, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('Error fetching investment advice:', err);
    return {
      recommendedAmount: 0,
      strategy: "Conservadora",
      reasoning: "Mantenha a liquidez até que o sistema carregue as recomendações."
    };
  }
}

export interface FundamentalistAnalysis {
  score: number;
  verdict: 'Comprar' | 'Manter' | 'Vender' | 'Aguardar';
  pros: string[];
  cons: string[];
  analysisNote: string;
}

export async function getFundamentalistAnalysis(
  name: string,
  metrics: { pl?: number; roe?: number; ebitda?: number; liquid_debt?: number; dy?: number }
): Promise<FundamentalistAnalysis> {
  try {
    const ai = getAiClient();
    if (!ai) {
      throw new Error("GEMINI_API_KEY ausente.");
    }

    const prompt = `
      Ativo: ${name}
      Indicadores:
      - P/L: ${metrics.pl || 'N/A'}
      - ROE: ${metrics.roe || 'N/A'}
      - EBITDA: ${metrics.ebitda || 'N/A'}
      - Dívida Líquida: ${metrics.liquid_debt || 'N/A'}
      - Dividend Yield (DY): ${metrics.dy || 'N/A'}
      
      Atue como um analista financeiro sênior. Avalie este ativo com base nos indicadores fundamentais fornecidos e no conhecimento geral sobre a empresa/ticker. 
      Retorne uma nota de 0 a 10, um veredito e listas de prós e contras.
      Retorne estritamente em JSON.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text.replace(/```json|```/g, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('Error in fundamentalist analysis:', err);
    return {
      score: 5,
      verdict: 'Aguardar',
      pros: ['Análise indisponível no momento'],
      cons: ['Revisar indicadores manualmente'],
      analysisNote: 'Não foi possível processar a análise automática.'
    };
  }
}
