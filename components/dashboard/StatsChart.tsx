'use client';

import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
	Chart as ChartJS,
	CategoryScale,
	LinearScale,
	PointElement,
	LineElement,
	BarElement,
	ArcElement,
	Title,
	Tooltip,
	Legend,
} from 'chart.js';

ChartJS.register(
	CategoryScale,
	LinearScale,
	PointElement,
	LineElement,
	BarElement,
	ArcElement,
	Title,
	Tooltip,
	Legend
);

interface StatsChartProps {
	type: 'line' | 'bar' | 'doughnut';
	data: {
		labels: string[];
		datasets: Array<{
			label: string;
			data: number[];
			backgroundColor?: string | string[];
			borderColor?: string;
			borderWidth?: number;
		}>;
	};
	title?: string;
	height?: number;
}

export default function StatsChart({ type, data, title, height = 200 }: StatsChartProps) {
	const options = {
		responsive: true,
		maintainAspectRatio: false,
		animation: {
			duration: 1500,
			easing: 'easeInOutQuart' as const,
		},
		plugins: {
			legend: {
				position: 'top' as const,
				labels: {
					usePointStyle: true,
					padding: 15,
					font: {
						size: 12,
						weight: '500' as const,
					},
					color: '#1e293b',
				},
			},
			tooltip: {
				backgroundColor: 'rgba(15, 23, 42, 0.9)',
				padding: 12,
				titleFont: {
					size: 13,
					weight: '600' as const,
				},
				bodyFont: {
					size: 12,
				},
				titleColor: '#ffffff',
				bodyColor: '#e2e8f0',
				borderColor: '#3b82f6',
				borderWidth: 2,
				cornerRadius: 8,
				displayColors: true,
				boxPadding: 6,
			},
			title: title
				? {
						display: true,
						text: title,
						font: {
							size: 16,
							weight: '600' as const,
						},
						padding: {
							bottom: 15,
						},
					}
				: undefined,
		},
		scales: type === 'line' || type === 'bar' ? {
			x: {
				grid: {
					display: true,
					color: 'rgba(148, 163, 184, 0.1)',
					drawBorder: false,
				},
				ticks: {
					font: {
						size: 11,
					},
					color: '#64748b',
				},
			},
			y: {
				grid: {
					display: true,
					color: 'rgba(148, 163, 184, 0.1)',
					drawBorder: false,
				},
				ticks: {
					font: {
						size: 11,
					},
					color: '#64748b',
					beginAtZero: true,
				},
			},
		} : undefined,
	};

	return (
		<div 
			style={{ height: `${height}px` }}
			className="relative rounded-lg bg-gradient-to-br from-white via-blue-50/20 to-white p-3 shadow-sm border border-blue-100/50 hover:border-blue-200/70 transition-all duration-300"
		>
			{type === 'line' && <Line data={data} options={options} />}
			{type === 'bar' && <Bar data={data} options={options} />}
			{type === 'doughnut' && <Doughnut data={data} options={options} />}
		</div>
	);
}

