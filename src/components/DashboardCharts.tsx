import { Chart as ChartJS, registerables } from 'chart.js';
import React from 'react';
import { Line } from 'react-chartjs-2';

ChartJS.register(...registerables);

const DESKTOP_QUERY = '(min-width: 821px)';
const DESKTOP_TICK_SIZE = 11;
const APP_FONT_FAMILY =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function withDesktopChartTypography(options: any, isDesktop: boolean) {
  if (!isDesktop) return options;

  const scales = Object.fromEntries(
    Object.entries(options?.scales || {}).map(([key, rawScale]) => {
      const scale = (rawScale || {}) as any;
      const currentSize = Number(scale?.ticks?.font?.size || 0);
      return [
        key,
        {
          ...scale,
          ticks: {
            ...scale.ticks,
            font: {
              ...scale?.ticks?.font,
              family: APP_FONT_FAMILY,
              size: Math.max(DESKTOP_TICK_SIZE, currentSize),
            },
          },
        },
      ];
    }),
  );

  return { ...options, scales };
}

export default function DashboardCharts({
  data,
  options,
}: {
  data: any;
  options: any;
}) {
  const [isDesktop, setIsDesktop] = React.useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );

  React.useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const chartOptions = React.useMemo(
    () => withDesktopChartTypography(options, isDesktop),
    [options, isDesktop],
  );

  return <Line data={data} options={chartOptions} />;
}
