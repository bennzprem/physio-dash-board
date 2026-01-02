'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import StatsChart from '@/components/dashboard/StatsChart';
import type { PatientRecordFull } from '@/lib/types';

interface PatientProgressAnalyticsProps {
	patientId: string;
	patientName?: string;
}

interface ReportVersion {
	id: string;
	version: number;
	createdAt: string;
	createdBy: string;
	data: Partial<PatientRecordFull>;
}

export default function PatientProgressAnalytics({ patientId, patientName }: PatientProgressAnalyticsProps) {
	const [reportVersions, setReportVersions] = useState<ReportVersion[]>([]);
	const [loading, setLoading] = useState(true);

	// Load all report versions
	useEffect(() => {
		const loadReportVersions = async () => {
			if (!patientId) return;
			
			setLoading(true);
			try {
				const physioQuery = query(
					collection(db, 'reportVersions'),
					where('patientId', '==', patientId),
					orderBy('version', 'asc')
				);
				const physioSnapshot = await getDocs(physioQuery);
				
				const versions: ReportVersion[] = physioSnapshot.docs.map(doc => {
					const data = doc.data();
					const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: doc.id,
						version: data.version as number,
						createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
						createdBy: (data.createdBy as string) || 'Unknown',
						data: (data.reportData as Partial<PatientRecordFull>) || {},
					};
				});
				
				versions.sort((a, b) => 
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
				);
				
				setReportVersions(versions);
			} catch (error: any) {
				// If orderBy fails, try without it
				if (error?.code === 'failed-precondition') {
					try {
						const physioQuery = query(
							collection(db, 'reportVersions'),
							where('patientId', '==', patientId)
						);
						const physioSnapshot = await getDocs(physioQuery);
						
						const versions: ReportVersion[] = physioSnapshot.docs.map(doc => {
							const data = doc.data();
							const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
							return {
								id: doc.id,
								version: data.version as number,
								createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
								createdBy: (data.createdBy as string) || 'Unknown',
								data: (data.reportData as Partial<PatientRecordFull>) || {},
							};
						});
						
						versions.sort((a, b) => 
							new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
						);
						
						setReportVersions(versions);
					} catch (retryError) {
						console.error('Failed to load report versions:', retryError);
					}
				} else {
					console.error('Failed to load report versions:', error);
				}
			} finally {
				setLoading(false);
			}
		};

		loadReportVersions();
	}, [patientId]);

	// Helper to extract numeric value from string
	const extractNumeric = (value: string | number | null | undefined): number | null => {
		if (typeof value === 'number') return value;
		if (!value) return null;
		const num = parseFloat(String(value).replace(/[^\d.]/g, ''));
		return !isNaN(num) ? num : null;
	};

	// Generate Natural Language Summary
	const naturalLanguageSummary = useMemo(() => {
		if (reportVersions.length === 0) {
			return "No report data available for analysis.";
		}

		const summaries: string[] = [];
		const firstReport = reportVersions[0];
		const lastReport = reportVersions[reportVersions.length - 1];
		const totalReports = reportVersions.length;

		// Overall progress introduction
		summaries.push(`This patient has ${totalReports} report${totalReports !== 1 ? 's' : ''} recorded over the course of treatment.`);

		// VAS Scale Analysis
		const firstVas = firstReport ? extractNumeric(firstReport.data.vasScale) : null;
		const lastVas = lastReport ? extractNumeric(lastReport.data.vasScale) : null;
		const vasChange = (firstVas !== null && lastVas !== null) ? firstVas - lastVas : null;
		
		if (firstVas !== null && lastVas !== null && vasChange !== null) {
			const vasPercentChange = ((vasChange / firstVas) * 100).toFixed(1);
			
			if (vasChange > 2) {
				summaries.push(`Pain levels have shown significant improvement, decreasing from ${firstVas.toFixed(1)} to ${lastVas.toFixed(1)} on the VAS scale (${vasPercentChange}% reduction).`);
			} else if (vasChange > 0.5) {
				summaries.push(`Pain levels have improved, decreasing from ${firstVas.toFixed(1)} to ${lastVas.toFixed(1)} on the VAS scale (${vasPercentChange}% reduction).`);
			} else if (vasChange < -1) {
				summaries.push(`Pain levels have increased from ${firstVas.toFixed(1)} to ${lastVas.toFixed(1)} on the VAS scale, indicating a need for treatment plan review.`);
			} else if (Math.abs(vasChange) <= 0.5) {
				summaries.push(`Pain levels have remained relatively stable, with minimal change from ${firstVas.toFixed(1)} to ${lastVas.toFixed(1)} on the VAS scale.`);
			}
		}

		// Pain Status Analysis
		const improvedCount = reportVersions.filter(v => v.data.currentPainStatus === 'Improved').length;
		const worsenedCount = reportVersions.filter(v => v.data.currentPainStatus === 'Worsened').length;
		const sameCount = reportVersions.filter(v => v.data.currentPainStatus === 'Same').length;
		
		if (improvedCount > totalReports * 0.5) {
			summaries.push(`The majority of reports (${improvedCount} out of ${totalReports}) indicate improvement in pain status.`);
		} else if (worsenedCount > totalReports * 0.3) {
			summaries.push(`${worsenedCount} out of ${totalReports} reports show worsened pain status, suggesting treatment adjustments may be necessary.`);
		}

		// Compliance Analysis
		const excellentCompliance = reportVersions.filter(v => v.data.complianceWithHEP === 'Excellent').length;
		const moderateCompliance = reportVersions.filter(v => v.data.complianceWithHEP === 'Moderate').length;
		const poorCompliance = reportVersions.filter(v => v.data.complianceWithHEP === 'Poor').length;
		
		if (excellentCompliance > totalReports * 0.5) {
			summaries.push(`Home exercise program compliance has been excellent in most sessions (${excellentCompliance} out of ${totalReports} reports).`);
		} else if (poorCompliance > totalReports * 0.3) {
			summaries.push(`Notable concerns with home exercise program compliance, with ${poorCompliance} out of ${totalReports} reports indicating poor compliance.`);
		}

		// Functional Ability Analysis
		const improvedFunctional = reportVersions.filter(v => v.data.currentFunctionalAbility === 'Improved').length;
		if (improvedFunctional > totalReports * 0.5) {
			summaries.push(`Functional ability has improved in ${improvedFunctional} out of ${totalReports} reports, indicating positive progress in daily activities.`);
		}

		// Treatment Duration
		if (totalReports > 1) {
			const firstDate = new Date(firstReport.createdAt);
			const lastDate = new Date(lastReport.createdAt);
			const daysDiff = Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
			const weeksDiff = Math.round(daysDiff / 7);
			
			if (weeksDiff > 0) {
				summaries.push(`Treatment has been ongoing for approximately ${weeksDiff} week${weeksDiff !== 1 ? 's' : ''} (${daysDiff} days).`);
			} else {
				summaries.push(`Treatment has been ongoing for ${daysDiff} day${daysDiff !== 1 ? 's' : ''}.`);
			}
		}

		// Overall Assessment
		if (improvedCount > worsenedCount && vasChange !== null && vasChange > 0) {
			summaries.push(`Overall, the patient demonstrates a positive treatment trajectory with consistent improvements in pain levels and functional status.`);
		} else if (worsenedCount > improvedCount || (vasChange !== null && vasChange < -1)) {
			summaries.push(`The treatment trajectory requires careful monitoring, with indicators suggesting the need for treatment plan modifications.`);
		}

		return summaries.join(' ');
	}, [reportVersions]);

	// Chart 1: VAS Scale Over Time
	const vasScaleData = useMemo(() => {
		const dataPoints = reportVersions
			.filter(v => v.data.vasScale)
			.map(v => ({
				date: new Date(v.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
				value: extractNumeric(v.data.vasScale),
				version: v.version,
			}))
			.filter(d => d.value !== null) as Array<{ date: string; value: number; version: number }>;

		if (dataPoints.length === 0) return null;

		return {
			labels: dataPoints.map(d => d.date),
			datasets: [{
				label: 'Pain Level (VAS Scale 0-10)',
				data: dataPoints.map(d => d.value),
				borderColor: 'rgba(239, 68, 68, 0.8)',
				backgroundColor: 'rgba(239, 68, 68, 0.1)',
				borderWidth: 3,
				fill: true,
			}],
		};
	}, [reportVersions]);

	// Chart 2: Pain Status Distribution
	const painStatusData = useMemo(() => {
		const statusCounts = reportVersions.reduce((acc, v) => {
			const status = v.data.currentPainStatus;
			if (status) {
				acc[status] = (acc[status] || 0) + 1;
			}
			return acc;
		}, {} as Record<string, number>);

		const labels = Object.keys(statusCounts);
		if (labels.length === 0) return null;

		return {
			labels,
			datasets: [{
				label: 'Status Count',
				data: labels.map(label => statusCounts[label]),
				backgroundColor: [
					'rgba(16, 185, 129, 0.85)',  // Improved - Emerald
					'rgba(251, 191, 36, 0.85)',  // Same - Amber
					'rgba(239, 68, 68, 0.85)',   // Worsened - Red
				],
				borderColor: '#ffffff',
				borderWidth: 2,
			}],
		};
	}, [reportVersions]);

	// Chart 3: Compliance with HEP
	const complianceData = useMemo(() => {
		const complianceCounts = reportVersions.reduce((acc, v) => {
			const compliance = v.data.complianceWithHEP;
			if (compliance) {
				acc[compliance] = (acc[compliance] || 0) + 1;
			}
			return acc;
		}, {} as Record<string, number>);

		const labels = Object.keys(complianceCounts);
		if (labels.length === 0) return null;

		return {
			labels,
			datasets: [{
				label: 'Compliance Count',
				data: labels.map(label => complianceCounts[label]),
				backgroundColor: [
					'rgba(16, 185, 129, 0.7)',  // Excellent - Emerald
					'rgba(251, 191, 36, 0.7)',  // Moderate - Amber
					'rgba(239, 68, 68, 0.7)',   // Poor - Red
				],
				borderColor: '#ffffff',
				borderWidth: 2,
			}],
		};
	}, [reportVersions]);

	// Chart 4: Progress Summary Bar Chart
	const progressSummaryData = useMemo(() => {
		const dataPoints = reportVersions
			.filter(v => v.data.vasScale)
			.map(v => ({
				version: `V${v.version}`,
				vas: extractNumeric(v.data.vasScale),
			}))
			.filter(d => d.vas !== null) as Array<{ version: string; vas: number }>;

		if (dataPoints.length === 0) return null;

		return {
			labels: dataPoints.map(d => d.version),
			datasets: [{
				label: 'Pain Level (VAS)',
				data: dataPoints.map(d => d.vas),
				backgroundColor: dataPoints.map(d => 
					d.vas! <= 3 ? 'rgba(16, 185, 129, 0.7)' :  // Green for low pain
					d.vas! <= 6 ? 'rgba(251, 191, 36, 0.7)' :  // Yellow for moderate
					'rgba(239, 68, 68, 0.7)'                    // Red for high pain
				),
				borderColor: '#ffffff',
				borderWidth: 2,
			}],
		};
	}, [reportVersions]);

	// Key Metrics
	const keyMetrics = useMemo(() => {
		const totalReports = reportVersions.length;
		const firstReport = reportVersions[0];
		const lastReport = reportVersions[reportVersions.length - 1];
		
		const firstVas = firstReport ? extractNumeric(firstReport.data.vasScale) : null;
		const lastVas = lastReport ? extractNumeric(lastReport.data.vasScale) : null;
		const vasImprovement = (firstVas !== null && lastVas !== null) ? firstVas - lastVas : null;
		
		const improvedReports = reportVersions.filter(v => v.data.currentPainStatus === 'Improved').length;
		const improvementRate = totalReports > 0 ? (improvedReports / totalReports) * 100 : 0;
		
		return {
			totalReports,
			vasImprovement,
			improvementRate: Math.round(improvementRate),
			firstVas,
			lastVas,
		};
	}, [reportVersions]);

	if (loading) {
		return (
			<div className="rounded-lg border border-slate-200 bg-white p-6">
				<div className="flex items-center justify-center py-8">
					<div className="text-slate-500">Loading progress data...</div>
				</div>
			</div>
		);
	}

	if (reportVersions.length === 0) {
		return (
			<div className="rounded-lg border border-slate-200 bg-white p-6">
				<div className="text-center py-8">
					<i className="fas fa-chart-line text-4xl text-slate-400 mb-2" aria-hidden="true" />
					<p className="text-sm text-slate-500">No report data available for progress tracking.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="rounded-lg border border-slate-200 bg-white p-6">
				<div className="mb-6">
					<h3 className="text-xl font-semibold text-slate-900">
						Progress Analytics
						{patientName && <span className="text-sm font-normal text-slate-500 ml-2">for {patientName}</span>}
					</h3>
					<p className="text-sm text-slate-600 mt-1">
						Tracking progress across {reportVersions.length} report{reportVersions.length !== 1 ? 's' : ''}
					</p>
				</div>

				{/* Natural Language Summary */}
				<div className="mb-6 rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
					<div className="flex items-start gap-3">
						<div className="flex-shrink-0 rounded-full bg-blue-100 p-2">
							<i className="fas fa-file-alt text-blue-600 text-lg" aria-hidden="true" />
						</div>
						<div className="flex-1">
							<h4 className="text-sm font-semibold text-blue-900 mb-2">Progress Summary</h4>
							<p className="text-sm leading-relaxed text-blue-800">{naturalLanguageSummary}</p>
						</div>
					</div>
				</div>

				{/* Key Metrics Cards */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
					<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
						<p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Total Reports</p>
						<p className="text-2xl font-bold text-blue-900 mt-1">{keyMetrics.totalReports}</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4">
						<p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">VAS Improvement</p>
						<p className="text-2xl font-bold text-emerald-900 mt-1">
							{keyMetrics.vasImprovement !== null 
								? `${keyMetrics.vasImprovement > 0 ? '+' : ''}${keyMetrics.vasImprovement.toFixed(1)}`
								: '—'
							}
						</p>
						{keyMetrics.firstVas !== null && keyMetrics.lastVas !== null && (
							<p className="text-xs text-emerald-700 mt-1">
								{keyMetrics.firstVas.toFixed(1)} → {keyMetrics.lastVas.toFixed(1)}
							</p>
						)}
					</div>
					<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4">
						<p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Improvement Rate</p>
						<p className="text-2xl font-bold text-purple-900 mt-1">{keyMetrics.improvementRate}%</p>
						<p className="text-xs text-purple-700 mt-1">Reports showing improvement</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-amber-50 to-amber-100 p-4">
						<p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Current VAS</p>
						<p className="text-2xl font-bold text-amber-900 mt-1">
							{keyMetrics.lastVas !== null ? keyMetrics.lastVas.toFixed(1) : '—'}
						</p>
					</div>
				</div>

				{/* Charts Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Chart 1: VAS Scale Over Time */}
					{vasScaleData && (
						<div className="rounded-lg border border-slate-200 bg-white p-4">
							<h4 className="text-sm font-semibold text-slate-700 mb-3">Pain Level (VAS Scale) Over Time</h4>
							<StatsChart type="line" data={vasScaleData} height={250} />
						</div>
					)}

					{/* Chart 2: Pain Status Distribution */}
					{painStatusData && (
						<div className="rounded-lg border border-slate-200 bg-white p-4">
							<h4 className="text-sm font-semibold text-slate-700 mb-3">Pain Status Distribution</h4>
							<StatsChart type="doughnut" data={painStatusData} height={250} />
						</div>
					)}

					{/* Chart 3: Compliance with HEP */}
					{complianceData && (
						<div className="rounded-lg border border-slate-200 bg-white p-4">
							<h4 className="text-sm font-semibold text-slate-700 mb-3">Compliance with Home Exercise Program</h4>
							<StatsChart type="doughnut" data={complianceData} height={250} />
						</div>
					)}

					{/* Chart 4: Progress Summary */}
					{progressSummaryData && (
						<div className="rounded-lg border border-slate-200 bg-white p-4">
							<h4 className="text-sm font-semibold text-slate-700 mb-3">Pain Level by Report Version</h4>
							<StatsChart type="bar" data={progressSummaryData} height={250} />
						</div>
					)}
				</div>

				{/* Progress Timeline Table */}
				<div className="mt-6">
					<h4 className="text-lg font-semibold text-slate-900 mb-4">Detailed Progress Timeline</h4>
					<div className="overflow-x-auto rounded-lg border border-slate-200">
						<table className="min-w-full divide-y divide-slate-200 text-sm">
							<thead className="bg-slate-50">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Version</th>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Date</th>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">VAS Scale</th>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Pain Status</th>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Functional Ability</th>
									<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Compliance</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 bg-white">
								{reportVersions.map((version) => (
									<tr key={version.id}>
										<td className="px-4 py-3 text-slate-700 font-medium">#{version.version}</td>
										<td className="px-4 py-3 text-slate-600">
											{new Date(version.createdAt).toLocaleDateString('en-IN', { 
												day: 'numeric', 
												month: 'short', 
												year: 'numeric' 
											})}
										</td>
										<td className="px-4 py-3 text-slate-700">
											{version.data.vasScale || '—'}
										</td>
										<td className="px-4 py-3">
											{version.data.currentPainStatus && (
												<span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
													version.data.currentPainStatus === 'Improved' 
														? 'bg-emerald-100 text-emerald-700'
														: version.data.currentPainStatus === 'Worsened'
														? 'bg-rose-100 text-rose-700'
														: 'bg-amber-100 text-amber-700'
												}`}>
													{version.data.currentPainStatus}
												</span>
											)}
										</td>
										<td className="px-4 py-3">
											{version.data.currentFunctionalAbility && (
												<span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
													version.data.currentFunctionalAbility === 'Improved'
														? 'bg-blue-100 text-blue-700'
														: 'bg-slate-100 text-slate-700'
												}`}>
													{version.data.currentFunctionalAbility}
												</span>
											)}
										</td>
										<td className="px-4 py-3">
											{version.data.complianceWithHEP && (
												<span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
													version.data.complianceWithHEP === 'Excellent'
														? 'bg-emerald-100 text-emerald-700'
														: version.data.complianceWithHEP === 'Moderate'
														? 'bg-amber-100 text-amber-700'
														: 'bg-rose-100 text-rose-700'
												}`}>
													{version.data.complianceWithHEP}
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
}

