import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Investment } from '../types';

export const ReportService = {
  exportPortfolioToPDF: (investments: Investment[], total: number) => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.text('MFinanceiro - Relatório de Investimentos', 14, 20);
    doc.setFontSize(10);
    doc.text(`Data de Emissão: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    doc.text(`Patrimônio Total: R$ ${total.toLocaleString('pt-BR')}`, 14, 38);

    // Table
    const tableData = investments.map((inv) => [
      inv.name,
      inv.type === 'fixed_income'
        ? 'Renda Fixa'
        : inv.type === 'variable_income'
          ? 'Var. Renda'
          : inv.type,
      inv.institution,
      `R$ ${inv.amount.toLocaleString('pt-BR')}`,
      `${inv.yield_percentage?.toFixed(2) || '0'}%`,
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Ativo', 'Tipo', 'Instituição', 'Valor Atual', 'Rentabilidade']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [0, 242, 255] },
    });

    doc.save(`MFinanceiro_Portfolio_${Date.now()}.pdf`);
  },
};
