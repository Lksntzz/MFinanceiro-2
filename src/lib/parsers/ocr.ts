
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NormalizedTransaction } from "../../types";
import { suggestCategory, generateDuplicateKey } from "./utils";

function getGeminiApiKey(): string | undefined {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  return apiKey && apiKey.trim().length > 0 ? apiKey : undefined;
}

export async function parseWithOCR(file: File, bankName?: string): Promise<NormalizedTransaction[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY não configurada para OCR.");
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Convert file to base64
  const base64Data = await fileToBase64(file);
  const mimeType = file.type;

  const prompt = `
    Você é um especialista em extração de dados bancários. 
    Analise a imagem/PDF do extrato bancário fornecido e extraia todas as transações financeiras.
    
    Banco sugerido: ${bankName || 'Desconhecido'}

    Retorne os dados EXATAMENTE no formato JSON abaixo, sem explicações adicionais:
    [
      {
        "date": "YYYY-MM-DD",
        "description": "Descrição original",
        "amount": 0.00,
        "type": "income" | "expense",
        "balance": 0.00 (se disponível)
      }
    ]

    Regras:
    1. Identifique corretamente se o valor é uma entrada (income) ou saída (expense).
    2. Normalize a data para o formato ISO (YYYY-MM-DD).
    3. O valor deve ser um número positivo (o tipo indica se é entrada ou saída).
    4. Se não tiver certeza de um campo, tente o seu melhor ou ignore a linha se for apenas um cabeçalho/total.
  `;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Clean JSON response (remove markdown code blocks if present)
    const jsonStr = text.replace(/```json|```/g, "").trim();
    const rawTransactions = JSON.parse(jsonStr);

    return rawTransactions.map((t: any, index: number) => {
      const normalized: Partial<NormalizedTransaction> = {
        id: `ocr-${index}-${Date.now()}`,
        bankName: bankName || 'Detectado via OCR',
        sourceFormat: 'ocr',
        transactionDate: new Date(t.date).toISOString(),
        description: t.description,
        normalizedDescription: t.description.toUpperCase(),
        amount: Math.abs(t.amount),
        direction: t.type,
        balanceAfterTransaction: t.balance,
        categorySuggested: suggestCategory(t.description),
        categoryConfidence: 0.7,
        importConfidence: 0.8,
        rawRow: t,
        status: 'ready'
      };
      normalized.duplicateKey = generateDuplicateKey(normalized);
      return normalized as NormalizedTransaction;
    });
  } catch (error) {
    console.error("OCR Parsing failed:", error);
    throw new Error("Falha ao processar arquivo com OCR inteligente.");
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}
