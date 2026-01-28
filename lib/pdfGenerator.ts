'use client';

export interface PatientReportData {
	patientName: string;
	patientId: string;
	referredBy?: string;
	age?: string;
	gender?: string;
	dateOfConsultation?: string;
	contact?: string;
	email?: string;
	// Session tracking
	totalSessionsRequired?: number;
	remainingSessions?: number;
	history?: string;
	medicalHistory?: string;
	surgicalHistory?: string;
	sleepCycle?: string;
	hydration?: string;
	nutrition?: string;
	chiefComplaint?: string;
	duration?: string;
	mechanismOfInjury?: string;
	painIntensity?: string;
	painType?: string;
	aggravatingFactor?: string;
	relievingFactor?: string;
	siteSide?: string;
	onset?: string;
	natureOfInjury?: string;
	vasScale?: string;
	rom?: Record<string, any>;
	mmt?: Record<string, any>;
	built?: string;
	posture?: string;
	postureManualNotes?: string;
	postureFileName?: string;
	gaitAnalysis?: string;
	gaitManualNotes?: string;
	gaitFileName?: string;
	mobilityAids?: string;
	localObservation?: string;
	swelling?: string;
	muscleWasting?: string;
	tenderness?: string;
	warmth?: string;
	scar?: string;
	crepitus?: string;
	odema?: string;
	specialTest?: string;
	differentialDiagnosis?: string;
	finalDiagnosis?: string;
	shortTermGoals?: string;
	longTermGoals?: string;
	treatment?: string;
	treatmentProvided?: string;
	advice?: string;
	managementRemarks?: string;
	nextFollowUpDate?: string;
	nextFollowUpTime?: string;
	followUpVisits?: Array<{ visitDate: string; painLevel: string; findings: string }>;
	currentPainStatus?: string;
	currentRom?: string;
	currentStrength?: string;
	currentFunctionalAbility?: string;
	complianceWithHEP?: string;
	physioName?: string;
	patientType?: string;
}

const HYDRATION_DESCRIPTORS = [
	'Optimal hydration',
	'Well hydrated',
	'Mildly hydrated',
	'Stable',
	'Slightly dry',
	'Dehydrated',
	'Very dry',
	'Severely dry',
];

const VAS_EMOJIS = ['😀', '😁', '🙂', '😊', '😌', '😟', '😣', '😢', '😭', '😱'];

const getVasDescriptor = (value?: string) => {
	const score = Number(value || '5');
	return `${score}/10`;
};

const getHydrationDescriptor = (value?: string) => {
	const score = Number(value || '4');
	const emoji = HYDRATION_DESCRIPTORS[Math.min(HYDRATION_DESCRIPTORS.length - 1, Math.max(1, score) - 1)];
	return `${score}/8 - ${emoji}`;
};

const formatJointData = (records: Record<string, any> = {}) => {
	return Object.entries(records)
		.map(([joint, entry]) => {
			if (!entry) return null;
			if (entry.left || entry.right) {
				const left = entry.left
					? Object.entries(entry.left)
							.filter(([, val]) => val)
							.map(([motion, val]) => `Left ${motion}: ${val}`)
							.join(', ')
					: '';
				const right = entry.right
					? Object.entries(entry.right)
							.filter(([, val]) => val)
							.map(([motion, val]) => `Right ${motion}: ${val}`)
							.join(', ')
					: '';
				const summary = [left, right].filter(Boolean).join(' | ');
				return summary ? [joint, summary] : null;
			}

			const summary = Object.entries(entry)
				.filter(([, val]) => val)
				.map(([motion, val]) => `${motion}: ${val}`)
				.join(', ');
			return summary ? [joint, summary] : null;
		})
		.filter(Boolean) as string[][];
};

const buildCurrentStatus = (data: PatientReportData) => {
	return (
		`Pain: ${data.currentPainStatus || ''}\n` +
		`ROM: ${data.currentRom || ''}\n` +
		`Strength: ${data.currentStrength || ''}\n` +
		`Functional Ability: ${data.currentFunctionalAbility || ''}\n` +
		`HEP Compliance: ${data.complianceWithHEP || ''}`
	);
};

const baseStyles = {
	fontSize: 9,
	cellPadding: 2,
	lineWidth: 0.1,
};

const headStyles = {
	fillColor: [7, 89, 133] as [number, number, number],
	fontSize: 10,
	halign: 'left' as const,
	cellPadding: 2,
	textColor: [255, 255, 255] as [number, number, number],
};

export type ReportSection = 
	| 'patientInformation'
	| 'assessmentOverview'
	| 'painAssessment'
	| 'onObservation'
	| 'onPalpation'
	| 'rom'
	| 'mmt'
	| 'advancedAssessment'
	| 'physiotherapyManagement'
	| 'followUpVisits'
	| 'currentStatus'
	| 'nextFollowUp'
	| 'signature';

export async function generatePhysiotherapyReportPDF(
	data: PatientReportData,
	options?: { forPrint?: boolean; sections?: ReportSection[] }
): Promise<string | void> {
	try {
		console.log('Starting PDF generation...', { forPrint: options?.forPrint, hasSections: !!options?.sections });
		
		const [{ default: jsPDF }, autoTableModule] = await Promise.all([
			import('jspdf'),
			import('jspdf-autotable'),
		]);

		// jspdf-autotable v5 exports the function as default
		const autoTable = (autoTableModule as any).default || autoTableModule;

		// If sections are specified, only include those sections. Otherwise, include all.
		const includeSection = (section: ReportSection): boolean => {
			if (!options?.sections) return true; // Include all if no sections specified
			if (!Array.isArray(options.sections)) return true; // Include all if sections is not an array
			return options.sections.includes(section);
		};

		// Load header configuration based on patient type
		const patientTypeUpper = data.patientType?.toUpperCase() || '';
		const isDYES = patientTypeUpper === 'DYES';
		const headerType = isDYES ? 'reportDYES' : 'reportNonDYES';
		
		const { getHeaderConfig, getDefaultHeaderConfig } = await import('./headerConfig');
		const headerConfig = await getHeaderConfig(headerType);
		const defaultConfig = getDefaultHeaderConfig(headerType);
		
		// Priority: 1. Admin config, 2. Default config
		// Admin changes have FIRST priority - use configured values or fall back to defaults
		const headerSettings = {
			mainTitle: headerConfig?.mainTitle || defaultConfig.mainTitle || 'CENTRE FOR SPORTS SCIENCE',
			subtitle: headerConfig?.subtitle || defaultConfig.subtitle || 'PHYSIOTHERAPY CONSULTATION & FOLLOW-UP REPORT',
			contactInfo: headerConfig?.contactInfo || defaultConfig.contactInfo || '',
			associationText: headerConfig?.associationText || defaultConfig.associationText || '',
			govermentOrder: headerConfig?.govermentOrder || defaultConfig.govermentOrder || '',
			leftLogo: headerConfig?.leftLogo || null,
			rightLogo: headerConfig?.rightLogo || null,
		};

		const doc = new jsPDF('p', 'mm', 'a4');
	const pageWidth = 210; // A4 width in mm
	const pageHeight = 297; // A4 height in mm
	const pageMargin = 10; // Left and right margin
	const footerHeight = 15; // Space reserved for footer
	const logoWidth = 35;
	const logoHeight = 18;
	const leftLogoX = pageMargin; // Left logo aligned to left margin
	const rightLogoX = pageWidth - pageMargin - logoWidth; // Right logo aligned to right margin
	const pageCenterX = pageWidth / 2; // Center of full page width (105mm)
	
	// Track which pages have footers to avoid duplicates
	const pagesWithFooter = new Set<number>();
	
	// Set up footer callback for all pages
	const addFooter = (pageData: any) => {
		// Get page number from pageData (from autoTable) or from doc internal
		let pageNumber: number;
		let totalPages: number;
		
		if (pageData && pageData.pageNumber !== undefined) {
			// From autoTable callback
			pageNumber = pageData.pageNumber;
			totalPages = pageData.pageCount || (doc as any).internal.getNumberOfPages();
		} else {
			// Manual page addition - use internal API
			pageNumber = (doc as any).internal.getCurrentPageInfo().pageNumber;
			totalPages = (doc as any).internal.getNumberOfPages();
		}
		
		// Skip if footer already added to this page
		if (pagesWithFooter.has(pageNumber)) {
			return;
		}
		pagesWithFooter.add(pageNumber);
		
		const footerY = pageHeight - 8; // Position footer 8mm from bottom
		
		// Add footer line
		doc.setDrawColor(200, 200, 200);
		doc.setLineWidth(0.1);
		doc.line(pageMargin, footerY - 2, pageWidth - pageMargin, footerY - 2);
		
		// Add page number
		doc.setFontSize(8);
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(100, 100, 100);
		doc.text(
			`Page ${pageNumber} of ${totalPages}`,
			pageCenterX,
			footerY,
			{ align: 'center' }
		);
	};

	// All elements (logo, text, logo) aligned in single row at same height
	const headerY = 10; // Starting Y position - same for all elements
	const headerEndY = headerY + logoHeight; // Ending Y position - same for all elements

	// Load and add left logo (from config or default)
	if (headerSettings.leftLogo) {
		try {
			// If it's a base64 string, use it directly; otherwise try to fetch
			if (headerSettings.leftLogo.startsWith('data:')) {
				doc.addImage(headerSettings.leftLogo, 'JPEG', leftLogoX, headerY, logoWidth, logoHeight);
			} else {
				const logoResponse = await fetch(headerSettings.leftLogo);
				if (logoResponse.ok) {
					const logoBlob = await logoResponse.blob();
					const logoDataUrl = await new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(logoBlob);
					});
					doc.addImage(logoDataUrl, 'JPEG', leftLogoX, headerY, logoWidth, logoHeight);
				}
			}
		} catch (error) {
			console.warn('Could not load configured left logo, trying default:', error);
			// Fallback to default logo
			try {
				const centerLogoResponse = await fetch('/CenterSportsScience_logo.jpg');
				if (centerLogoResponse.ok) {
					const centerLogoBlob = await centerLogoResponse.blob();
					const centerLogoDataUrl = await new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(centerLogoBlob);
					});
					doc.addImage(centerLogoDataUrl, 'JPEG', leftLogoX, headerY, logoWidth, logoHeight);
				}
			} catch (fallbackError) {
				console.warn('Could not load default left logo:', fallbackError);
			}
		}
	} else {
		// Use default logo
		try {
			const centerLogoResponse = await fetch('/CenterSportsScience_logo.jpg');
			if (centerLogoResponse.ok) {
				const centerLogoBlob = await centerLogoResponse.blob();
				const centerLogoDataUrl = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(centerLogoBlob);
				});
				doc.addImage(centerLogoDataUrl, 'JPEG', leftLogoX, headerY, logoWidth, logoHeight);
			}
		} catch (error) {
			console.warn('Could not load Center Sports Science logo:', error);
		}
	}

	// Load and add right logo (from config or default)
	if (headerSettings.rightLogo) {
		try {
			// If it's a base64 string, use it directly; otherwise try to fetch
			if (headerSettings.rightLogo.startsWith('data:')) {
				doc.addImage(headerSettings.rightLogo, 'JPEG', rightLogoX, headerY, logoWidth, logoHeight);
			} else {
				const logoResponse = await fetch(headerSettings.rightLogo);
				if (logoResponse.ok) {
					const logoBlob = await logoResponse.blob();
					const logoDataUrl = await new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(logoBlob);
					});
					doc.addImage(logoDataUrl, 'JPEG', rightLogoX, headerY, logoWidth, logoHeight);
				}
			}
		} catch (error) {
			console.warn('Could not load configured right logo, trying default:', error);
			// Fallback to default logo
			const rightLogoPath = isDYES ? '/Dyes_logo.jpg' : '/sixs_logo.jpg';
			try {
				const rightLogoResponse = await fetch(rightLogoPath);
				if (rightLogoResponse.ok) {
					const rightLogoBlob = await rightLogoResponse.blob();
					const rightLogoDataUrl = await new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(rightLogoBlob);
					});
					doc.addImage(rightLogoDataUrl, 'JPEG', rightLogoX, headerY, logoWidth, logoHeight);
				}
			} catch (fallbackError) {
				console.warn('Could not load default right logo:', fallbackError);
			}
		}
	} else {
		// Use default logo
		const rightLogoPath = isDYES ? '/Dyes_logo.jpg' : '/sixs_logo.jpg';
		try {
			const rightLogoResponse = await fetch(rightLogoPath);
			if (rightLogoResponse.ok) {
				const rightLogoBlob = await rightLogoResponse.blob();
				const rightLogoDataUrl = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(rightLogoBlob);
				});
				doc.addImage(rightLogoDataUrl, 'JPEG', rightLogoX, headerY, logoWidth, logoHeight);
			}
		} catch (error) {
			console.warn('Could not load right logo:', error);
		}
	}

	// Calculate text baseline to center it vertically within the logo height
	// headerY + (logoHeight / 2) centers the text baseline in the middle of the logo
	const textBaselineY = headerY + (logoHeight / 2);
	
	// Title - Centered vertically within the same row as logos (from config)
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(20);
	doc.setTextColor(0, 51, 102);
	// Center text across full page width (flexbox-like behavior: text centered in full width)
	doc.text(headerSettings.mainTitle || 'CENTRE FOR SPORTS SCIENCE', pageCenterX, textBaselineY, { align: 'center' });
	
	// Phone and address - positioned just below "CENTRE FOR SPORTS SCIENCE"
	let y = headerEndY + 4; // Start just below the header row
	
	// Add contact information for PAID, VIP, GETHNA patients, or DYES association text for DYES patients
	if (isDYES) {
		// DYES association text - positioned just below the title (from config)
		if (headerSettings.associationText) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(0, 0, 0);
			// Center text across full page width
			doc.text(headerSettings.associationText, pageCenterX, y, { align: 'center' });
			y += 4;
		}
		if (headerSettings.govermentOrder) {
			doc.setFontSize(8);
			doc.text(headerSettings.govermentOrder, pageCenterX, y, { align: 'center' });
			y += 4;
		}
		y += 6; // One line space
	} else {
		// For all non-DYES patients (PAID, VIP, GETHNA, or any other type), show phone and address just below title (from config)
		if (headerSettings.contactInfo) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(7); // Smaller font size
			doc.setTextColor(0, 0, 0);
			const contactLines = doc.splitTextToSize(headerSettings.contactInfo, 180);
			// Center text across full page width - positioned just below "CENTRE FOR SPORTS SCIENCE"
			doc.text(contactLines, pageCenterX, y, { align: 'center' });
			y += contactLines.length * 3.5; // Adjust spacing based on number of lines
			y += 2.5; // Additional spacing to make it one line space total
		}
	}
	
	// Next header in green color (from config)
	if (headerSettings.subtitle) {
		doc.setFontSize(12);
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(0, 128, 0); // Green color
		// Center text across full page width
		doc.text(headerSettings.subtitle, pageCenterX, y, { align: 'center' });
		y += 6;
	}

	y += 6;
	doc.setDrawColor(0, 51, 102);
	doc.line(12, y, 198, y);
	y += 4;

	// Helper function to check if we need a new page before adding a table
	const checkPageBreak = (requiredSpace: number = 30) => {
		const availableSpace = pageHeight - y - footerHeight - pageMargin;
		if (availableSpace < requiredSpace) {
			doc.addPage();
			y = pageMargin + 20; // Start new page with some top margin
		}
	};

	// Build patient information body
	const patientInfoBody: string[][] = [
		['Patient Name', data.patientName],
	];
	
	// Add Type of Organization right after Patient Name if available
	if (data.patientType) {
		patientInfoBody.push(['Type of Organization', data.patientType]);
	}
	
	// Add remaining patient information
	patientInfoBody.push(
		['Patient ID', data.patientId],
		['Referred By / Doctor', data.referredBy || ''],
		['Age / Gender', `${data.age || ''} / ${data.gender || ''}`],
		['Date of Consultation', data.dateOfConsultation || ''],
		['Contact / Email', `${data.contact || ''} / ${data.email || ''}`],
	);
	
	// Add session information
	patientInfoBody.push(
		['Total Sessions Required', data.totalSessionsRequired != null ? String(data.totalSessionsRequired) : ''],
		['Remaining Sessions', data.remainingSessions != null ? String(data.remainingSessions) : '']
	);

	if (includeSection('patientInformation')) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['PATIENT INFORMATION', '']],
			body: patientInfoBody,
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 60 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('assessmentOverview')) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ASSESSMENT OVERVIEW', '']],
		body: [
			['History', data.history || ((data as any).presentHistory || '') + ((data as any).pastHistory ? '\n' + (data as any).pastHistory : '')],
			['Medical History', data.medicalHistory || ''],
			['Surgical History', data.surgicalHistory || ''],
			['Sleep Cycle', data.sleepCycle || ''],
			['Hydration', getHydrationDescriptor(data.hydration)],
			['Nutrition', data.nutrition || ''],
		],
		headStyles,
		styles: baseStyles,
		columnStyles: { 0: { cellWidth: 60 } },
		margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
		didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('painAssessment')) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['PAIN ASSESSMENT', '']],
		body: [
			['Site and Side', data.siteSide || ''],
			['Onset', data.onset || ''],
			['Duration', data.duration || ''],
			['Nature of Injury', data.natureOfInjury || ''],
			['Pain Type', data.painType || ''],
			['Pain Intensity', data.painIntensity || ''],
			['VAS Scale', getVasDescriptor(data.vasScale)],
			['Aggravating Factors', data.aggravatingFactor || ''],
			['Relieving Factors', data.relievingFactor || ''],
			['Mechanism of Injury', data.mechanismOfInjury || ''],
		],
		headStyles,
		styles: baseStyles,
		columnStyles: { 0: { cellWidth: 60 } },
		margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
		didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('onObservation')) {
		checkPageBreak(40); // Ensure enough space for the table
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ON OBSERVATION', '']],
			body: [
				['Built', data.built || ''],
				['Posture', `${data.posture || ''}${data.postureManualNotes ? ` | Notes: ${data.postureManualNotes}` : ''}`],
				['Kinetisense Upload', data.postureFileName || '—'],
				['GAIT Analysis', `${data.gaitAnalysis || ''}${data.gaitManualNotes ? ` | Notes: ${data.gaitManualNotes}` : ''}`],
				['OptaGAIT Upload', data.gaitFileName || '—'],
				['Mobility Aids', data.mobilityAids || ''],
				['Local Observation', data.localObservation || ''],
				['Swelling', data.swelling || ''],
				['Muscle Wasting', data.muscleWasting || ''],
			],
			headStyles,
			styles: {
				...baseStyles,
				overflow: 'linebreak',
				cellWidth: 'wrap',
			},
			columnStyles: { 
				0: { cellWidth: 60 },
				1: { cellWidth: 'auto', overflow: 'linebreak' },
			},
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('onPalpation')) {
		checkPageBreak(30);
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ON PALPATION', '']],
			body: [
				['Tenderness', data.tenderness || ''],
				['Warmth', data.warmth || ''],
				['Scar', data.scar || ''],
				['Crepitus', data.crepitus || ''],
				['Odema', data.odema || ''],
			],
			headStyles,
			styles: {
				...baseStyles,
				overflow: 'linebreak',
			},
			columnStyles: { 
				0: { cellWidth: 60 },
				1: { cellWidth: 'auto', overflow: 'linebreak' },
			},
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('rom')) {
		const romRows = formatJointData(data.rom);
		if (romRows.length) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ON EXAMINATION — ROM (i)', 'Details']],
			body: romRows,
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 60 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
		}
	}

	if (includeSection('mmt')) {
		const mmtRows = formatJointData(data.mmt);
		if (mmtRows.length) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ON EXAMINATION — Manual Muscle Testing (ii)', 'Details']],
			body: mmtRows,
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 80 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
		}
	}

	if (includeSection('advancedAssessment')) {
		const advancedRows: string[][] = [];
		if (data.specialTest) advancedRows.push(['Special Tests', data.specialTest]);
		if (data.differentialDiagnosis) advancedRows.push(['Differential Diagnosis', data.differentialDiagnosis]);
		if (data.finalDiagnosis) advancedRows.push(['Diagnosis', data.finalDiagnosis]);
		if (advancedRows.length) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['ADVANCED ASSESSMENT', '']],
			body: advancedRows,
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 60 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
		}
	}

	if (includeSection('physiotherapyManagement') || includeSection('currentStatus') || includeSection('nextFollowUp') || includeSection('signature')) {
		doc.addPage();
		y = 12;
	}

	if (includeSection('physiotherapyManagement')) {
		const managementRows: string[][] = [];
	if (data.shortTermGoals) managementRows.push(['i) Short Term Goals', data.shortTermGoals]);
	if (data.longTermGoals) managementRows.push(['ii) Long Term Goals', data.longTermGoals]);
	if (data.treatment || data.treatmentProvided) managementRows.push(['iii) Treatment', data.treatment || data.treatmentProvided || '']);
	if (data.advice) managementRows.push(['iv) Advice', data.advice]);
	if (managementRows.length) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['PHYSIOTHERAPY MANAGEMENT', '']],
			body: managementRows,
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 60 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
		}
	}

	if (includeSection('currentStatus')) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['CURRENT STATUS']],
		body: [[buildCurrentStatus(data)]],
		headStyles,
		styles: { ...baseStyles, cellPadding: 3 },
		margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
		didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 6;
	}

	if (includeSection('nextFollowUp') && (data.nextFollowUpDate || data.nextFollowUpTime)) {
		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [['NEXT FOLLOW-UP DETAILS', '']],
			body: [
				['Date', data.nextFollowUpDate || ''],
				['Time', data.nextFollowUpTime || ''],
			],
			headStyles,
			styles: baseStyles,
			columnStyles: { 0: { cellWidth: 60 } },
			margin: { top: y, right: pageMargin, bottom: footerHeight, left: pageMargin },
			didDrawPage: addFooter,
		});
		y = (doc as any).lastAutoTable.finalY + 10;
	} else if (includeSection('nextFollowUp')) {
		y += 10;
	}

	if (includeSection('signature')) {
		// Ensure signature is not too close to footer - leave at least 15mm space
		const signatureY = Math.min(y, pageHeight - footerHeight - 10);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10);
		doc.text('Physiotherapist Signature:', 12, signatureY);
		doc.setFont('helvetica', 'normal');
		doc.text(data.physioName || '', 65, signatureY);

	}

	// Add footer to all pages that don't have it yet (final pass)
	// This ensures all pages have footers even if autoTable didn't trigger the callback
	const totalPages = (doc as any).internal.getNumberOfPages();
	for (let i = 1; i <= totalPages; i++) {
		(doc as any).setPage(i);
		addFooter({ pageNumber: i, pageCount: totalPages });
	}

		if (options?.forPrint) {
			try {
				console.log('Generating PDF for print...');
				// Generate PDF blob
				const pdfBlob = doc.output('blob');
				const pdfUrl = URL.createObjectURL(pdfBlob);
				console.log('PDF blob created, URL:', pdfUrl);
				
				// Create a hidden iframe to load the PDF
				const iframe = document.createElement('iframe');
				iframe.style.position = 'fixed';
				iframe.style.right = '0';
				iframe.style.bottom = '0';
				iframe.style.width = '0';
				iframe.style.height = '0';
				iframe.style.border = 'none';
				iframe.style.visibility = 'hidden';
				iframe.style.opacity = '0';
				iframe.src = pdfUrl;
				
				document.body.appendChild(iframe);
				
				let printAttempted = false;
				
				const attemptPrint = () => {
					if (printAttempted) return;
					printAttempted = true;
					
					setTimeout(() => {
						try {
							// Try to print from iframe
							if (iframe.contentWindow) {
								iframe.contentWindow.focus();
								iframe.contentWindow.print();
							} else {
								throw new Error('iframe contentWindow not available');
							}
						} catch (iframeError) {
							// If iframe printing fails, try opening in new window
							console.warn('Iframe print failed, trying window.open:', iframeError);
							try {
								const printWindow = window.open(pdfUrl, '_blank');
								if (printWindow) {
									// Wait a bit for PDF to load, then print
									setTimeout(() => {
										try {
											printWindow.print();
										} catch (winError) {
											console.error('Window print failed:', winError);
										}
									}, 1500);
								}
							} catch (winError) {
								console.error('Failed to open print window:', winError);
							}
						}
						
						// Clean up iframe after a delay
						setTimeout(() => {
							if (iframe.parentNode) {
								document.body.removeChild(iframe);
							}
							// Don't revoke URL immediately - let print dialog finish
							setTimeout(() => {
								URL.revokeObjectURL(pdfUrl);
							}, 5000);
						}, 2000);
					}, 800);
				};
				
				// Try when iframe loads
				iframe.onload = attemptPrint;
				
				// Fallback: try after timeout even if onload doesn't fire
				setTimeout(() => {
					if (!printAttempted && iframe.parentNode) {
						attemptPrint();
					}
				}, 2500);
			
				return pdfUrl;
			} catch (error) {
				console.error('Error generating PDF for print:', error);
				throw error;
			}
		} else {
			try {
				console.log('Saving PDF for download...');
				doc.save(`Physiotherapy_Report_${data.patientId}.pdf`);
				console.log('PDF saved successfully');
			} catch (error) {
				console.error('Error saving PDF:', error);
				throw error;
			}
		}
	} catch (error) {
		console.error('Error in generatePhysiotherapyReportPDF:', error);
		throw error;
	}
}

export interface StrengthConditioningData {
	therapistName?: string;
	assessmentDate?: string; // Date of assessment
	uploadedPdfUrl?: string | null; // URL of uploaded PDF document
	// Athlete Profile
	sports?: string;
	trainingAge?: string;
	competitionLevel?: string;
	injuryHistory?: string;
	dominantSide?: 'Right' | 'Left';
	// Periodization
	seasonPhase?: 'Off-Season' | 'On-Season' | 'Competition';
	matchDates?: string[]; // List of match dates
	// Skill Training
	skillType?: 'Sports specific' | 'Fitness specific';
	skillDuration?: string; // Time range e.g., "10:00 am to 11:00 am"
	skillRPEPlanned?: number; // 1-10
	skillPRPEPerceived?: number; // 1-10
	// Strength & Conditioning
	scType?: 'Strength' | 'Endurance' | 'Speed & Power' | 'Agility' | 'Mobility' | 'Prehab' | 'Recovery';
	scDuration?: string; // Time in 24hrs format
	scRPEPlanned?: number; // 1-10
	scPRPEPerceived?: number; // 1-10
	// Exercise Log (array of exercises)
	exercises?: Array<{
		exerciseName?: string;
		sets?: number;
		reps?: number;
		load?: number; // kg/lb
		rest?: number; // seconds
		distance?: number;
		avgHR?: number; // Heart rate
	}>;
	// Wellness Score
	sleepDuration?: number; // hours
	sleepQuality?: number; // 1-10
	stressLevel?: number; // 1-10
	muscleSoreness?: number; // 1-10
	moodState?: 'Highly Motivated' | 'Normal / OK' | 'Demotivated';
	// ACWR
	dailyWorkload?: number; // A.U.
	acuteWorkload?: number; // Last 7 days total
	chronicWorkload?: number; // Last 28 days average
	acwrRatio?: number; // Automatically calculated
	// Existing fields
	scapularDyskinesiaTest?: string;
	upperLimbFlexibilityRight?: string;
	upperLimbFlexibilityLeft?: string;
	shoulderInternalRotationRight?: string;
	shoulderInternalRotationLeft?: string;
	shoulderExternalRotationRight?: string;
	shoulderExternalRotationLeft?: string;
	thoracicRotation?: string;
	sitAndReachTest?: string;
	singleLegSquatRight?: string;
	singleLegSquatLeft?: string;
	weightBearingLungeTestRight?: string;
	weightBearingLungeTestLeft?: string;
	hamstringsFlexibilityRight?: string;
	hamstringsFlexibilityLeft?: string;
	quadricepsFlexibilityRight?: string;
	quadricepsFlexibilityLeft?: string;
	hipExternalRotationRight?: string;
	hipExternalRotationLeft?: string;
	hipInternalRotationRight?: string;
	hipInternalRotationLeft?: string;
	hipExtensionRight?: string;
	hipExtensionLeft?: string;
	activeSLRRight?: string;
	activeSLRLeft?: string;
	pronePlank?: string;
	sidePlankRight?: string;
	sidePlankLeft?: string;
	storkStandingBalanceTestRight?: string;
	storkStandingBalanceTestLeft?: string;
	deepSquat?: string;
	pushup?: string;
	fmsScore?: string;
	totalFmsScore?: string;
	summary?: string;
}

export interface StrengthConditioningPDFData {
	patient: {
		name?: string;
		patientId?: string;
		dob?: string;
		gender?: string;
		phone?: string;
		email?: string;
	};
	formData: StrengthConditioningData;
	uploadedPdfUrl?: string | null;
}

export async function generateStrengthConditioningPDF(
	data: StrengthConditioningPDFData,
	options?: { forPrint?: boolean }
): Promise<void> {
	try {
		const [{ default: jsPDF }, autoTableModule] = await Promise.all([
			import('jspdf'),
			import('jspdf-autotable'),
		]);

		const autoTable = (autoTableModule as any).default || autoTableModule;
		const doc = new jsPDF('p', 'mm', 'a4');
		const pageWidth = 210;
		const pageHeight = 297;
		const pageMargin = 10;
		let y = 20;

		// Title
		doc.setFontSize(16);
		doc.setFont('helvetica', 'bold');
		doc.text('Strength and Conditioning Assessment Report', pageWidth / 2, y, { align: 'center' });
		y += 10;

		// Patient Details
		doc.setFontSize(12);
		doc.setFont('helvetica', 'bold');
		doc.text('Patient Information', pageMargin, y);
		y += 8;

		doc.setFontSize(10);
		doc.setFont('helvetica', 'normal');
		const patientInfo = [
			['Patient Name', data.patient.name || ''],
			['Patient ID', data.patient.patientId || ''],
			['Date of Birth', data.patient.dob || ''],
			['Gender', data.patient.gender || ''],
			['Phone', data.patient.phone || ''],
			['Email', data.patient.email || ''],
		];

		autoTable(doc, {
			startY: y,
			head: [['Field', 'Value']],
			body: patientInfo,
			theme: 'grid',
			headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
			styles: { fontSize: 9, cellPadding: 3 },
			columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
			margin: { left: pageMargin, right: pageMargin },
		});
		y = (doc as any).lastAutoTable.finalY + 10;

		// Date
		if (data.formData.assessmentDate) {
			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			doc.text(`Date: ${data.formData.assessmentDate}`, pageMargin, y);
			y += 8;
		}

		// Therapist Name
		if (data.formData.therapistName) {
			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			doc.text(`Therapist: ${data.formData.therapistName}`, pageMargin, y);
			y += 8;
		}

		// Athlete Profile Section
		const athleteProfileFields: string[][] = [];
		if (data.formData.sports) athleteProfileFields.push(['Sports', data.formData.sports]);
		if (data.formData.trainingAge) athleteProfileFields.push(['Training Age (years)', data.formData.trainingAge]);
		if (data.formData.competitionLevel) athleteProfileFields.push(['Competition Level', data.formData.competitionLevel]);
		if (data.formData.injuryHistory) athleteProfileFields.push(['Injury History', data.formData.injuryHistory]);
		if (data.formData.dominantSide) athleteProfileFields.push(['Dominant Side', data.formData.dominantSide]);

		if (athleteProfileFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Athlete Profile', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: athleteProfileFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Periodization Section
		const periodizationFields: string[][] = [];
		if (data.formData.seasonPhase) periodizationFields.push(['Season Phase', data.formData.seasonPhase]);
		if (data.formData.matchDates && data.formData.matchDates.length > 0) {
			periodizationFields.push(['Match Dates', data.formData.matchDates.join(', ')]);
		}

		if (periodizationFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Periodization', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: periodizationFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Skill Training Section
		const skillTrainingFields: string[][] = [];
		if (data.formData.skillType) skillTrainingFields.push(['Skill Type', data.formData.skillType]);
		if (data.formData.skillDuration) skillTrainingFields.push(['Skill Duration', data.formData.skillDuration]);
		if (data.formData.skillRPEPlanned !== undefined) skillTrainingFields.push(['Skill RPE (Planned)', String(data.formData.skillRPEPlanned)]);
		if (data.formData.skillPRPEPerceived !== undefined) skillTrainingFields.push(['Skill RPE (Perceived)', String(data.formData.skillPRPEPerceived)]);

		if (skillTrainingFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Skill Training', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: skillTrainingFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Strength & Conditioning Section
		const scFields: string[][] = [];
		if (data.formData.scType) scFields.push(['Type', data.formData.scType]);
		if (data.formData.scDuration) scFields.push(['Duration', data.formData.scDuration]);
		if (data.formData.scRPEPlanned !== undefined) scFields.push(['RPE (Planned)', String(data.formData.scRPEPlanned)]);
		if (data.formData.scPRPEPerceived !== undefined) scFields.push(['RPE (Perceived)', String(data.formData.scPRPEPerceived)]);

		if (scFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Strength & Conditioning', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: scFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Exercise Log Section
		if (data.formData.exercises && data.formData.exercises.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Exercise Log', pageMargin, y);
			y += 8;

			const exerciseRows = data.formData.exercises
				.filter(ex => ex.exerciseName)
				.map(ex => [
					ex.exerciseName || '',
					ex.sets !== undefined ? String(ex.sets) : '',
					ex.reps !== undefined ? String(ex.reps) : '',
					ex.load !== undefined ? String(ex.load) : '',
					ex.rest !== undefined ? String(ex.rest) : '',
					ex.distance !== undefined ? String(ex.distance) : '',
					ex.avgHR !== undefined ? String(ex.avgHR) : '',
				]);

			if (exerciseRows.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Exercise', 'Sets', 'Reps', 'Load (kg)', 'Rest (s)', 'Distance', 'Avg HR']],
					body: exerciseRows,
					theme: 'grid',
					headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
					styles: { fontSize: 8, cellPadding: 2 },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 6;
			}
		}

		// Wellness Score Section
		const wellnessFields: string[][] = [];
		if (data.formData.sleepDuration !== undefined) wellnessFields.push(['Sleep Duration (hours)', String(data.formData.sleepDuration)]);
		if (data.formData.sleepQuality !== undefined) wellnessFields.push(['Sleep Quality (1-10)', String(data.formData.sleepQuality)]);
		if (data.formData.stressLevel !== undefined) wellnessFields.push(['Stress Level (1-10)', String(data.formData.stressLevel)]);
		if (data.formData.muscleSoreness !== undefined) wellnessFields.push(['Muscle Soreness (1-10)', String(data.formData.muscleSoreness)]);
		if (data.formData.moodState) wellnessFields.push(['Mood State', data.formData.moodState]);

		if (wellnessFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Wellness Score', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: wellnessFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// ACWR Section
		const acwrFields: string[][] = [];
		if (data.formData.dailyWorkload !== undefined) acwrFields.push(['Daily Workload (A.U.)', String(data.formData.dailyWorkload)]);
		if (data.formData.acuteWorkload !== undefined) acwrFields.push(['Acute Workload (7 days)', String(data.formData.acuteWorkload)]);
		if (data.formData.chronicWorkload !== undefined) acwrFields.push(['Chronic Workload (28 days avg)', String(data.formData.chronicWorkload)]);
		if (data.formData.acwrRatio !== undefined) acwrFields.push(['ACWR Ratio', String(data.formData.acwrRatio)]);

		if (acwrFields.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 50) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('ACWR (Acute:Chronic Workload Ratio)', pageMargin, y);
			y += 8;

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: acwrFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Injury Risk Screening Section
		doc.setFontSize(12);
		doc.setFont('helvetica', 'bold');
		doc.text('Injury Risk Screening', pageMargin, y);
		y += 8;

		// Build body rows for single-field items
		const bodyRows: string[][] = [];

		if (data.formData.scapularDyskinesiaTest) {
			bodyRows.push(['Scapular Dyskinesia Test', data.formData.scapularDyskinesiaTest]);
		}

		// Upper body table
		const upperBodyRows: string[][] = [
			['Upper Limb Flexibility', data.formData.upperLimbFlexibilityRight || '', data.formData.upperLimbFlexibilityLeft || ''],
			['Shoulder Internal Rotation', data.formData.shoulderInternalRotationRight || '', data.formData.shoulderInternalRotationLeft || ''],
			['Shoulder External Rotation', data.formData.shoulderExternalRotationRight || '', data.formData.shoulderExternalRotationLeft || ''],
		].filter(row => row[1] || row[2]);

		if (upperBodyRows.length > 0) {
			autoTable(doc, {
				startY: y,
				head: [['Field', 'Right', 'Left']],
				body: upperBodyRows,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Add more single-field rows
		if (data.formData.thoracicRotation) {
			bodyRows.push(['Thoracic Rotation', data.formData.thoracicRotation]);
		}
		if (data.formData.sitAndReachTest) {
			bodyRows.push(['Sit And Reach Test', data.formData.sitAndReachTest]);
		}

		// Lower body table
		const lowerBodyRows: string[][] = [
			['Single Leg Squat', data.formData.singleLegSquatRight || '', data.formData.singleLegSquatLeft || ''],
			['Weight Bearing Lunge Test', data.formData.weightBearingLungeTestRight || '', data.formData.weightBearingLungeTestLeft || ''],
			['Hamstrings Flexibility', data.formData.hamstringsFlexibilityRight || '', data.formData.hamstringsFlexibilityLeft || ''],
			['Quadriceps Flexibility', data.formData.quadricepsFlexibilityRight || '', data.formData.quadricepsFlexibilityLeft || ''],
			['Hip External Rotation', data.formData.hipExternalRotationRight || '', data.formData.hipExternalRotationLeft || ''],
			['Hip Internal Rotation', data.formData.hipInternalRotationRight || '', data.formData.hipInternalRotationLeft || ''],
			['Hip Extension', data.formData.hipExtensionRight || '', data.formData.hipExtensionLeft || ''],
			['Active SLR', data.formData.activeSLRRight || '', data.formData.activeSLRLeft || ''],
		].filter(row => row[1] || row[2]);

		if (lowerBodyRows.length > 0) {
			autoTable(doc, {
				startY: y,
				head: [['Field', 'Right', 'Left']],
				body: lowerBodyRows,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		if (data.formData.pronePlank) {
			bodyRows.push(['Prone Plank', data.formData.pronePlank]);
		}

		// Side plank and stork table
		const balanceRows: string[][] = [
			['Side Plank', data.formData.sidePlankRight || '', data.formData.sidePlankLeft || ''],
			['Stork Standing Balance Test', data.formData.storkStandingBalanceTestRight || '', data.formData.storkStandingBalanceTestLeft || ''],
		].filter(row => row[1] || row[2]);

		if (balanceRows.length > 0) {
			autoTable(doc, {
				startY: y,
				head: [['Field', 'Right', 'Left']],
				body: balanceRows,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Additional fields
		const additionalFields: string[][] = [];
		if (data.formData.deepSquat) additionalFields.push(['Deep Squat', data.formData.deepSquat]);
		if (data.formData.pushup) additionalFields.push(['Pushup', data.formData.pushup]);
		if (data.formData.fmsScore) additionalFields.push(['FMS Score', data.formData.fmsScore]);
		if (data.formData.totalFmsScore) additionalFields.push(['Total FMS Score', data.formData.totalFmsScore]);

		if (additionalFields.length > 0) {
			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: additionalFields,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Render single-field rows (scapularDyskinesiaTest, thoracicRotation, sitAndReachTest, pronePlank)
		if (bodyRows.length > 0) {
			// Check if we need a new page
			if (y > pageHeight - 40) {
				doc.addPage();
				y = 20;
			}
			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: bodyRows,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 2 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 6;
		}

		// Summary
		if (data.formData.summary) {
			// Check if we need a new page
			if (y > pageHeight - 30) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Summary', pageMargin, y);
			y += 6;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const summaryLines = doc.splitTextToSize(data.formData.summary, pageWidth - 2 * pageMargin);
			doc.text(summaryLines, pageMargin, y);
			y = (doc as any).lastAutoTable?.finalY || y + summaryLines.length * 5;
		}

		// Add uploaded PDF if available
		if (data.uploadedPdfUrl) {
			try {
				// Check if we need a new page
				if (y > pageHeight - 40) {
					doc.addPage();
					y = 20;
				} else {
					y += 10;
				}
				
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Attached Document', pageMargin, y);
				y += 8;
				
				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				doc.text('An attached PDF document has been uploaded and is available at:', pageMargin, y);
				y += 6;
				
				// Add the URL as a clickable link (will appear as text in PDF)
				doc.setTextColor(0, 0, 255);
				const urlLines = doc.splitTextToSize(data.uploadedPdfUrl, pageWidth - 2 * pageMargin);
				doc.text(urlLines, pageMargin, y);
				y += urlLines.length * 5 + 5;
				doc.setTextColor(0, 0, 0);
				
				// Try to merge PDFs using pdf-lib if available
				try {
					const pdfLibModule = await import('pdf-lib');
					const { PDFDocument } = pdfLibModule as typeof import('pdf-lib');
					
					// Fetch the uploaded PDF
					const response = await fetch(data.uploadedPdfUrl);
					const pdfBlob = await response.blob();
					const arrayBuffer = await pdfBlob.arrayBuffer();
					const uploadedPdfDoc = await PDFDocument.load(arrayBuffer);
					const uploadedPages = uploadedPdfDoc.getPages();
					
					// Get current PDF as bytes
					const currentPdfBytes = doc.output('arraybuffer');
					const currentPdfDoc = await PDFDocument.load(currentPdfBytes);
					
					// Copy all pages from uploaded PDF
					const pagesToCopy = await currentPdfDoc.copyPages(uploadedPdfDoc, uploadedPages.map((_: unknown, i: number) => i));
					pagesToCopy.forEach((page: Awaited<ReturnType<typeof currentPdfDoc.copyPages>>[0]) => {
						currentPdfDoc.addPage(page);
					});
					
					// Save the merged PDF
					const mergedPdfBytes = await currentPdfDoc.save();
					const mergedBlob = new Blob([mergedPdfBytes as BlobPart], { type: 'application/pdf' });
					
					if (options?.forPrint) {
						const pdfUrl = URL.createObjectURL(mergedBlob);
						const printWindow = window.open(pdfUrl, '_blank');
						if (printWindow) {
							setTimeout(() => {
								try {
									printWindow.print();
								} catch (winError) {
									console.error('Window print failed:', winError);
								}
							}, 1500);
						}
						return;
					} else {
						const fileName = `Strength_Conditioning_${data.patient.patientId || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`;
						const url = URL.createObjectURL(mergedBlob);
						const link = document.createElement('a');
						link.href = url;
						link.download = fileName;
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						URL.revokeObjectURL(url);
						return;
					}
				} catch (pdfLibError) {
					// If pdf-lib is not available, continue with normal PDF generation
					// The note about the attached document has already been added
					console.warn('PDF merging library (pdf-lib) not available. Install it with: npm install pdf-lib', pdfLibError);
				}
			} catch (error) {
				console.error('Error processing uploaded PDF:', error);
				// Continue with normal PDF generation if processing fails
			}
		}

		// Handle print or download
		if (options?.forPrint) {
			try {
				const pdfBlob = doc.output('blob');
				const pdfUrl = URL.createObjectURL(pdfBlob);
				const printWindow = window.open(pdfUrl, '_blank');
				if (printWindow) {
					setTimeout(() => {
						try {
							printWindow.print();
						} catch (winError) {
							console.error('Window print failed:', winError);
						}
					}, 1500);
				}
			} catch (error) {
				console.error('Error generating PDF for print:', error);
				throw error;
			}
		} else {
			try {
				const fileName = `Strength_Conditioning_${data.patient.patientId || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`;
				doc.save(fileName);
			} catch (error) {
				console.error('Error saving PDF:', error);
				throw error;
			}
		}
	} catch (error) {
		console.error('Error in generateStrengthConditioningPDF:', error);
		throw error;
	}
}

// Psychology Report PDF Data Interface
export interface PsychologyReportPDFData {
	patient: {
		name?: string;
		patientId?: string;
		dob?: string;
		gender?: string;
		phone?: string;
		email?: string;
	};
	formData: {
		// Demographics
		assessmentType?: 'pre' | 'post';
		dateOfAssessment?: string;
		age?: string;
		fatherName?: string;
		motherName?: string;
		sport?: string;
		psychologist?: string;
		stateCity?: string;
		
		// Player's History
		playingSince?: string;
		highestAchievement?: string;
		currentLevel?: string;
		currentConcerns?: string[];
		
		// Current Psychological Stressor
		stressors?: {
			lackOfFocusExternal?: number;
			lackOfFocusInternal?: number;
			nervousness?: number;
			performancePressure?: number;
			attentionDisruption?: number;
			fearOfFailure?: number;
			thoughtsWondering?: number;
			lowReactionTime?: number;
			lackOfMentalPreparation?: number;
			overthinking?: number;
			none?: boolean;
			other?: string;
		};
		
		// Social Environment & Family History
		socialEnvironment?: {
			parents?: string;
			siblings?: string;
			friends?: string;
			relatives?: string;
		};
		familyHistory?: {
			maternalFamily?: string;
			paternalFamily?: string;
		};
		
		// History of Present Concerns
		historyOfConcerns?: string;
		
		// Brain Training Assessment
		sensoryStation?: {
			visualClarity?: number;
			contrastSensitivity?: number;
			depthPerception?: number;
			nearFarQuickness?: number;
			perceptionSpan?: number;
			multipleObjectTracking?: number;
			reactionTime?: number;
		};
		neurofeedbackHeadset?: {
			neuralActivity?: number;
			controls?: number;
			"Oxygenation (%)"?: number;
		};
		brainSensing?: {
			attention?: number;
			spatialAbility?: number;
			decisionMaking?: number;
			memory?: number;
			cognitiveFlexibility?: number;
		};
		
		trackingSpeed?: number;
		reactionTime?: number;
		handEyeCoordination?: number;
		competitiveStateAnxiety?: {
			cognitiveStateAnxiety?: number;
			somaticStateAnxiety?: number;
			selfConfidence?: number;
		};
		mentalToughness?: {
			commitment?: number;
			concentration?: number;
			controlUnderPressure?: number;
			confidence?: number;
		};
		bigFivePersonality?: {
			extroversion?: number;
			agreeableness?: number;
			conscientiousness?: number;
			neuroticism?: number;
			opennessToExperience?: number;
		};
		
		// Extra Assessments
		extraAssessments?: string;
		
		// Follow-up Assessment Report
		followUpAssessment?: {
			neurofeedbackHeadset?: {
				neuralActivity?: number;
				controls?: number;
				"Oxygenation (%)"?: number;
			};
			brainSensing?: {
				attention?: number;
				spatialAbility?: number;
				decisionMaking?: number;
				memory?: number;
				cognitiveFlexibility?: number;
			};
			multipleObjectTracking?: {
				trackingSpeed?: number;
			};
			reactionTimeHandEye?: {
				reactionTime?: number;
				handEyeCoordination?: number;
			};
			decisionMaking?: {
				speed?: number;
				accuracy?: number;
			};
			vrMeditation?: string;
			extraAssessment?: string;
		};
	};
}

export async function generatePsychologyPDF(
	data: PsychologyReportPDFData,
	options?: { forPrint?: boolean }
): Promise<void> {
	try {
		const [{ default: jsPDF }, autoTableModule] = await Promise.all([
			import('jspdf'),
			import('jspdf-autotable'),
		]);

		const autoTable = (autoTableModule as any).default || autoTableModule;
		const doc = new jsPDF('p', 'mm', 'a4');
		const pageWidth = 210;
		const pageHeight = 297;
		const pageMargin = 10;
		let y = 20;

		// Title
		doc.setFontSize(16);
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(99, 102, 241); // Indigo color
		doc.text('Brain Training / Sports Psychology Report', pageWidth / 2, y, { align: 'center' });
		y += 10;

		// Patient Details
		doc.setFontSize(12);
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(0, 0, 0);
		doc.text('Patient Information', pageMargin, y);
		y += 8;

		doc.setFontSize(10);
		doc.setFont('helvetica', 'normal');
		const patientInfo = [
			['Patient Name', data.patient.name || ''],
			['Patient ID', data.patient.patientId || ''],
			['Date of Birth', data.patient.dob || ''],
			['Gender', data.patient.gender || ''],
			['Phone', data.patient.phone || ''],
			['Email', data.patient.email || ''],
		];

		autoTable(doc, {
			startY: y,
			head: [['Field', 'Value']],
			body: patientInfo,
			theme: 'grid',
			headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
			styles: { fontSize: 9, cellPadding: 3 },
			columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
			margin: { left: pageMargin, right: pageMargin },
		});
		y = (doc as any).lastAutoTable.finalY + 10;

		// Demographics Details
		if (data.formData.assessmentType || data.formData.dateOfAssessment || data.formData.age || data.formData.fatherName || data.formData.motherName || data.formData.sport || data.formData.stateCity) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Demographics Details', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const demographics: string[][] = [];
			if (data.formData.assessmentType) {
				demographics.push(['Assessment Type', data.formData.assessmentType === 'pre' ? 'Pre-Assessment' : 'Post-Assessment']);
			}
			if (data.formData.dateOfAssessment) {
				demographics.push(['Date of Assessment', data.formData.dateOfAssessment]);
			}
			if (data.formData.age) {
				demographics.push(['Age', data.formData.age]);
			}
			if (data.formData.fatherName) {
				demographics.push(['Father\'s Name', data.formData.fatherName]);
			}
			if (data.formData.motherName) {
				demographics.push(['Mother\'s Name', data.formData.motherName]);
			}
			if (data.formData.sport) {
				demographics.push(['Sport', data.formData.sport]);
			}
			if (data.formData.stateCity) {
				demographics.push(['State/City', data.formData.stateCity]);
			}

			if (demographics.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Value']],
					body: demographics,
					theme: 'grid',
					headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 3 },
					columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 10;
			}
		}

		// Player's History
		if (data.formData.playingSince || data.formData.highestAchievement || data.formData.currentLevel || (data.formData.currentConcerns && data.formData.currentConcerns.length > 0)) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Player\'s History', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const playerHistory: string[][] = [];
			if (data.formData.playingSince) {
				playerHistory.push(['Playing Since', data.formData.playingSince]);
			}
			if (data.formData.highestAchievement) {
				playerHistory.push(['Highest Achievement', data.formData.highestAchievement]);
			}
			if (data.formData.currentLevel) {
				playerHistory.push(['Current Level', data.formData.currentLevel]);
			}
			if (data.formData.currentConcerns && data.formData.currentConcerns.length > 0) {
				playerHistory.push(['Current Concerns', data.formData.currentConcerns.join(', ')]);
			}

			if (playerHistory.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Value']],
					body: playerHistory,
					theme: 'grid',
					headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 3 },
					columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 10;
			}
		}

		// Current Psychological Stressor
		if (data.formData.stressors) {
			const stressors = data.formData.stressors;
			const hasStressorData = Object.values(stressors).some(val => val !== undefined && val !== null && val !== '');
			if (hasStressorData) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Current Psychological Stressor', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const stressorRows: string[][] = [];
				if (stressors.lackOfFocusExternal !== undefined) stressorRows.push(['Lack of Focus (External)', String(stressors.lackOfFocusExternal)]);
				if (stressors.lackOfFocusInternal !== undefined) stressorRows.push(['Lack of Focus (Internal)', String(stressors.lackOfFocusInternal)]);
				if (stressors.nervousness !== undefined) stressorRows.push(['Nervousness', String(stressors.nervousness)]);
				if (stressors.performancePressure !== undefined) stressorRows.push(['Performance Pressure', String(stressors.performancePressure)]);
				if (stressors.attentionDisruption !== undefined) stressorRows.push(['Attention Disruption', String(stressors.attentionDisruption)]);
				if (stressors.fearOfFailure !== undefined) stressorRows.push(['Fear of Failure', String(stressors.fearOfFailure)]);
				if (stressors.thoughtsWondering !== undefined) stressorRows.push(['Thoughts Wondering', String(stressors.thoughtsWondering)]);
				if (stressors.lowReactionTime !== undefined) stressorRows.push(['Low Reaction Time', String(stressors.lowReactionTime)]);
				if (stressors.lackOfMentalPreparation !== undefined) stressorRows.push(['Lack of Mental Preparation', String(stressors.lackOfMentalPreparation)]);
				if (stressors.overthinking !== undefined) stressorRows.push(['Overthinking', String(stressors.overthinking)]);
				if (stressors.none) stressorRows.push(['None', 'Yes']);
				if (stressors.other) stressorRows.push(['Other', stressors.other]);

				if (stressorRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Stressor', 'Value']],
						body: stressorRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// Social Environment & Family History
		if (data.formData.socialEnvironment || data.formData.familyHistory) {
			const hasSocialData = data.formData.socialEnvironment && Object.values(data.formData.socialEnvironment).some(v => v);
			const hasFamilyData = data.formData.familyHistory && Object.values(data.formData.familyHistory).some(v => v);
			
			if (hasSocialData || hasFamilyData) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Social Environment & Family History', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const socialRows: string[][] = [];
				
				if (hasSocialData && data.formData.socialEnvironment) {
					if (data.formData.socialEnvironment.parents) socialRows.push(['Parents', data.formData.socialEnvironment.parents]);
					if (data.formData.socialEnvironment.siblings) socialRows.push(['Siblings', data.formData.socialEnvironment.siblings]);
					if (data.formData.socialEnvironment.friends) socialRows.push(['Friends', data.formData.socialEnvironment.friends]);
					if (data.formData.socialEnvironment.relatives) socialRows.push(['Relatives', data.formData.socialEnvironment.relatives]);
				}
				
				if (hasFamilyData && data.formData.familyHistory) {
					if (data.formData.familyHistory.maternalFamily) socialRows.push(['Maternal Family', data.formData.familyHistory.maternalFamily]);
					if (data.formData.familyHistory.paternalFamily) socialRows.push(['Paternal Family', data.formData.familyHistory.paternalFamily]);
				}

				if (socialRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Category', 'Details']],
						body: socialRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// History of Present Concerns
		if (data.formData.historyOfConcerns) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('History of Present Concerns', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const concernsText = doc.splitTextToSize(data.formData.historyOfConcerns, pageWidth - 2 * pageMargin);
			doc.text(concernsText, pageMargin, y);
			y += concernsText.length * 5 + 5;
		}

		// Brain Training Assessment
		const hasBrainTraining = data.formData.sensoryStation || data.formData.neurofeedbackHeadset || data.formData.brainSensing || 
			data.formData.trackingSpeed !== undefined || data.formData.reactionTime !== undefined || data.formData.handEyeCoordination !== undefined;
		
		if (hasBrainTraining) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Brain Training Assessment', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const brainRows: string[][] = [];

			// Sensory Station
			if (data.formData.sensoryStation) {
				const ss = data.formData.sensoryStation;
				if (ss.visualClarity !== undefined) brainRows.push(['Visual Clarity', String(ss.visualClarity)]);
				if (ss.contrastSensitivity !== undefined) brainRows.push(['Contrast Sensitivity', String(ss.contrastSensitivity)]);
				if (ss.depthPerception !== undefined) brainRows.push(['Depth Perception', String(ss.depthPerception)]);
				if (ss.nearFarQuickness !== undefined) brainRows.push(['Near-Far Quickness', String(ss.nearFarQuickness)]);
				if (ss.perceptionSpan !== undefined) brainRows.push(['Perception Span', String(ss.perceptionSpan)]);
				if (ss.multipleObjectTracking !== undefined) brainRows.push(['Multiple Object Tracking', String(ss.multipleObjectTracking)]);
				if (ss.reactionTime !== undefined) brainRows.push(['Reaction Time', String(ss.reactionTime)]);
			}

			// Neurofeedback Headset
			if (data.formData.neurofeedbackHeadset) {
				const nh = data.formData.neurofeedbackHeadset;
				if (nh.neuralActivity !== undefined) brainRows.push(['Neural Activity (%)', String(nh.neuralActivity)]);
				if (nh.controls !== undefined) brainRows.push(['Controls', String(nh.controls)]);
				if (nh["Oxygenation (%)"] !== undefined) brainRows.push(['Oxygenation (%)', String(nh["Oxygenation (%)"])]);
			}

			// Brain Sensing
			if (data.formData.brainSensing) {
				const bs = data.formData.brainSensing;
				if (bs.attention !== undefined) brainRows.push(['Attention', String(bs.attention)]);
				if (bs.spatialAbility !== undefined) brainRows.push(['Spatial Ability', String(bs.spatialAbility)]);
				if (bs.decisionMaking !== undefined) brainRows.push(['Decision Making', String(bs.decisionMaking)]);
				if (bs.memory !== undefined) brainRows.push(['Memory', String(bs.memory)]);
				if (bs.cognitiveFlexibility !== undefined) brainRows.push(['Cognitive Flexibility', String(bs.cognitiveFlexibility)]);
			}

			// Additional metrics
			if (data.formData.trackingSpeed !== undefined) brainRows.push(['Tracking Speed', String(data.formData.trackingSpeed)]);
			if (data.formData.reactionTime !== undefined) brainRows.push(['Reaction Time', String(data.formData.reactionTime)]);
			if (data.formData.handEyeCoordination !== undefined) brainRows.push(['Hand-Eye Coordination', String(data.formData.handEyeCoordination)]);

			if (brainRows.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Assessment', 'Score']],
					body: brainRows,
					theme: 'grid',
					headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 3 },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 10;
			}
		}

		// Competitive State Anxiety
		if (data.formData.competitiveStateAnxiety) {
			const csa = data.formData.competitiveStateAnxiety;
			const hasCSAData = csa.cognitiveStateAnxiety !== undefined || csa.somaticStateAnxiety !== undefined || csa.selfConfidence !== undefined;
			if (hasCSAData) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Competitive State Anxiety', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const csaRows: string[][] = [];
				if (csa.cognitiveStateAnxiety !== undefined) csaRows.push(['Cognitive State Anxiety', String(csa.cognitiveStateAnxiety)]);
				if (csa.somaticStateAnxiety !== undefined) csaRows.push(['Somatic State Anxiety', String(csa.somaticStateAnxiety)]);
				if (csa.selfConfidence !== undefined) csaRows.push(['Self Confidence', String(csa.selfConfidence)]);

				if (csaRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Category', 'Score']],
						body: csaRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// Mental Toughness
		if (data.formData.mentalToughness) {
			const mt = data.formData.mentalToughness;
			const hasMTData = mt.commitment !== undefined || mt.concentration !== undefined || mt.controlUnderPressure !== undefined || mt.confidence !== undefined;
			if (hasMTData) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Mental Toughness', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const mtRows: string[][] = [];
				if (mt.commitment !== undefined) mtRows.push(['Commitment', String(mt.commitment)]);
				if (mt.concentration !== undefined) mtRows.push(['Concentration', String(mt.concentration)]);
				if (mt.controlUnderPressure !== undefined) mtRows.push(['Control Under Pressure', String(mt.controlUnderPressure)]);
				if (mt.confidence !== undefined) mtRows.push(['Confidence', String(mt.confidence)]);

				if (mtRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Category', 'Score']],
						body: mtRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// Big Five Personality
		if (data.formData.bigFivePersonality) {
			const bfp = data.formData.bigFivePersonality;
			const hasBFPData = bfp.extroversion !== undefined || bfp.agreeableness !== undefined || bfp.conscientiousness !== undefined || 
				bfp.neuroticism !== undefined || bfp.opennessToExperience !== undefined;
			if (hasBFPData) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Big Five Personality', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const bfpRows: string[][] = [];
				if (bfp.extroversion !== undefined) bfpRows.push(['Extroversion', String(bfp.extroversion)]);
				if (bfp.agreeableness !== undefined) bfpRows.push(['Agreeableness', String(bfp.agreeableness)]);
				if (bfp.conscientiousness !== undefined) bfpRows.push(['Conscientiousness', String(bfp.conscientiousness)]);
				if (bfp.neuroticism !== undefined) bfpRows.push(['Neuroticism', String(bfp.neuroticism)]);
				if (bfp.opennessToExperience !== undefined) bfpRows.push(['Openness to Experience', String(bfp.opennessToExperience)]);

				if (bfpRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Trait', 'Score']],
						body: bfpRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// Extra Assessments
		if (data.formData.extraAssessments) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Extra Assessments', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const extraText = doc.splitTextToSize(data.formData.extraAssessments, pageWidth - 2 * pageMargin);
			doc.text(extraText, pageMargin, y);
			y += extraText.length * 5 + 5;
		}

		// Psychologist
		if (data.formData.psychologist) {
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Psychologist', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			doc.text(data.formData.psychologist, pageMargin, y);
			y += 8;
		}

		// Follow-up Assessment Report
		if (data.formData.followUpAssessment) {
			const fu = data.formData.followUpAssessment;
			const hasFollowUpData = fu.neurofeedbackHeadset || fu.brainSensing || fu.multipleObjectTracking || 
				fu.reactionTimeHandEye || fu.decisionMaking || fu.vrMeditation || fu.extraAssessment;
			
			if (hasFollowUpData) {
				// Check if we need a new page
				if (y > pageHeight - 50) {
					doc.addPage();
					y = 20;
				}

				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Follow-up Assessment Report', pageMargin, y);
				y += 8;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const followUpRows: string[][] = [];

				// Neurofeedback Headset
				if (fu.neurofeedbackHeadset) {
					const nh = fu.neurofeedbackHeadset;
					if (nh.neuralActivity !== undefined) followUpRows.push(['Neurofeedback - Neural Activity (%)', String(nh.neuralActivity)]);
					if (nh.controls !== undefined) followUpRows.push(['Neurofeedback - Controls', String(nh.controls)]);
					if (nh["Oxygenation (%)"] !== undefined) followUpRows.push(['Neurofeedback - Oxygenation (%)', String(nh["Oxygenation (%)"])]);
				}

				// Brain Sensing
				if (fu.brainSensing) {
					const bs = fu.brainSensing;
					if (bs.attention !== undefined) followUpRows.push(['Brain Sensing - Attention', String(bs.attention)]);
					if (bs.spatialAbility !== undefined) followUpRows.push(['Brain Sensing - Spatial Ability', String(bs.spatialAbility)]);
					if (bs.decisionMaking !== undefined) followUpRows.push(['Brain Sensing - Decision Making', String(bs.decisionMaking)]);
					if (bs.memory !== undefined) followUpRows.push(['Brain Sensing - Memory', String(bs.memory)]);
					if (bs.cognitiveFlexibility !== undefined) followUpRows.push(['Brain Sensing - Cognitive Flexibility', String(bs.cognitiveFlexibility)]);
				}

				// Multiple Object Tracking
				if (fu.multipleObjectTracking && fu.multipleObjectTracking.trackingSpeed !== undefined) {
					followUpRows.push(['3D - Multiple Object Tracking - Tracking Speed', String(fu.multipleObjectTracking.trackingSpeed)]);
				}

				// Reaction Time & Hand-Eye Coordination
				if (fu.reactionTimeHandEye) {
					if (fu.reactionTimeHandEye.reactionTime !== undefined) followUpRows.push(['Reaction Time & Hand-Eye Coordination - Reaction Time', String(fu.reactionTimeHandEye.reactionTime)]);
					if (fu.reactionTimeHandEye.handEyeCoordination !== undefined) followUpRows.push(['Reaction Time & Hand-Eye Coordination - Hand-Eye Coordination', String(fu.reactionTimeHandEye.handEyeCoordination)]);
				}

				// Decision Making
				if (fu.decisionMaking) {
					if (fu.decisionMaking.speed !== undefined) followUpRows.push(['Decision Making - Speed (ms)', String(fu.decisionMaking.speed)]);
					if (fu.decisionMaking.accuracy !== undefined) followUpRows.push(['Decision Making - Accuracy (%)', String(fu.decisionMaking.accuracy)]);
				}

				// VR Meditation
				if (fu.vrMeditation) {
					followUpRows.push(['VR Meditation', fu.vrMeditation]);
				}

				// Extra Assessment
				if (fu.extraAssessment) {
					followUpRows.push(['Extra Assessment', fu.extraAssessment]);
				}

				if (followUpRows.length > 0) {
					autoTable(doc, {
						startY: y,
						head: [['Assessment', 'Value']],
						body: followUpRows,
						theme: 'grid',
						headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] },
						styles: { fontSize: 9, cellPadding: 3 },
						margin: { left: pageMargin, right: pageMargin },
					});
					y = (doc as any).lastAutoTable.finalY + 10;
				}
			}
		}

		// Save PDF
		const fileName = `Psychology_Report_${data.patient.patientId || 'Unknown'}_${data.formData.dateOfAssessment || new Date().toISOString().split('T')[0]}.pdf`;
		doc.save(fileName);
	} catch (error) {
		console.error('Error in generatePsychologyPDF:', error);
		throw error;
	}
}
