'use client';

import { useRef } from 'react';
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
		profileImages?: (string | undefined)[];
		datasets: Array<{
			label: string;
			data: number[];
			backgroundColor?: string | string[];
			borderColor?: string | string[];
			borderWidth?: number;
		}>;
	};
	title?: string;
	height?: number;
	indexAxis?: 'x' | 'y';
}

export default function StatsChart({ type, data, title, height = 200, indexAxis = 'x' }: StatsChartProps) {
	const chartRef = useRef<ChartJS>(null);

	const options = {
		responsive: true,
		maintainAspectRatio: false,
		animation: {
			duration: 2000,
			easing: 'easeInOutQuart' as const,
			onProgress: function(animation: any) {
				// Add bounce effect during animation
				if (animation.currentStep === animation.numSteps) {
					// Animation complete
				}
			},
		},
		interaction: {
			intersect: false,
			mode: 'index' as const,
		},
		onHover: (event: any, activeElements: any[]) => {
			if (event.native) {
				event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
			}
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
				enabled: true,
				backgroundColor: 'rgba(15, 23, 42, 0.95)',
				padding: 14,
				titleFont: {
					size: 14,
					weight: '600' as const,
				},
				bodyFont: {
					size: 13,
					weight: '500' as const,
				},
				titleColor: '#ffffff',
				bodyColor: '#e2e8f0',
				borderColor: '#3b82f6',
				borderWidth: 2,
				cornerRadius: 10,
				displayColors: true,
				boxPadding: 8,
				callbacks: {
					label: function(context: any) {
						let label = context.dataset.label || '';
						if (label) {
							label += ': ';
						}
						const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed.x;
						if (label.includes('Revenue')) {
							label += `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
						} else {
							label += value;
						}
						return label;
					},
					title: function(context: any) {
						return context[0].label || '';
					},
				},
				animation: {
					duration: 200,
				},
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
		indexAxis: type === 'bar' ? indexAxis : undefined,
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
					beginAtZero: indexAxis === 'y' ? true : undefined,
					callback: indexAxis === 'y' ? function(value: any) {
						return `₹${value.toLocaleString('en-IN')}`;
					} : undefined,
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
					beginAtZero: indexAxis === 'x' ? true : undefined,
					callback: indexAxis === 'x' ? function(value: any) {
						return value;
					} : undefined,
				},
			},
		} : undefined,
		elements: type === 'bar' ? {
			bar: {
				borderRadius: 8,
				borderSkipped: false,
				hoverBorderWidth: 3,
				hoverBorderRadius: 10,
			},
		} : type === 'line' ? {
			point: {
				radius: 4,
				hoverRadius: 7,
				hoverBorderWidth: 3,
			},
			line: {
				tension: 0.4,
				borderWidth: 3,
			},
		} : undefined,
	};

	// Use plugins to create gradients and add profile images
	const gradientPlugin = {
		id: 'gradientPlugin',
		beforeDraw: (chart: any) => {
			if (type === 'bar' && chart.ctx) {
				const datasets = chart.data.datasets;
				datasets.forEach((dataset: any, datasetIndex: number) => {
					if (Array.isArray(dataset.backgroundColor) && dataset.backgroundColor.some((c: any) => typeof c === 'string' && c.startsWith('hsl'))) {
						const meta = chart.getDatasetMeta(datasetIndex);
						meta.data.forEach((bar: any, index: number) => {
							const originalColor = dataset.backgroundColor[index];
							if (typeof originalColor === 'string' && originalColor.startsWith('hsl')) {
								const ctx = chart.ctx;
								const hslMatch = originalColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
								if (hslMatch) {
									const h = parseInt(hslMatch[1]);
									const s = parseInt(hslMatch[2]);
									const l = parseInt(hslMatch[3]);
									
									const isHorizontal = indexAxis === 'y';
									const gradient = isHorizontal 
										? ctx.createLinearGradient(bar.x, 0, bar.base, 0)
										: ctx.createLinearGradient(0, bar.y, 0, bar.base);
									const lighterL = Math.min(l + 20, 90);
									const darkerL = Math.max(l - 15, 20);
									
									if (isHorizontal) {
										gradient.addColorStop(0, `hsl(${h}, ${s}%, ${lighterL}%)`);
										gradient.addColorStop(0.5, `hsl(${h}, ${s}%, ${l}%)`);
										gradient.addColorStop(1, `hsl(${h}, ${s}%, ${darkerL}%)`);
									} else {
										gradient.addColorStop(0, `hsl(${h}, ${s}%, ${lighterL}%)`);
										gradient.addColorStop(0.5, `hsl(${h}, ${s}%, ${l}%)`);
										gradient.addColorStop(1, `hsl(${h}, ${s}%, ${darkerL}%)`);
									}
									
									bar.backgroundColor = gradient;
								}
							}
						});
					}
				});
			}
		},
	};

	const profileImagePlugin = {
		id: 'profileImagePlugin',
		afterDraw: (chart: any) => {
			if (type === 'bar' && data.profileImages && chart.ctx) {
				const ctx = chart.ctx;
				const datasets = chart.data.datasets;
				datasets.forEach((dataset: any, datasetIndex: number) => {
					const meta = chart.getDatasetMeta(datasetIndex);
					meta.data.forEach((bar: any, index: number) => {
						const profileImage = data.profileImages?.[index];
						if (profileImage) {
							const img = new Image();
							img.crossOrigin = 'anonymous';
							img.onload = () => {
								const isHorizontal = indexAxis === 'y';
								const imgSize = 36;
								let x: number, y: number;
								
								if (isHorizontal) {
									// For horizontal bars, place image on the left side of the bar
									x = bar.base - imgSize - 8;
									y = bar.y - imgSize / 2;
								} else {
									// For vertical bars, place image on top of the bar
									x = bar.x - imgSize / 2;
									y = bar.y - imgSize - 8;
								}
								
								// Draw circular background with shadow
								ctx.save();
								ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
								ctx.shadowBlur = 4;
								ctx.shadowOffsetX = 0;
								ctx.shadowOffsetY = 2;
								ctx.beginPath();
								ctx.arc(x + imgSize / 2, y + imgSize / 2, imgSize / 2 + 3, 0, 2 * Math.PI);
								ctx.fillStyle = 'white';
								ctx.fill();
								ctx.strokeStyle = '#cbd5e1';
								ctx.lineWidth = 2;
								ctx.stroke();
								ctx.restore();
								
								// Draw circular image
								ctx.save();
								ctx.beginPath();
								ctx.arc(x + imgSize / 2, y + imgSize / 2, imgSize / 2, 0, 2 * Math.PI);
								ctx.clip();
								ctx.drawImage(img, x, y, imgSize, imgSize);
								ctx.restore();
								
								chart.draw();
							};
							img.onerror = () => {
								// If image fails to load, do nothing
							};
							img.src = profileImage;
						}
					});
				});
			}
		},
	};

	return (
		<div 
			style={{ height: `${height}px` }}
			className="group relative rounded-lg bg-gradient-to-br from-white via-blue-50/20 to-white p-3 shadow-sm border border-blue-100/50 hover:border-blue-300/70 hover:shadow-md transition-all duration-300"
		>
			{type === 'line' && <Line ref={chartRef} data={data} options={options} plugins={[gradientPlugin]} />}
			{type === 'bar' && <Bar ref={chartRef} data={data} options={options} plugins={[gradientPlugin, profileImagePlugin]} />}
			{type === 'doughnut' && <Doughnut ref={chartRef} data={data} options={options} plugins={[gradientPlugin]} />}
		</div>
	);
}

