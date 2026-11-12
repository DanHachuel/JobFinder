/**
 * Chart.js wrappers (LeadMaster style: horizontal bars + doughnut),
 * with the Chart.js registration performed once here.
 */
import React, { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

ChartJS.defaults.font.family = "'Inter Variable', 'Inter', sans-serif";
ChartJS.defaults.color = '#6b7280';

const BAR_OPTIONS = {
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { precision: 0 } },
    y: { grid: { display: false } },
  },
};

const DOUGHNUT_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: { legend: { display: false } },
};

/** Horizontal bar chart: [{ label, value }]. */
export function BarsChart({ data, color = 'rgba(99, 102, 241, 0.8)' }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((item) => item.label),
      datasets: [
        {
          label: 'Quantidade',
          data: data.map((item) => item.value),
          backgroundColor: color,
          borderRadius: 4,
          barThickness: 20,
        },
      ],
    }),
    [data, color]
  );

  if (!data.length || data.every((item) => item.value === 0)) {
    return <p className="py-8 text-center text-xs text-gray-400">Sem dados no período.</p>;
  }
  return (
    <div className="chart-box">
      <Bar data={chartData} options={BAR_OPTIONS} />
    </div>
  );
}

/** Doughnut chart with a legend: [{ label, value, color }]. */
export function DoughnutChart({ data }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((item) => item.label),
      datasets: [
        {
          data: data.map((item) => item.value),
          backgroundColor: data.map((item) => item.color),
          borderWidth: 0,
        },
      ],
    }),
    [data]
  );

  if (!data.length || data.every((item) => item.value === 0)) {
    return <p className="py-8 text-center text-xs text-gray-400">Sem dados no período.</p>;
  }
  return (
    <div>
      <div className="chart-box flex items-center justify-center">
        <Doughnut data={chartData} options={DOUGHNUT_OPTIONS} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500">
        {data.map((item) => (
          <span key={item.label} className="flex items-center">
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}: <strong className="ml-1 text-gray-700">{item.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
