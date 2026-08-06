import { Chart } from 'chart.js';

type RhythmFilter = 'day' | 'week' | 'month';
type BaseSeries = { labels: string[]; datasets: number[][] };

const baseByCanvas = new WeakMap<HTMLCanvasElement, BaseSeries>();
const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function toNumberArray(values: unknown[]): number[] {
  return values.map((value) => Number(value) || 0);
}

function getRhythmChart(button: HTMLButtonElement) {
  const card = button.closest('.mf-chart-card');
  if (!card) return null;
  const heading = card.querySelector('h3')?.textContent?.toLowerCase() || '';
  if (!heading.includes('ritmo de gastos')) return null;
  const canvas = card.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const chart = Chart.getChart(canvas);
  return chart ? { canvas, chart } : null;
}

function captureDailyBase(canvas: HTMLCanvasElement, chart: Chart): BaseSeries {
  const labels = (chart.data.labels || []).map((label) => String(label));
  const datasets = chart.data.datasets.map((dataset) => toNumberArray((dataset.data || []) as unknown[]));
  const existing = baseByCanvas.get(canvas);

  if (!existing || labels.length >= existing.labels.length) {
    const next = { labels, datasets };
    baseByCanvas.set(canvas, next);
    return next;
  }
  return existing;
}

function aggregateWeeks(base: BaseSeries): BaseSeries {
  const groups: Array<{ start: number; end: number }> = [];
  let end = base.labels.length;
  while (end > 0) {
    const start = Math.max(0, end - 7);
    groups.unshift({ start, end });
    end = start;
  }
  return {
    labels: groups.map(({ start, end: groupEnd }) => {
      const first = base.labels[start] || '';
      const last = base.labels[groupEnd - 1] || first;
      return first === last ? first : `${first}–${last}`;
    }),
    datasets: base.datasets.map((series) => groups.map(({ start, end: groupEnd }) =>
      Number(series.slice(start, groupEnd).reduce((sum, value) => sum + value, 0).toFixed(2)),
    )),
  };
}

function aggregateMonths(base: BaseSeries): BaseSeries {
  const monthOrder: string[] = [];
  const indexByMonth = new Map<string, number>();
  base.labels.forEach((label) => {
    const month = label.split('/')[1] || label;
    if (!indexByMonth.has(month)) {
      indexByMonth.set(month, monthOrder.length);
      monthOrder.push(month);
    }
  });

  const datasets = base.datasets.map(() => new Array(monthOrder.length).fill(0));
  base.labels.forEach((label, pointIndex) => {
    const month = label.split('/')[1] || label;
    const bucket = indexByMonth.get(month);
    if (bucket === undefined) return;
    base.datasets.forEach((series, datasetIndex) => {
      datasets[datasetIndex][bucket] += Number(series[pointIndex]) || 0;
    });
  });

  return {
    labels: monthOrder.map((month) => {
      const number = Number(month);
      return Number.isInteger(number) && number >= 1 && number <= 12 ? monthNames[number - 1] : month;
    }),
    datasets: datasets.map((series) => series.map((value) => Number(value.toFixed(2)))),
  };
}

function applyFilter(button: HTMLButtonElement, filter: RhythmFilter) {
  const target = getRhythmChart(button);
  if (!target) return;
  const { canvas, chart } = target;
  const base = captureDailyBase(canvas, chart);
  const next = filter === 'week' ? aggregateWeeks(base) : filter === 'month' ? aggregateMonths(base) : base;
  chart.data.labels = [...next.labels];
  chart.data.datasets.forEach((dataset, index) => { dataset.data = [...(next.datasets[index] || [])]; });
  chart.update();
}

function filterFromLabel(label: string): RhythmFilter | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'dia') return 'day';
  if (normalized === 'semana') return 'week';
  if (normalized === 'mês' || normalized === 'mes') return 'month';
  return null;
}

function updateLocalAnalysisCopy() {
  document.querySelectorAll<HTMLButtonElement>('.mf-subnav button').forEach((button) => {
    if (button.textContent?.trim() === 'Insights AI') button.textContent = 'Projeções';
  });
}

export function installRhythmChartFilter() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.mf-segmented button');
    if (!(button instanceof HTMLButtonElement)) return;
    const filter = filterFromLabel(button.textContent || '');
    if (!filter) return;
    window.setTimeout(() => applyFilter(button, filter), 40);
    window.setTimeout(() => applyFilter(button, filter), 180);
  });

  const observer = new MutationObserver(updateLocalAnalysisCopy);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(updateLocalAnalysisCopy, 0);
}

installRhythmChartFilter();
