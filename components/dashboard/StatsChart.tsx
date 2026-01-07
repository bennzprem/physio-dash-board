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
	Filler,
	type ChartEvent,
	type ActiveElement,
	type TooltipItem,
	type Chart,
	type ChartConfiguration,
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
	Legend,
	Filler
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
			onProgress: function(animation: { currentStep: number; numSteps: number }) {
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
		onHover: (event: ChartEvent, activeElements: ActiveElement[]) => {
			if (event.native && event.native.target && 'style' in event.native.target) {
				(event.native.target as HTMLElement).style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
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
						weight: 500,
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
					weight: 600,
				},
				bodyFont: {
					size: 13,
					weight: 500,
				},
				titleColor: '#ffffff',
				bodyColor: '#e2e8f0',
				borderColor: '#3b82f6',
				borderWidth: 2,
				cornerRadius: 10,
				displayColors: true,
				boxPadding: 8,
				callbacks: {
					label: function(context: TooltipItem<'line' | 'bar' | 'doughnut'>) {
						let label = context.dataset.label || '';
						if (label) {
							label += ': ';
						}
						// For horizontal bar charts (indexAxis="y"), the value is in parsed.x
						// For vertical bar/line charts, the value is in parsed.y
						// Check both and use the one that's a valid number
						let value: number | undefined;
						if (indexAxis === 'y') {
							// Horizontal bar chart - value is in x
							value = typeof context.parsed.x === 'number' ? context.parsed.x : undefined;
						} else {
							// Vertical bar/line chart - value is in y
							value = typeof context.parsed.y === 'number' ? context.parsed.y : undefined;
						}
						// Fallback: try the other axis if primary is undefined
						if (value === undefined) {
							value = typeof context.parsed.y === 'number' ? context.parsed.y : 
								(typeof context.parsed.x === 'number' ? context.parsed.x : undefined);
						}
						if (typeof value === 'number') {
							if (label.includes('Revenue')) {
								label += `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
							} else {
								label += value;
							}
						}
						return label;
					},
					title: function(context: TooltipItem<'line' | 'bar' | 'doughnut'>[]) {
						// Get the team member name (category label) from the chart data
						if (context && context.length > 0) {
							const item = context[0];
							
							// Method 1: Try to get label from chart's data.labels array using dataIndex
							if (item && typeof item.dataIndex === 'number' && item.chart) {
								const chart = item.chart;
								if (chart.data && chart.data.labels && Array.isArray(chart.data.labels)) {
									const label = chart.data.labels[item.dataIndex];
									if (label !== null && label !== undefined) {
										return String(label);
									}
								}
							}
							
							// Method 2: Try the label property (works for most chart types)
							if (item?.label) {
								return String(item.label);
							}
							
							// Method 3: Try to get from parsed values (for some chart configurations)
							if (item && item.chart && item.chart.data && item.chart.data.labels) {
								const labels = item.chart.data.labels;
								if (Array.isArray(labels) && typeof item.dataIndex === 'number' && labels[item.dataIndex]) {
									return String(labels[item.dataIndex]);
								}
							}
						}
						return '';
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
						weight: 600,
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
				type: indexAxis === 'y' ? 'linear' : 'category',
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
					callback: indexAxis === 'y' ? function(value: string | number) {
						if (typeof value === 'number') {
							return `₹${value.toLocaleString('en-IN')}`;
						}
						return value;
					} : function(value: string | number, index: number) {
						// For vertical bar charts (indexAxis='x' or default), use the label from the data
						if (indexAxis === 'x' && data.labels && Array.isArray(data.labels) && typeof index === 'number' && index >= 0 && index < data.labels.length) {
							const label = data.labels[index];
							return label || String(value);
						}
						// Fallback: if labels exist but index is out of range, return the value as string
						return String(value);
					},
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
					callback: indexAxis === 'x' ? function(value: string | number) {
						return value;
					} : undefined,
				},
			},
		} : undefined,
		elements: type === 'bar' ? {
			bar: {
				borderRadius: indexAxis === 'y' ? 6 : 8, // Slightly larger radius for horizontal bars
				borderSkipped: false,
				hoverBorderWidth: 4, // Increased hover border width for better visibility
				hoverBorderRadius: indexAxis === 'y' ? 8 : 10,
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
		beforeDraw: (chart: Chart) => {
			if (type === 'bar' && chart.ctx) {
				const datasets = chart.data.datasets;
				datasets.forEach((dataset, datasetIndex: number) => {
					if (Array.isArray(dataset.backgroundColor) && dataset.backgroundColor.some((c: unknown) => typeof c === 'string' && c.startsWith('hsl'))) {
						const meta = chart.getDatasetMeta(datasetIndex);
						meta.data.forEach((bar, index: number) => {
							const backgroundColorArray = dataset.backgroundColor as string[];
							const originalColor = backgroundColorArray[index];
							if (typeof originalColor === 'string' && originalColor.startsWith('hsl')) {
								const ctx = chart.ctx;
								const hslMatch = originalColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
								if (hslMatch) {
									const h = parseInt(hslMatch[1]);
									const s = parseInt(hslMatch[2]);
									const l = parseInt(hslMatch[3]);
									
									const isHorizontal = indexAxis === 'y';
									const barElement = bar as unknown as { x: number; y: number; base: number };
									const gradient = isHorizontal 
										? ctx.createLinearGradient(barElement.x, 0, barElement.base, 0)
										: ctx.createLinearGradient(0, barElement.y, 0, barElement.base);
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
									
									(bar as unknown as { backgroundColor: CanvasGradient }).backgroundColor = gradient;
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
		afterDraw: (chart: Chart) => {
			if (type === 'bar' && data.profileImages && chart.ctx) {
				const ctx = chart.ctx;
				const datasets = chart.data.datasets;
				datasets.forEach((dataset, datasetIndex: number) => {
					const meta = chart.getDatasetMeta(datasetIndex);
					meta.data.forEach((bar, index: number) => {
						const profileImage = data.profileImages?.[index];
						const barElement = bar as unknown as { x: number; y: number; base: number; width?: number; height?: number };
						if (profileImage) {
							const img = new Image();
							img.crossOrigin = 'anonymous';
							img.onload = () => {
								const isHorizontal = indexAxis === 'y';
								const imgSize = 36;
								let x: number, y: number;
								
								if (isHorizontal) {
									// For horizontal bars, place image on the left side of the bar
									x = barElement.base - imgSize - 8;
									y = barElement.y - imgSize / 2;
								} else {
									// For vertical bars, place image on top of the bar
									x = barElement.x - imgSize / 2;
									y = barElement.y - imgSize - 8;
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
			{type === 'line' && (
				// @ts-expect-error - Chart.js type system limitations with generic chart component
				<Line ref={chartRef} data={data} options={options} plugins={[gradientPlugin]} />
			)}
			{type === 'bar' && (
				// @ts-expect-error - Chart.js type system limitations with generic chart component
				<Bar ref={chartRef} data={data} options={options} plugins={[gradientPlugin, profileImagePlugin]} />
			)}
			{type === 'doughnut' && (
				// @ts-expect-error - Chart.js type system limitations with generic chart component
				<Doughnut ref={chartRef} data={data} options={options} plugins={[gradientPlugin]} />
			)}
		</div>
	);
}

