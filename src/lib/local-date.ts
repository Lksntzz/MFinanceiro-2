// Datas no fuso local do usuário.
//
// `new Date().toISOString()` devolve a data em UTC. No Brasil (UTC-3), a partir
// das 21h isso já é o dia seguinte, e no último dia do mês é o mês seguinte.
// Estas funções usam sempre o relógio local.

const pad = (value: number) => String(value).padStart(2, '0');

export function toLocalISODate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
