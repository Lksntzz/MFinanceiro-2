import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Transaction, Investment } from '../types';

export const ReportService = {
  exportTransactionsToExcel: (transactions: Transaction[]) => {
    const ws = XLSX.utils.json_to_sheet(transactions.map(t => ({
      Data: new Date(t.date).toLocaleDateString('pt-BR'),
      Descrição: t.description,
      Valor: t.amount,
      Categoria: t.category,
      Tipo: t.type === 'income' ? 'Entrada' : 'Saída'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transações');
    XLSX.writeFile(wb, `MFinanceiro_Relatorio_Transacoes_${new Date().getTime()}.xlsx`);
  },

  exportPortfolioToPDF: (investments: Investment[], total: number) => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(22);
    doc.text('MFinanceiro - Relatório de Investimentos', 14, 20);
    doc.setFontSize(10);
    doc.text(`Data de Emissão: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    doc.text(`Patrimônio Total: R$ ${total.toLocaleString('pt-BR')}`, 14, 38);

    // Table
    const tableData = investments.map(inv => [
      inv.name,
      inv.type === 'fixed_income' ? 'Renda Fixa' : inv.type === 'variable_income' ? 'Var. Renda' : inv.type,
      inv.institution,
      `R$ ${inv.amount.toLocaleString('pt-BR')}`,
      `${inv.yield_percentage?.toFixed(2) || '0'}%`
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Ativo', 'Tipo', 'Instituição', 'Valor Atual', 'Rentabilidade']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [0, 242, 255] }
    });

    doc.save(`MFinanceiro_Portfolio_${new Date().getTime()}.pdf`);
  }
};
