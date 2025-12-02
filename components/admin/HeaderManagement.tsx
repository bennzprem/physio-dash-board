'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

export type HeaderType = 'reportDYES' | 'reportNonDYES' | 'billing' | 'invoice';

export interface HeaderConfig {
	id: string;
	type: HeaderType;
	leftLogo?: string; // Base64 or URL
	rightLogo?: string; // Base64 or URL
	mainTitle?: string;
	subtitle?: string;
	contactInfo?: string;
	associationText?: string;
	govermentOrder?: string;
	updatedAt?: string;
	updatedBy?: string;
}

const HEADER_TYPE_LABELS: Record<HeaderType, string> = {
	reportDYES: 'Report DYES',
	reportNonDYES: 'Report (Non-DYES)',
	billing: 'Billing',
	invoice: 'Invoice',
};

export default function HeaderManagement() {
	const { user } = useAuth();
	const [activeType, setActiveType] = useState<HeaderType>('reportDYES');
	const [config, setConfig] = useState<HeaderConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);

	const [formData, setFormData] = useState({
		mainTitle: '',
		subtitle: '',
		contactInfo: '',
		associationText: '',
		govermentOrder: '',
		leftLogoFile: null as File | null,
		rightLogoFile: null as File | null,
		leftLogoPreview: '',
		rightLogoPreview: '',
	});

	useEffect(() => {
		loadHeaderConfig();
	}, [activeType]);

	const loadHeaderConfig = async () => {
		setLoading(true);
		try {
			const docRef = doc(db, 'headerConfigs', activeType);
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				const data = docSnap.data() as HeaderConfig;
				setConfig(data);
				setFormData(prev => ({
					...prev,
					mainTitle: data.mainTitle || '',
					subtitle: data.subtitle || '',
					contactInfo: data.contactInfo || '',
					associationText: data.associationText || '',
					govermentOrder: data.govermentOrder || '',
					leftLogoPreview: data.leftLogo || '',
					rightLogoPreview: data.rightLogo || '',
				}));
			} else {
				// Set defaults
				setConfig(null);
				if (activeType === 'reportDYES') {
					setFormData(prev => ({
						...prev,
						mainTitle: 'CENTRE FOR SPORTS SCIENCE',
						subtitle: 'PHYSIOTHERAPY CONSULTATION & FOLLOW-UP REPORT',
						associationText: '(In association with Department of Youth Empowerment and Sports-Govt of Karnataka)',
						govermentOrder: 'GOVT ORDER: YU SE KRIE/VI/68/2016-17',
						contactInfo: '',
					}));
				} else if (activeType === 'reportNonDYES') {
					setFormData(prev => ({
						...prev,
						mainTitle: 'CENTRE FOR SPORTS SCIENCE',
						subtitle: 'PHYSIOTHERAPY CONSULTATION & FOLLOW-UP REPORT',
						contactInfo: 'Phone No: +91 9731128396 | Address: Sree Kanteerava Stadium Gate 8 and 10, Sampangiram Nagar, Bengaluru 560027',
						associationText: '',
						govermentOrder: '',
					}));
				} else if (activeType === 'billing') {
					setFormData(prev => ({
						...prev,
						mainTitle: 'CENTRE FOR SPORTS SCIENCE',
						subtitle: 'Sports Business Solutions Pvt. Ltd.',
						contactInfo: 'Sri Kanteerava Outdoor Stadium, Bangalore | Phone: +91 97311 28396',
						associationText: '',
						govermentOrder: '',
					}));
				} else if (activeType === 'invoice') {
					setFormData(prev => ({
						...prev,
						mainTitle: 'CENTRE FOR SPORTS SCIENCE',
						subtitle: 'Sports Business Solutions Pvt. Ltd.',
						contactInfo: 'Sri Kanteerava Outdoor Stadium, Bangalore | Phone: +91 97311 28396',
						associationText: '',
						govermentOrder: '',
					}));
				}
			}
		} catch (error) {
			console.error('Failed to load header config:', error);
			alert('Failed to load header configuration');
		} finally {
			setLoading(false);
		}
	};

	const handleFileChange = (type: 'left' | 'right', file: File | null) => {
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			alert('Please select an image file');
			return;
		}

		if (file.size > 5 * 1024 * 1024) {
			alert('Image size must be less than 5MB');
			return;
		}

		const reader = new FileReader();
		reader.onloadend = () => {
			const base64 = reader.result as string;
			if (type === 'left') {
				setFormData(prev => ({
					...prev,
					leftLogoFile: file,
					leftLogoPreview: base64,
				}));
			} else {
				setFormData(prev => ({
					...prev,
					rightLogoFile: file,
					rightLogoPreview: base64,
				}));
			}
		};
		reader.readAsDataURL(file);
	};

	const handleSave = async () => {
		setSaving(true);
		setSavedMessage(false);

		try {
			// Build header config object, only including fields that have values (not undefined)
			const headerConfig: Omit<HeaderConfig, 'id'> = {
				type: activeType,
				updatedAt: serverTimestamp() as any,
				updatedBy: user?.email || user?.displayName || 'Admin',
			};

			// Only add fields if they have values (avoid undefined)
			if (formData.mainTitle.trim()) {
				headerConfig.mainTitle = formData.mainTitle.trim();
			}
			if (formData.subtitle.trim()) {
				headerConfig.subtitle = formData.subtitle.trim();
			}
			if (formData.contactInfo.trim()) {
				headerConfig.contactInfo = formData.contactInfo.trim();
			}
			if (formData.associationText.trim()) {
				headerConfig.associationText = formData.associationText.trim();
			}
			if (formData.govermentOrder.trim()) {
				headerConfig.govermentOrder = formData.govermentOrder.trim();
			}
			if (formData.leftLogoPreview) {
				headerConfig.leftLogo = formData.leftLogoPreview;
			} else if (config?.leftLogo) {
				headerConfig.leftLogo = config.leftLogo;
			}
			if (formData.rightLogoPreview) {
				headerConfig.rightLogo = formData.rightLogoPreview;
			} else if (config?.rightLogo) {
				headerConfig.rightLogo = config.rightLogo;
			}

			const docRef = doc(db, 'headerConfigs', activeType);
			await setDoc(docRef, headerConfig, { merge: true });

			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);

			// Reload config to show saved values
			await loadHeaderConfig();
		} catch (error) {
			console.error('Failed to save header config:', error);
			alert('Failed to save header configuration');
		} finally {
			setSaving(false);
		}
	};

	const handleTypeChange = (type: HeaderType) => {
		setActiveType(type);
		setSavedMessage(false);
		// Reset file inputs when switching types
		setFormData(prev => ({
			...prev,
			leftLogoFile: null,
			rightLogoFile: null,
		}));
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="flex items-center justify-center py-20">
						<div className="text-center">
							<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
							<p className="text-sm text-slate-600">Loading header configuration...</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader
					title="Header Management"
				/>

				{savedMessage && (
					<div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
						<i className="fas fa-check-circle mr-2" aria-hidden="true" />
						Header configuration saved successfully!
					</div>
				)}

				{/* Header Type Selection */}
				<div className="section-card">
					<h2 className="mb-4 text-lg font-semibold text-slate-900">Select Document Type</h2>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{(Object.keys(HEADER_TYPE_LABELS) as HeaderType[]).map(type => (
							<button
								key={type}
								type="button"
								onClick={() => handleTypeChange(type)}
								className={`rounded-lg border-2 px-4 py-3 text-left transition ${
									activeType === type
										? 'border-sky-600 bg-sky-50 text-sky-900'
										: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
								}`}
							>
								<div className="font-semibold">{HEADER_TYPE_LABELS[type]}</div>
							</button>
						))}
					</div>
				</div>

				{/* Header Configuration Form */}
				<div className="section-card">
					<h2 className="mb-6 text-lg font-semibold text-slate-900">
						Configure {HEADER_TYPE_LABELS[activeType]} Header
					</h2>

					<div className="space-y-6">
						{/* Logos Section */}
						<div className="border-b border-slate-200 pb-6">
							<h3 className="mb-4 text-md font-semibold text-slate-700">Logos</h3>
							<div className="grid gap-6 sm:grid-cols-2">
								{/* Left Logo */}
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">
										Left Logo
									</label>
									<div className="mb-2">
										<input
											type="file"
											accept="image/*"
											onChange={e => handleFileChange('left', e.target.files?.[0] || null)}
											className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
										/>
									</div>
									{formData.leftLogoPreview && (
										<div className="mt-2 rounded-lg border border-slate-200 p-2 bg-white">
											<img
												src={formData.leftLogoPreview}
												alt="Left logo preview"
												className="max-h-24 max-w-full object-contain"
											/>
										</div>
									)}
								</div>

								{/* Right Logo */}
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">
										Right Logo
									</label>
									<div className="mb-2">
										<input
											type="file"
											accept="image/*"
											onChange={e => handleFileChange('right', e.target.files?.[0] || null)}
											className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
										/>
									</div>
									{formData.rightLogoPreview && (
										<div className="mt-2 rounded-lg border border-slate-200 p-2 bg-white">
											<img
												src={formData.rightLogoPreview}
												alt="Right logo preview"
												className="max-h-24 max-w-full object-contain"
											/>
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Main Title */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">
								Main Title
							</label>
							<input
								type="text"
								value={formData.mainTitle}
								onChange={e => setFormData(prev => ({ ...prev, mainTitle: e.target.value }))}
								placeholder="e.g., CENTRE FOR SPORTS SCIENCE"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						{/* Subtitle (for billing/invoice) or Report Header */}
						{(activeType === 'billing' || activeType === 'invoice' || activeType === 'reportDYES' || activeType === 'reportNonDYES') && (
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									{activeType === 'billing' || activeType === 'invoice' ? 'Subtitle' : 'Report Header'}
								</label>
								<input
									type="text"
									value={formData.subtitle}
									onChange={e => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
									placeholder={activeType === 'billing' || activeType === 'invoice' ? 'e.g., Sports Business Solutions Pvt. Ltd.' : 'e.g., PHYSIOTHERAPY CONSULTATION & FOLLOW-UP REPORT'}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						)}

						{/* Contact Info */}
						{(activeType === 'reportNonDYES' || activeType === 'billing' || activeType === 'invoice') && (
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Contact Information
								</label>
								<textarea
									value={formData.contactInfo}
									onChange={e => setFormData(prev => ({ ...prev, contactInfo: e.target.value }))}
									placeholder="e.g., Phone No: +91 9731128396 | Address: Sree Kanteerava Stadium Gate 8 and 10, Sampangiram Nagar, Bengaluru 560027"
									rows={2}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						)}

						{/* Association Text (for DYES reports) */}
						{activeType === 'reportDYES' && (
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Association Text
								</label>
								<textarea
									value={formData.associationText}
									onChange={e => setFormData(prev => ({ ...prev, associationText: e.target.value }))}
									placeholder="e.g., (In association with Department of Youth Empowerment and Sports-Govt of Karnataka)"
									rows={2}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						)}

						{/* Government Order (for DYES reports) */}
						{activeType === 'reportDYES' && (
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Government Order
								</label>
								<input
									type="text"
									value={formData.govermentOrder}
									onChange={e => setFormData(prev => ({ ...prev, govermentOrder: e.target.value }))}
									placeholder="e.g., GOVT ORDER: YU SE KRIE/VI/68/2016-17"
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						)}
					</div>

					{/* Save Button */}
					<div className="mt-8 flex justify-end gap-4 border-t border-slate-200 pt-6">
						<button
							type="button"
							onClick={handleSave}
							disabled={saving}
							className="inline-flex items-center rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{saving ? (
								<>
									<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
									Saving...
								</>
							) : (
								<>
									<i className="fas fa-save mr-2" aria-hidden="true" />
									Save Configuration
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

