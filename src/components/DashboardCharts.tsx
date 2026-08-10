import React from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';

ChartJS.register(...registerables);

export default function DashboardCharts({ data, options }: { data: any; options: any }) {
  return <Line data={data} options={options} />;
}
