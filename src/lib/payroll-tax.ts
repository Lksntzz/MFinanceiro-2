export type ProgressiveBracket = {
  upTo: number;
  rate: number;
};

export type PayrollComputation = {
  inss: number;
  irrf: number;
  totalDeductions: number;
  netSalary: number;
  irrfBase: number;
  irrfBeforeReduction: number;
  irrfReduction: number;
  deductionUsedForIrrf: number;
  usedSimplifiedDeduction: boolean;
  effectiveInssRate: number;
  effectiveIrrfRate: number;
  irrfRuleLabel: string;
  tableYear: number;
  tableReferenceLabel: string;
};

type IrrfBand = {
  upTo: number;
  rate: number;
  deduction: number;
};

type PayrollTable = {
  year: number;
  inssBrackets: ProgressiveBracket[];
  irrfBands: IrrfBand[];
  simplifiedDeduction: number;
  irrfRuleLabel: string;
};

const INSS_2025_BRACKETS: ProgressiveBracket[] = [
  { upTo: 1518.0, rate: 0.075 },
  { upTo: 2793.88, rate: 0.09 },
  { upTo: 4190.83, rate: 0.12 },
  { upTo: 8157.41, rate: 0.14 },
];

const INSS_2026_BRACKETS: ProgressiveBracket[] = [
  { upTo: 1621.0, rate: 0.075 },
  { upTo: 2902.84, rate: 0.09 },
  { upTo: 4354.27, rate: 0.12 },
  { upTo: 8475.55, rate: 0.14 },
];

const IRRF_FROM_MAY_2025: IrrfBand[] = [
  { upTo: 2428.8, rate: 0, deduction: 0 },
  { upTo: 2826.65, rate: 0.075, deduction: 182.16 },
  { upTo: 3751.05, rate: 0.15, deduction: 394.16 },
  { upTo: 4664.68, rate: 0.225, deduction: 675.49 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.275, deduction: 908.73 },
];

const IRRF_JAN_TO_APR_2025: IrrfBand[] = [
  { upTo: 2259.2, rate: 0, deduction: 0 },
  { upTo: 2826.65, rate: 0.075, deduction: 169.44 },
  { upTo: 3751.05, rate: 0.15, deduction: 381.44 },
  { upTo: 4664.68, rate: 0.225, deduction: 662.77 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.275, deduction: 896.0 },
];

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateProgressive(baseValue: number, brackets: ProgressiveBracket[]): number {
  if (baseValue <= 0) return 0;

  const cappedBase = Math.min(baseValue, brackets[brackets.length - 1].upTo);
  let previousLimit = 0;
  let total = 0;

  for (const bracket of brackets) {
    const upperBound = Math.min(cappedBase, bracket.upTo);
    const taxableSlice = Math.max(0, upperBound - previousLimit);
    total += taxableSlice * bracket.rate;
    previousLimit = bracket.upTo;
    if (cappedBase <= bracket.upTo) break;
  }

  return roundMoney(total);
}

function calculateIrrfFromBase(baseValue: number, bands: IrrfBand[]): number {
  if (baseValue <= 0) return 0;
  const band = bands.find((item) => baseValue <= item.upTo) || bands[bands.length - 1];
  return roundMoney(Math.max(0, baseValue * band.rate - band.deduction));
}

function resolvePayrollTable(referenceDate: Date): PayrollTable {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  if (year >= 2026) {
    return {
      year: 2026,
      inssBrackets: INSS_2026_BRACKETS,
      irrfBands: IRRF_FROM_MAY_2025,
      simplifiedDeduction: 607.2,
      irrfRuleLabel: 'IRRF 2026: tabela progressiva mensal com redução até R$ 7.350,00.',
    };
  }

  if (year === 2025 && month < 4) {
    return {
      year: 2025,
      inssBrackets: INSS_2025_BRACKETS,
      irrfBands: IRRF_JAN_TO_APR_2025,
      simplifiedDeduction: 564.8,
      irrfRuleLabel: 'IRRF conforme tabela vigente entre janeiro e abril de 2025.',
    };
  }

  return {
    year: 2025,
    inssBrackets: INSS_2025_BRACKETS,
    irrfBands: IRRF_FROM_MAY_2025,
    simplifiedDeduction: 607.2,
    irrfRuleLabel: 'IRRF conforme tabela vigente desde maio de 2025.',
  };
}

function calculate2026IrrfReduction(grossSalary: number, taxBeforeReduction: number): number {
  if (taxBeforeReduction <= 0) return 0;
  if (grossSalary <= 5000) return roundMoney(Math.min(taxBeforeReduction, 312.89));
  if (grossSalary <= 7350) {
    const reduction = Math.max(0, 978.62 - 0.133145 * grossSalary);
    return roundMoney(Math.min(taxBeforeReduction, reduction));
  }
  return 0;
}

export function calculatePayrollFromGross(grossSalary: number, referenceDate: Date): PayrollComputation {
  const gross = Math.max(0, Number(grossSalary) || 0);
  const table = resolvePayrollTable(referenceDate);
  const inss = calculateProgressive(gross, table.inssBrackets);

  // A fonte pagadora compara as deduções legais disponíveis com o desconto simplificado.
  // Como este cálculo não recebe dependentes/pensão, a dedução legal considerada aqui é o INSS.
  const deductionUsedForIrrf = Math.max(inss, table.simplifiedDeduction);
  const usedSimplifiedDeduction = table.simplifiedDeduction >= inss;
  const irrfBase = roundMoney(Math.max(0, gross - deductionUsedForIrrf));
  const irrfBeforeReduction = calculateIrrfFromBase(irrfBase, table.irrfBands);
  const irrfReduction = table.year >= 2026
    ? calculate2026IrrfReduction(gross, irrfBeforeReduction)
    : 0;
  const irrf = roundMoney(Math.max(0, irrfBeforeReduction - irrfReduction));

  const totalDeductions = roundMoney(inss + irrf);
  const netSalary = roundMoney(Math.max(0, gross - totalDeductions));
  const referenceYear = referenceDate.getFullYear();
  const tableReferenceLabel = table.year === referenceYear
    ? `Tabela aplicada: ${table.year}`
    : `Tabela aplicada: ${table.year} (referência disponível para ${referenceYear})`;

  return {
    inss,
    irrf,
    totalDeductions,
    netSalary,
    irrfBase,
    irrfBeforeReduction,
    irrfReduction,
    deductionUsedForIrrf: roundMoney(deductionUsedForIrrf),
    usedSimplifiedDeduction,
    effectiveInssRate: gross > 0 ? inss / gross : 0,
    effectiveIrrfRate: gross > 0 ? irrf / gross : 0,
    irrfRuleLabel: table.irrfRuleLabel,
    tableYear: table.year,
    tableReferenceLabel,
  };
}
