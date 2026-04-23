import * as XLSX from 'xlsx';
import {
  detectFileFormat,
  normalizeImportedTransactions,
  parseCsvTransactions,
  parseOfxTransactions,
  parseSpreadsheetTransactions,
} from '../src/components/ImportarExtratos';

type SimulationResult = {
  arquivo: string;
  formato: string;
  parser: string;
  parserDisponivel: boolean;
  suportado: boolean;
  total: number;
  validos: number;
  motivo?: string;
};

const bank = 'auto';

function summarize(
  file: File,
  parsed: Awaited<ReturnType<typeof parseSpreadsheetTransactions>> | ReturnType<typeof parseCsvTransactions>
): SimulationResult {
  const detection = detectFileFormat(file);
  const normalized = normalizeImportedTransactions(parsed);
  const validos = normalized.filter(
    (item) => item.status === 'ready' && item.amount > 0 && item.description !== 'Sem descricao'
  ).length;
  return {
    arquivo: file.name,
    formato: detection.formatLabel,
    parser: detection.parserLabel,
    parserDisponivel: detection.parserExists,
    suportado: detection.supported,
    total: normalized.length,
    validos,
    motivo: validos === 0 ? 'Nenhum lancamento valido encontrado' : undefined,
  };
}

async function run(): Promise<void> {
  const results: SimulationResult[] = [];

  const csvContent = [
    'Data;Descricao;Valor;Tipo',
    '20/04/2026;Supermercado Bom Preco;-182,45;debito',
    '21/04/2026;Salario Empresa XYZ;3500,00;credito',
    '22/04/2026;Uber Viagem;-27,90;debito',
  ].join('\n');
  const csvFile = new File([csvContent], 'extrato-teste.csv', { type: 'text/csv' });
  results.push(summarize(csvFile, parseCsvTransactions(csvContent, bank)));

  const ofxContent = `
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260420120000
<TRNAMT>-45.67
<FITID>ofx-1
<MEMO>Padaria Central
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260421120000
<TRNAMT>1000.00
<FITID>ofx-2
<MEMO>Transferencia Recebida
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
  `.trim();
  const ofxFile = new File([ofxContent], 'extrato-teste.ofx', { type: 'application/ofx' });
  results.push(summarize(ofxFile, parseOfxTransactions(ofxContent, bank)));

  const sheetRows = [
    ['Data', 'Descricao', 'Valor', 'Tipo'],
    ['23/04/2026', 'Assinatura Streaming', -39.9, 'debito'],
    ['24/04/2026', 'Freelance Projeto', 800.0, 'credito'],
    ['25/04/2026', 'Farmacia', -56.45, 'debito'],
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Extrato');
  const xlsxBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const xlsxFile = new File([xlsxBuffer], 'extrato-teste.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  results.push(summarize(xlsxFile, await parseSpreadsheetTransactions(xlsxFile, bank)));

  const imageFile = new File([new Uint8Array([1, 2, 3, 4])], 'extrato-foto.png', { type: 'image/png' });
  const imageDetection = detectFileFormat(imageFile);
  results.push({
    arquivo: imageFile.name,
    formato: imageDetection.formatLabel,
    parser: imageDetection.parserLabel,
    parserDisponivel: imageDetection.parserExists,
    suportado: imageDetection.supported,
    total: 0,
    validos: 0,
    motivo: imageDetection.reason,
  });

  const unknownFile = new File(['abc'], 'extrato-teste.txt', { type: 'text/plain' });
  const unknownDetection = detectFileFormat(unknownFile);
  results.push({
    arquivo: unknownFile.name,
    formato: unknownDetection.formatLabel,
    parser: unknownDetection.parserLabel,
    parserDisponivel: unknownDetection.parserExists,
    suportado: unknownDetection.supported,
    total: 0,
    validos: 0,
    motivo: unknownDetection.reason,
  });

  console.table(results);
}

run().catch((error) => {
  console.error('Falha na simulacao:', error);
  process.exitCode = 1;
});

