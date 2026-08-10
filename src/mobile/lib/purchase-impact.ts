export type InvoiceProjection = {
  closeDate: Date;
  dueDate: Date;
};

export function safeCardDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), lastDay), 12, 0, 0, 0);
}

export function projectInvoiceForPurchase(purchaseDate: Date, closingDay: number, dueDay: number): InvoiceProjection {
  const normalizedClosingDay = Math.min(31, Math.max(1, Math.trunc(Number(closingDay) || 1)));
  const normalizedDueDay = Math.min(31, Math.max(1, Math.trunc(Number(dueDay) || 1)));
  const closeMonthOffset = purchaseDate.getDate() <= normalizedClosingDay ? 0 : 1;
  const closeDate = safeCardDate(
    purchaseDate.getFullYear(),
    purchaseDate.getMonth() + closeMonthOffset,
    normalizedClosingDay,
  );
  const dueMonthOffset = normalizedDueDay > normalizedClosingDay ? 0 : 1;
  const dueDate = safeCardDate(
    closeDate.getFullYear(),
    closeDate.getMonth() + dueMonthOffset,
    normalizedDueDay,
  );
  return { closeDate, dueDate };
}
