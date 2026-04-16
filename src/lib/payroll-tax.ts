export type ProgressiveBracket = {
  upTo: number;
  rate: number;
};

export type PayrollYearTable = {
  year: number;
  inssBrackets: ProgressiveBracket[];
  irrfBrackets: ProgressiveBracket[];
  irrfExemptionLimit: number;
  irrfRuleLabel: string;
};

export type PayrollComputation = {
  inss: number;
  irrf: number;
  totalDeductions: number;
  netSalary: number;
  irrfRuleLabel: string;
  tableYear: number;
  tableReferenceLabel: string;
};

const INSS_2025_BRACKETS: ProgressiveBracket[] = [
  { upTo: 1518.0, rate: 0.075 },
  { upTo: 2793.88, rate: 0.09 },
  { upTo: 4190.83, rate: 0.12 },
  { upTo: 8157.41, rate: 0.14 },
];

const IRRF_BASE_EXEMPTION = 2428.8;
const IRRF_BAND_OFFSETS = [
  2826.65 - IRRF_BASE_EXEMPTION,
  3751.05 - IRRF_BASE_EXEMPTION,
  4664.68 - IRRF_BASE_EXEMPTION,
];

function createIrrfBrackets(exemptionLimit: number): ProgressiveBracket[] {
  return [
    { upTo: exemptionLimit, rate: 0 },
    { upTo: exemptionLimit + IRRF_BAND_OFFSETS[0], rate: 0.075 },
    { upTo: exemptionLimit + IRRF_BAND_OFFSETS[1], rate: 0.15 },
    { upTo: exemptionLimit + IRRF_BAND_OFFSETS[2], rate: 0.225 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.275 },
  ];
}

const PAYROLL_TABLES_BY_YEAR: PayrollYearTable[] = [
  {
    year: 2025,
    inssBrackets: INSS_2025_BRACKETS,
    irrfExemptionLimit: 2428.8,
    irrfBrackets: createIrrfBrackets(2428.8),
    irrfRuleLabel: 'IRRF isento até R$ 2.428,80 (regra desde mai/2025).',
  },
  {
    year: 2026,
    // Mantém a mesma tabela de INSS até atualização oficial.
    inssBrackets: INSS_2025_BRACKETS,
    irrfExemptionLimit: 5000,
    irrfBrackets: createIrrfBrackets(5000),
    irrfRuleLabel: 'IRRF isento até R$ 5.000,00 (regra 2026).',
  },
];

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateProgressive(baseValue: number, brackets: ProgressiveBracket[]): number {
  if (baseValue <= 0) return 0;

  let previousLimit = 0;
  let total = 0;

  for (const bracket of brackets) {
    const upperBound = Number.isFinite(bracket.upTo) ? Math.min(baseValue, bracket.upTo) : baseValue;
    const taxableSlice = Math.max(0, upperBound - previousLimit);
    total += taxableSlice * bracket.rate;
    previousLimit = bracket.upTo;

    if (baseValue <= bracket.upTo) break;
  }

  return roundMoney(total);
}

function resolvePayrollTable(referenceYear: number): PayrollYearTable {
  const sorted = [...PAYROLL_TABLES_BY_YEAR].sort((a, b) => a.year - b.year);
  const exact = sorted.find(table => table.year === referenceYear);
  if (exact) return exact;

  const previous = [...sorted].reverse().find(table => table.year <= referenceYear);
  if (previous) return previous;

  return sorted[0];
}

export function calculatePayrollFromGross(grossSalary: number, referenceDate: Date): PayrollComputation {
  const gross = Math.max(0, Number(grossSalary) || 0);
  const referenceYear = referenceDate.getFullYear();
  const table = resolvePayrollTable(referenceYear);

  const inssCap = table.inssBrackets[table.inssBrackets.length - 1].upTo;
  const inss = calculateProgressive(Math.min(gross, inssCap), table.inssBrackets);

  const irrfBase = Math.max(0, gross - inss);
  const irrf = irrfBase <= table.irrfExemptionLimit ? 0 : calculateProgressive(irrfBase, table.irrfBrackets);

  const totalDeductions = roundMoney(inss + irrf);
  const netSalary = roundMoney(Math.max(0, gross - totalDeductions));
  const tableReferenceLabel =
    table.year === referenceYear
      ? `Tabela aplicada: ${table.year}`
      : `Tabela aplicada: ${table.year} (referência para ${referenceYear})`;

  return {
    inss,
    irrf,
    totalDeductions,
    netSalary,
    irrfRuleLabel: table.irrfRuleLabel,
    tableYear: table.year,
    tableReferenceLabel,
  };
}
