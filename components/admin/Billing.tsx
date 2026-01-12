'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, query, where, getDocs, addDoc, serverTimestamp, orderBy, writeBatch, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';

import {
	type AdminAppointmentRecord,
	type AdminPatientRecord,
} from '@/lib/adminMockData';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { notifyAdmins } from '@/lib/notificationUtils';
import { getCurrentBillingCycle, getNextBillingCycle, getBillingCycleId, getMonthName, getCurrentCalendarYear, type BillingCycle } from '@/lib/billingUtils';
import { getRemainingFreeSessions, normalizeSessionAllowance } from '@/lib/sessionAllowance';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import type { RecordSessionUsageResult } from '@/lib/sessionAllowanceClient';
import type { SessionAllowance } from '@/lib/types';

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
}

type DateFilter = 'all' | '15' | '30' | '180' | '365';

interface PendingDraft {
	amount: string;
	date: string;
}

interface InvoiceDetails {
	patient: string;
	appointmentId: string;
	doctor: string;
	billingDate: string;
	amount: string;
	companyBankDetails?: string;
}

interface BillingRecord {
	id?: string;
	billingId: string;
	appointmentId?: string;
	patient: string;
	patientId: string;
	doctor?: string;
	amount: number;
	packageAmount?: number;
	concessionPercent?: number | null;
	installmentCount?: number;
	installmentAmount?: number;
	installmentsPaid?: number;
	amountPaid?: number;
	date: string;
	status: 'Pending' | 'Completed' | 'Auto-Paid';
	paymentMode?: string;
	utr?: string;
	createdAt?: string | Timestamp;
	updatedAt?: string | Timestamp;
	invoiceNo?: string;
	invoiceGeneratedAt?: string;
	createdByFrontdesk?: string;
	createdByFrontdeskName?: string;
	paymentRegisteredByFrontdesk?: string;
	paymentRegisteredByFrontdeskName?: string;
}

const formatInstallmentPlan = (bill: BillingRecord) => {
	const total = bill.installmentCount && bill.installmentCount > 0 ? bill.installmentCount : 1;
	if (!bill.amount) return '—';
	if (total <= 1) return `Single payment • ${rupee(bill.amount)}`;
	const paid = Math.min(bill.installmentsPaid ?? 0, total);
	const perInstallment =
		bill.installmentAmount && bill.installmentAmount > 0
			? bill.installmentAmount
			: bill.amount / total;
	return `${total} x ${rupee(perInstallment)} • ${paid}/${total} paid`;
};

const dateOptions: Array<{ label: string; value: DateFilter }> = [
	{ value: 'all', label: 'All Time' },
	{ value: '15', label: 'Last 15 Days' },
	{ value: '30', label: 'Last 1 Month' },
	{ value: '180', label: 'Last 6 Months' },
	{ value: '365', label: 'Last 1 Year' },
];

const rupee = (value: number) =>
	new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

const getInstallmentInfo = (bill: BillingRecord) => {
	const total = bill.installmentCount && bill.installmentCount > 0 ? bill.installmentCount : 1;
	const paid = Math.min(bill.installmentsPaid ?? 0, total);
	const amountPerInstallment =
		bill.installmentAmount && bill.installmentAmount > 0
			? bill.installmentAmount
			: total > 0
				? bill.amount / total
				: bill.amount;
	const remaining = Math.max(total - paid, 0);
	const nextInstallment = paid < total ? paid + 1 : total;

	return {
		total,
		paid,
		amountPerInstallment,
		remaining,
		nextInstallment,
	};
};

const parseDate = (value?: string) => {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isWithinDays = (value: string | undefined, window: DateFilter) => {
	if (window === 'all') return true;
	const target = parseDate(value);
	if (!target) return false;
	const now = new Date();
	const days = Number(window);
	const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
	return target >= past && target <= now;
};

/* --------------------------------------------------------
	NEW NUMBER -> WORDS (INDIAN SYSTEM, RUPEES + PAISE)
---------------------------------------------------------- */
function numberToWords(num: number): string {
	const a = [
		'',
		'One',
		'Two',
		'Three',
		'Four',
		'Five',
		'Six',
		'Seven',
		'Eight',
		'Nine',
		'Ten',
		'Eleven',
		'Twelve',
		'Thirteen',
		'Fourteen',
		'Fifteen',
		'Sixteen',
		'Seventeen',
		'Eighteen',
		'Nineteen',
	];
	const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

	function inWords(n: number): string {
		if (n < 20) return a[n];
		if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
		if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
		if (n < 100000)
			return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + inWords(n % 1000) : '');
		if (n < 10000000)
			return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + inWords(n % 100000) : '');
		return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + inWords(n % 10000000) : '');
	}

	const rupees = Math.floor(num);
	const paise = Math.round((num - rupees) * 100);

	const rupeesWords = rupees ? inWords(rupees) + ' Rupees' : '';
	const paiseWords = paise ? (rupees ? ' and ' : '') + inWords(paise) + ' Paise' : '';

	const result = (rupeesWords + paiseWords).trim();
	return result || 'Zero Rupees';
}

/* --------------------------------------------------------
	ESCAPE HTML FOR SAFE INJECTION INTO INVOICE HTML
---------------------------------------------------------- */
function escapeHtml(unsafe: any) {
	return String(unsafe || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/* --------------------------------------------------------
	CONVERT IMAGE TO BASE64 DATA URL FOR EMBEDDING IN PDF/PRINT
---------------------------------------------------------- */
async function getLogoAsDataUrl(): Promise<string> {
	try {
		// Try to load from configured header first
		const { getHeaderConfig, getDefaultHeaderConfig } = await import('@/lib/headerConfig');
		// Try invoice header config first, fallback to billing
		const invoiceHeaderConfig = await getHeaderConfig('invoice');
		const headerConfig = invoiceHeaderConfig || await getHeaderConfig('billing');
		
		// Use leftLogo (single logo for invoices)
		if (headerConfig?.leftLogo) {
			if (headerConfig.leftLogo.startsWith('data:')) {
				return headerConfig.leftLogo;
			}
			// If it's a URL, fetch and convert
			try {
				const response = await fetch(headerConfig.leftLogo);
				if (response.ok) {
					const blob = await response.blob();
					return new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.onerror = reject;
						reader.readAsDataURL(blob);
					});
				}
			} catch (error) {
				console.warn('Could not load configured logo, using default:', error);
			}
		}
		
		// Fallback to default logo from public folder
		const logoPath = '/CenterSportsScience_logo.jpg';
		const logoUrl = typeof window !== 'undefined' 
			? `${window.location.origin}${logoPath}` 
			: logoPath;
		
		const response = await fetch(logoUrl);
		if (!response.ok) {
			throw new Error(`Failed to load logo: ${response.statusText}`);
		}
		
		const blob = await response.blob();
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch (error) {
		console.error('Error loading logo:', error);
		// Return empty data URL as fallback
		return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	}
}

/* --------------------------------------------------------
	GENERATE PRINTABLE INVOICE HTML (INDIAN GST FORMAT)
---------------------------------------------------------- */
async function generateInvoiceHtml(
	bill: BillingRecord, 
	invoiceNo: string, 
	options?: {
		patientName?: string;
		patientAddress?: string;
		patientCity?: string;
		description?: string;
		hsnSac?: string;
		cgstRate?: number;
		sgstRate?: number;
		companyBankDetails?: string;
	}
) {
	const taxableValue = Number(bill.amount || 0);
	const cgstRate = options?.cgstRate ?? 5; // Default 5% CGST
	const sgstRate = options?.sgstRate ?? 5; // Default 5% SGST
	const cgstAmount = Number((taxableValue * (cgstRate / 100)).toFixed(2));
	const sgstAmount = Number((taxableValue * (sgstRate / 100)).toFixed(2));
	const grandTotal = Number((taxableValue + cgstAmount + sgstAmount).toFixed(2));
	
	const words = numberToWords(grandTotal);
	const taxWords = numberToWords(cgstAmount + sgstAmount);
	const showDate = bill.date || new Date().toLocaleDateString('en-IN');
	
	const paymentModeDisplay = bill.paymentMode || 'Cash';
	const buyerName = escapeHtml(options?.patientName || bill.patient);
	const buyerAddress = options?.patientAddress || `Patient ID: ${escapeHtml(bill.patientId)}`;
	const buyerCity = options?.patientCity || (bill.doctor ? `Doctor: ${escapeHtml(bill.doctor)}` : '');
	const description = options?.description || 'Physiotherapy / Strength & Conditioning Sessions';
	const hsnSac = options?.hsnSac || '9993';
	
	// Convert logo to base64 data URL for reliable printing/downloading
	const logoDataUrl = await getLogoAsDataUrl();

	// Load invoice header configuration
	const { getHeaderConfig, getDefaultHeaderConfig } = await import('@/lib/headerConfig');
	const headerConfig = await getHeaderConfig('invoice');
	const defaultConfig = getDefaultHeaderConfig('invoice');

	const mainTitle = headerConfig?.mainTitle || defaultConfig.mainTitle || 'CENTRE FOR SPORTS SCIENCE';
	const subtitle = headerConfig?.subtitle || defaultConfig.subtitle || 'Sports Business Solutions Pvt. Ltd.';
	const contactInfo =
		headerConfig?.contactInfo ||
		defaultConfig.contactInfo ||
		'Sri Kanteerava Outdoor Stadium, Bangalore | Phone: +91 97311 28396';

	const contactParts = contactInfo.split('|').map(s => s.trim());
	const addressPart =
		contactParts.find(
			p => p.toLowerCase().includes('stadium') || p.toLowerCase().includes('address') || p.toLowerCase().includes('bangalore')
		) || contactParts[0] || '';
	const phonePart = contactParts.find(p => p.toLowerCase().includes('phone')) || contactParts[1] || '';

	// Build header lines - always use config values if config exists
	const headerLinesParts = [];
	if (mainTitle) {
		headerLinesParts.push(`<span class="bold" style="font-size: 14px;">${escapeHtml(mainTitle)}</span>`);
	}
	if (subtitle) {
		headerLinesParts.push(escapeHtml(subtitle));
	}
	if (addressPart) {
		headerLinesParts.push(escapeHtml(addressPart));
	}
	if (phonePart) {
		headerLinesParts.push(escapeHtml(phonePart));
	}
	const headerLines = headerLinesParts.join('<br>');

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Tax Invoice</title>
			<style>
				@page { size: A4; margin: 0; }
				body {
					font-family: Arial, sans-serif;
					font-size: 12px;
					margin: 0;
					padding: 20px;
					background: #fff;
				}
				.container {
					width: 210mm;
					max-width: 100%;
					margin: 0 auto;
					border: 1px solid #000;
				}
				.text-right { text-align: right; }
				.text-center { text-align: center; }
				.bold { font-weight: bold; }
				.uppercase { text-transform: uppercase; }
				table {
					width: 100%;
					border-collapse: collapse;
				}
				td, th {
					border: 1px solid #000;
					padding: 4px;
					vertical-align: top;
				}
				.header-left { width: 50%; }
				.header-right { width: 50%; padding: 0; }
				.nested-table td {
					border-top: none;
					border-left: none;
					border-right: none;
					border-bottom: 1px solid #000;
				}
				.nested-table tr:last-child td { border-bottom: none; }
				.items-table th { background-color: #f0f0f0; text-align: center; }
				.items-table td { height: 20px; }
				.spacer-row td { height: 100px; border-bottom: none; border-top: none; }
				.footer-table td { border: 1px solid #000; }
			</style>
		</head>
		<body>
		<div class="container">
			<div class="text-center bold" style="border-bottom: 1px solid #000; padding: 5px; font-size: 14px;">TAX INVOICE</div>

			<table>
				<tr>
					<td class="header-left">
						<div style="display: flex; gap: 10px; align-items: flex-start;">
							<img src="${logoDataUrl}" alt="Company Logo" style="width: 100px; height: auto; flex-shrink: 0;">
							<div>
								${headerConfig ? headerLines : (headerLines || 
									`<span class="bold" style="font-size: 14px;">CENTRE FOR SPORTS AND SCIENCE</span><br>
									Blr: No.503, 5th Floor Donata Marvel Apartment,<br>
									Gokula Extension, Mattikere, Bangalore-560054<br>
									<strong>GSTIN/UIN:</strong> 07ADZFS3168H1ZC<br>
									Contact: +91-9731128398 / 9916509206<br>
									E-Mail: sportsixs2019@gmail.com`)}
							</div>
						</div>
					</td>
					<td class="header-right">
						<table class="nested-table">
							<tr>
								<td width="50%"><strong>Invoice No.</strong><br>${escapeHtml(invoiceNo)}</td>
								<td width="50%"><strong>Dated</strong><br>${escapeHtml(showDate)}</td>
							</tr>
							<tr>
								<td><strong>Delivery Note</strong><br>&nbsp;</td>
								<td><strong>Mode/Terms of Payment</strong><br>${escapeHtml(paymentModeDisplay)}</td>
							</tr>
							<tr>
								<td><strong>Reference No. </strong><br>${escapeHtml(bill.appointmentId || '')}</td>
								<td><strong>Other References</strong><br>&nbsp;</td>
							</tr>
						</table>
					</td>
				</tr>

				<tr>
					<td colspan="2">
						<strong>Billed to</strong><br>
						${buyerName}<br>
						${buyerAddress}<br>
						${buyerCity}
					</td>
				</tr>
			</table>

			<table class="items-table" style="border-top: none;">
				<thead>
					<tr>
						<th width="5%">SI No.</th>
						<th width="40%">Description of Services</th>
						<th width="10%">HSN/SAC</th>
						<th width="10%">Quantity</th>
						<th width="10%">Rate</th>
						<th width="5%">per</th>
						<th width="20%">Amount</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="text-center">1</td>
						<td>${escapeHtml(description)}</td>
						<td>${escapeHtml(hsnSac)}</td>
						<td>1</td>
						<td>${taxableValue.toFixed(2)}</td>
						<td>Session</td>
						<td class="text-right">${taxableValue.toFixed(2)}</td>
					</tr>

					<tr class="spacer-row">
						<td style="border-bottom: 1px solid #000;"></td>
						<td style="border-bottom: 1px solid #000;">
							<br><br>
							<div class="text-right" style="padding-right: 10px;">
								CGST @ ${cgstRate}%<br>
								SGST @ ${sgstRate}%
							</div>
						</td>
						<td style="border-bottom: 1px solid #000;"></td>
						<td style="border-bottom: 1px solid #000;"></td>
						<td style="border-bottom: 1px solid #000;">
							<br><br><br>
							<div class="text-center">${cgstRate}%<br>${sgstRate}%</div>
						</td>
						<td style="border-bottom: 1px solid #000;">
							<br><br><br>
							<div class="text-center">%<br>%</div>
						</td>
						<td style="border-bottom: 1px solid #000;" class="text-right">
							<br><br>
							${cgstAmount.toFixed(2)}<br>
							${sgstAmount.toFixed(2)}
						</td>
					</tr>
					
					<tr class="bold">
						<td colspan="6" class="text-right">Total</td>
						<td class="text-right">${grandTotal.toFixed(2)}</td>
					</tr>
				</tbody>
			</table>

			<div style="border: 1px solid #000; border-top: none; padding: 5px;">
				<strong>Amount Chargeable (in words):</strong><br>
				${escapeHtml(words.toUpperCase())} ONLY
			</div>

			<table class="text-center" style="border-top: none;">
				<tr>
					<td rowspan="2">HSN/SAC</td>
					<td rowspan="2">Taxable Value</td>
					<td colspan="2">CGST</td>
					<td colspan="2">SGST</td>
					<td rowspan="2">Total Tax Amount</td>
				</tr>
				<tr>
					<td>Rate</td>
					<td>Amount</td>
					<td>Rate</td>
					<td>Amount</td>
				</tr>
				<tr>
					<td>${escapeHtml(hsnSac)}</td>
					<td>${taxableValue.toFixed(2)}</td>
					<td>${cgstRate}%</td>
					<td>${cgstAmount.toFixed(2)}</td>
					<td>${sgstRate}%</td>
					<td>${sgstAmount.toFixed(2)}</td>
					<td>${(cgstAmount + sgstAmount).toFixed(2)}</td>
				</tr>
				<tr class="bold">
					<td class="text-right">Total</td>
					<td>${taxableValue.toFixed(2)}</td>
					<td></td>
					<td>${cgstAmount.toFixed(2)}</td>
					<td></td>
					<td>${sgstAmount.toFixed(2)}</td>
					<td>${(cgstAmount + sgstAmount).toFixed(2)}</td>
				</tr>
			</table>

			<div style="border: 1px solid #000; border-top: none; padding: 5px;">
				<strong>Tax Amount (In words):</strong> ${escapeHtml(taxWords.toUpperCase())} ONLY
			</div>

			<table style="border-top: none;">
				<tr>
					<td width="50%" style="border-right: 1px solid #000;">				
						<span class="bold" style="text-decoration: underline;">Declaration</span><br>
						We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.<br><br>
						
						<div style="margin-top: 20px; border: 1px solid #ccc; padding: 10px; display: inline-block;">
							Customer's Seal and Signature
						</div>
					</td>
					<td width="50%">
						<strong>Company's Bank Details</strong><br>
						${options?.companyBankDetails ? escapeHtml(options.companyBankDetails).replace(/\n/g, '<br>') : `A/c Holder's Name: Six Sports & Business Solutions INC<br>
						Bank Name: Canara Bank<br>
						A/c No.: 0284201007444<br>
						Branch & IFS Code: CNRB0000444`}<br><br>
						
						<div class="text-right" style="margin-top: 20px;">
							for <strong>CENTRE FOR SPORTS AND SCIENCE</strong><br><br><br>
							Authorised Signatory
						</div>
					</td>
				</tr>
			</table>
		</div>
		</body>
		</html>
	`;
}

/* --------------------------------------------------------
	GET RECEIPT LOGO AS BASE64 DATA URL (ALWAYS USE CenterSportsScience_logo.jpg)
---------------------------------------------------------- */
async function getReceiptLogoAsDataUrl(): Promise<string> {
	try {
		// Always use CenterSportsScience_logo.jpg for receipts
		const logoPath = '/CenterSportsScience_logo.jpg';
		const logoUrl = typeof window !== 'undefined' 
			? `${window.location.origin}${logoPath}` 
			: logoPath;
		
		const response = await fetch(logoUrl);
		if (!response.ok) {
			throw new Error(`Failed to load logo: ${response.statusText}`);
		}
		
		const blob = await response.blob();
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch (error) {
		console.error('Error loading receipt logo:', error);
		// Return empty data URL as fallback
		return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	}
}

/* --------------------------------------------------------
	GENERATE RECEIPT HTML (MATCHING RECEIPT IMAGE FORMAT)
---------------------------------------------------------- */
async function generateReceiptHtml(bill: BillingRecord, receiptNo: string) {
	const amount = Number(bill.amount || 0).toFixed(2);
	const words = numberToWords(Number(bill.amount || 0));
	const showDate = bill.date || new Date().toLocaleDateString('en-IN');
	
	const paymentModeDisplay = bill.paymentMode || 'Cash';
	
	// Convert logo to base64 data URL for reliable printing/downloading (always use CenterSportsScience_logo.jpg)
	const logoDataUrl = await getReceiptLogoAsDataUrl();

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Receipt</title>
			<style>
				body {
					font-family: 'Arial', sans-serif;
					background-color: #f5f5f5;
					display: flex;
					justify-content: center;
					padding-top: 40px;
					margin: 0;
				}
				.receipt-box {
					width: 800px;
					background: white;
					border: 1px solid #333;
					padding: 20px 30px;
					box-sizing: border-box;
					position: relative;
				}
				.header {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					margin-bottom: 10px;
				}
				.header-left {
					display: flex;
					align-items: flex-start;
					gap: 15px;
				}
				.company-info h2 {
					margin: 0;
					font-size: 22px;
					text-transform: uppercase;
					color: #000;
					font-weight: bold;
				}
				.company-info p {
					margin: 2px 0;
					font-size: 12px;
					color: #000;
				}
				.header-right {
					text-align: right;
				}
				.header-right h2 {
					margin: 0 0 5px 0;
					font-size: 20px;
					text-transform: uppercase;
					font-weight: bold;
					color: #000;
				}
				.header-right p {
					margin: 2px 0;
					font-size: 12px;
					font-weight: bold;
					color: #000;
				}
				hr {
					border: 0;
					border-top: 1px solid #000;
					margin: 15px 0;
				}
				.info-section {
					display: flex;
					justify-content: space-between;
					margin-bottom: 15px;
				}
				.info-left {
					font-size: 14px;
					color: #000;
				}
				.info-left strong {
					font-size: 18px;
					display: block;
					margin-top: 5px;
					color: #000;
				}
				.info-left .id-text {
					font-size: 12px;
					color: #000;
					margin-top: 2px;
				}
				.amount-right {
					text-align: right;
				}
				.amount-right span {
					font-size: 12px;
					display: block;
					color: #000;
				}
				.amount-right strong {
					font-size: 24px;
					color: #000;
				}
				.words-row {
					font-size: 14px;
					margin-bottom: 20px;
					font-weight: bold;
					color: #000;
				}
				.details-box {
					border: 1px solid #000;
					padding: 15px;
					height: 120px;
					position: relative;
					font-size: 14px;
					line-height: 1.5;
					color: #000;
				}
				.details-box strong {
					display: block;
					margin-bottom: 5px;
					color: #000;
				}
				.digitally-signed {
					position: absolute;
					bottom: 10px;
					left: 0;
					right: 0;
					text-align: center;
					font-weight: bold;
					font-size: 12px;
					color: #000;
				}
				.footer {
					margin-top: 15px;
					display: flex;
					justify-content: space-between;
					font-size: 10px;
					color: #000;
				}
			</style>
		</head>
		<body>
			<div class="receipt-box">
				<div class="header">
					<div class="header-left">
						<img src="${logoDataUrl}" alt="Company Logo" style="width: 100px; height: auto;" onload="window.logoLoaded = true;" onerror="console.error('Logo failed to load');">
						<div class="company-info">
							<h2>Centre For Sports Science</h2>
							<p>Sports & Business Solutions Pvt. Ltd.</p>
							<p>Sri Kanteerava Outdoor Stadium · Bangalore · +91 97311 28396</p>
						</div>
					</div>
					<div class="header-right">
						<h2>Receipt</h2>
						<p>Receipt No: ${escapeHtml(receiptNo)}</p>
						<p>Date: ${escapeHtml(showDate)}</p>
					</div>
				</div>
				<hr>
				<div class="info-section">
					<div class="info-left">
						Received from:
						<strong>${escapeHtml(bill.patient)}</strong>
						<div class="id-text">ID: ${escapeHtml(bill.patientId)}</div>
					</div>
					<div class="amount-right">
						<span>Amount</span>
						<strong>Rs. ${amount}</strong>
					</div>
				</div>
				<div class="words-row">
					Amount in words: <span style="font-weight: normal;">${escapeHtml(words)}</span>
				</div>
				<div class="details-box">
					<strong>For</strong>
					${escapeHtml(bill.appointmentId || '')}<br>
					${bill.doctor ? `Doctor: ${escapeHtml(bill.doctor)}<br>` : ''}
					Payment Mode: ${escapeHtml(paymentModeDisplay)}
					<div class="digitally-signed">Digitally Signed</div>
				</div>
				<div class="footer">
					<div>Computer generated receipt.</div>
					<div style="text-transform: uppercase;">For Centre For Sports Science</div>
				</div>
			</div>
		</body>
		</html>
	`;
}

export default function Billing() {
	const { user } = useAuth();
	const [appointments, setAppointments] = useState<(AdminAppointmentRecord & { id: string; amount?: number })[]>([]);
	const [patients, setPatients] = useState<(AdminPatientRecord & { id?: string; patientType?: string; department?: string; sessionAllowance?: SessionAllowance })[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);

	const [doctorFilter, setDoctorFilter] = useState<'all' | string>('all');
	const [departmentFilter, setDepartmentFilter] = useState<'all' | string>('all');
	const [pendingWindow, setPendingWindow] = useState<DateFilter>('all');
	const [completedWindow, setCompletedWindow] = useState<DateFilter>('all');

	const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({});
	const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
	const [invoiceDetails, setInvoiceDetails] = useState<InvoiceDetails | null>(null);
	const [editableInvoice, setEditableInvoice] = useState<{
		invoiceNo: string;
		invoiceDate: string;
		patientName: string;
		patientAddress: string;
		patientCity: string;
		amount: number;
		description: string;
		paymentMode: string;
		referenceNo: string;
		hsnSac: string;
		cgstRate: number;
		sgstRate: number;
		companyBankDetails?: string;
	} | null>(null);
	const [previewHtml, setPreviewHtml] = useState('');
	const [syncing, setSyncing] = useState(false);
	const [loading, setLoading] = useState(true);
	const [sendingNotifications, setSendingNotifications] = useState(false);
	const [resettingCycle, setResettingCycle] = useState(false);

	const [defaultBillingDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [currentCycle, setCurrentCycle] = useState(() => getCurrentBillingCycle());
	const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
	const [selectedCycleId, setSelectedCycleId] = useState<string | 'current'>('current');
	
	// Billing collection state
	const [billing, setBilling] = useState<BillingRecord[]>([]);
	const [selectedBill, setSelectedBill] = useState<BillingRecord | null>(null);
	const [showPayModal, setShowPayModal] = useState(false);
	const [showPaymentSlipModal, setShowPaymentSlipModal] = useState(false);
	const [receiptHtml, setReceiptHtml] = useState('');
	const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI/Card'>('Cash');
	const [utr, setUtr] = useState('');
	const [selectedInstallmentNumber, setSelectedInstallmentNumber] = useState<number | null>(null);
	const [filterRange, setFilterRange] = useState<string>('30');
	const [pendingSearchQuery, setPendingSearchQuery] = useState<string>('');
	const [completedSearchQuery, setCompletedSearchQuery] = useState<string>('');
	const [showImportModal, setShowImportModal] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [importPreview, setImportPreview] = useState<any[]>([]);

	// Load appointments from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						appointmentId: data.appointmentId ? String(data.appointmentId) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						status: (data.status as string) ?? 'pending',
						billing: data.billing ? (data.billing as { amount?: string; date?: string }) : undefined,
						billingDeleted: data.billingDeleted === true,
						amount: data.amount ? Number(data.amount) : 1200,
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as AdminAppointmentRecord & { id: string; amount?: number; billingDeleted?: boolean };
				});
				setAppointments([...mapped]);
				setLoading(false);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: data.gender ? String(data.gender) : '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						status: (data.status as string) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						patientType: data.patientType ? String(data.patientType) : undefined,
						department: data.department ? String(data.department) : undefined,
						sessionAllowance: data.sessionAllowance
							? normalizeSessionAllowance(data.sessionAllowance as Record<string, unknown>)
							: undefined,
					} as AdminPatientRecord & { id: string; department?: string };
				});
				setPatients([...mapped]);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load staff from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						userName: data.userName ? String(data.userName) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
						userEmail: data.userEmail ? String(data.userEmail) : undefined,
					} as StaffMember;
				});
				setStaff([...mapped]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load billing cycles from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'billingCycles'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					const closed = (data.closedAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						startDate: data.startDate ? String(data.startDate) : '',
						endDate: data.endDate ? String(data.endDate) : '',
						month: data.month ? Number(data.month) : 1,
						year: data.year ? Number(data.year) : new Date().getFullYear(),
						status: (data.status as 'active' | 'closed' | 'pending') || 'pending',
						createdAt: created ? created.toISOString() : new Date().toISOString(),
						closedAt: closed ? closed.toISOString() : undefined,
					} as BillingCycle;
				});
				setBillingCycles([...mapped]);
			},
			error => {
				console.error('Failed to load billing cycles', error);
				setBillingCycles([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load billing records from Firestore (ordered by createdAt desc)
	useEffect(() => {
		const q = query(collection(db, 'billing'), orderBy('createdAt', 'desc'));

		const unsubscribe = onSnapshot(
			q,
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();

					return {
						id: docSnap.id,
						billingId: data.billingId ? String(data.billingId) : '',
						appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
						patient: data.patient ? String(data.patient) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						doctor: data.doctor ? String(data.doctor) : undefined,
						amount: data.amount ? Number(data.amount) : 0,
						packageAmount:
							typeof data.packageAmount === 'number'
								? data.packageAmount
								: data.packageAmount
									? Number(data.packageAmount)
									: undefined,
						concessionPercent:
							typeof data.concessionPercent === 'number'
								? data.concessionPercent
								: data.concessionPercent
									? Number(data.concessionPercent)
									: undefined,
						installmentCount:
							typeof data.installmentCount === 'number'
								? data.installmentCount
								: data.installmentCount
									? Number(data.installmentCount)
									: undefined,
						installmentAmount:
							typeof data.installmentAmount === 'number'
								? data.installmentAmount
								: data.installmentAmount
									? Number(data.installmentAmount)
									: undefined,
						installmentsPaid:
							typeof data.installmentsPaid === 'number'
								? data.installmentsPaid
								: data.installmentsPaid
									? Number(data.installmentsPaid)
									: undefined,
						amountPaid:
							typeof data.amountPaid === 'number'
								? data.amountPaid
								: data.amountPaid
									? Number(data.amountPaid)
									: undefined,
						date: data.date ? String(data.date) : '',
						status: (data.status as 'Pending' | 'Completed') || 'Pending',
						paymentMode: data.paymentMode ? String(data.paymentMode) : undefined,
						utr: data.utr ? String(data.utr) : undefined,
						createdAt: created ? created.toISOString() : undefined,
						updatedAt: updated ? updated.toISOString() : undefined,
						invoiceNo: data.invoiceNo ? String(data.invoiceNo) : undefined,
						invoiceGeneratedAt: data.invoiceGeneratedAt ? String(data.invoiceGeneratedAt) : undefined,
						createdByFrontdesk: data.createdByFrontdesk ? String(data.createdByFrontdesk) : undefined,
						createdByFrontdeskName: data.createdByFrontdeskName ? String(data.createdByFrontdeskName) : undefined,
						paymentRegisteredByFrontdesk: data.paymentRegisteredByFrontdesk ? String(data.paymentRegisteredByFrontdesk) : undefined,
						paymentRegisteredByFrontdeskName: data.paymentRegisteredByFrontdeskName ? String(data.paymentRegisteredByFrontdeskName) : undefined,
					} as BillingRecord;
				});
				setBilling([...mapped]);
			},
			error => {
				console.error('Failed to load billing', error);
				setBilling([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Sync completed appointments to billing
	useEffect(() => {
		if (loading || syncing || appointments.length === 0 || patients.length === 0) return;

		const syncAppointmentsToBilling = async () => {
			const currentUser = user;
			setSyncing(true);
			try {
				const completedAppointments = appointments.filter(
					appt => {
						const appointment = appt as AdminAppointmentRecord & { id: string; amount?: number; billingDeleted?: boolean };
						return appointment.status === 'completed' && !appointment.billing && !appointment.billingDeleted;
					}
				);

				if (completedAppointments.length === 0) {
					setSyncing(false);
					return;
				}

				for (const appt of completedAppointments) {
					if (!appt.appointmentId || !appt.patientId) continue;

					// Get patient data
					const patient = patients.find(p => p.patientId === appt.patientId);
					if (!patient) {
						console.warn(`Patient not found for appointment ${appt.appointmentId}`);
						continue;
					}

					// Fetch patient document to get patientType and paymentType
					const patientQuery = query(collection(db, 'patients'), where('patientId', '==', appt.patientId));
					const patientSnapshot = await getDocs(patientQuery);
					
					if (patientSnapshot.empty) {
						console.warn(`Patient document not found for appointment ${appt.appointmentId}`);
						continue;
					}

					const patientData = patientSnapshot.docs[0].data();
					const patientType = (patientData.patientType as string) || '';
					const paymentType = (patientData.paymentType as string) || 'without';
					const standardAmount = appt.amount || 1200;

					// Apply billing rules based on patient type
					let shouldCreateBill = false;
					let billAmount = standardAmount;

					if (patientType === 'VIP') {
						// VIP: Create bill for every completed session as normal
						shouldCreateBill = true;
						billAmount = standardAmount;
					} else if (patientType === 'Paid') {
						// Paid: Check paymentType
						shouldCreateBill = true;
						if (paymentType === 'with') {
							// Apply concession discount (assuming 20% discount, adjust as needed)
							billAmount = standardAmount * 0.8;
						} else {
							// Without concession: standard amount
							billAmount = standardAmount;
						}
					} else if (patientType === 'Dyes' || patientType === 'DYES') {
						// DYES: Automated billing - Rs. 500 per session, status 'Completed' (Paid)
						shouldCreateBill = true;
						billAmount = 500; // Fixed rate for DYES patients
					} else if (patientType === 'Gethhma') {
						// Gethhma: Treat as "Paid" without concession
						shouldCreateBill = true;
						billAmount = standardAmount;
					} else {
						// Unknown patient type: default behavior (create bill)
						shouldCreateBill = true;
						billAmount = standardAmount;
					}

					// Create billing record if rules allow
					if (shouldCreateBill) {
						// Check if billing record already exists
						const existingQuery = query(collection(db, 'billing'), where('appointmentId', '==', appt.appointmentId));
						const existingSnapshot = await getDocs(existingQuery);
						
						// Determine status based on patient type and billing rules
						let billStatus: 'Pending' | 'Completed' | 'Auto-Paid' = 'Pending';
						if (patientType === 'Dyes' || patientType === 'DYES') {
							// DYES patients: Auto-Paid and marked as 'Completed' (bypasses Pending Payments)
							billStatus = 'Completed';
						} else if (billAmount > 0) {
							billStatus = 'Pending';
						}

						if (!existingSnapshot.empty) {
							// Billing record exists - update it if it's a DYES patient to ensure correct status and amount
							const existingBill = existingSnapshot.docs[0];
							const existingBillData = existingBill.data();
							
							if (patientType === 'Dyes' || patientType === 'DYES') {
								// For DYES patients, update existing bills to ensure status is 'Completed' and amount is 500
								if (existingBillData.status !== 'Completed' || existingBillData.amount !== 500) {
									await updateDoc(doc(db, 'billing', existingBill.id), {
										amount: 500,
										status: 'Completed',
										paymentMode: 'Auto-Paid',
										updatedAt: serverTimestamp(),
									});
									
									// Also update appointment with billing info
									await updateDoc(doc(db, 'appointments', appt.id), {
										billing: {
											amount: '500.00',
											date: defaultBillingDate,
										},
									});
								}
							}
							continue;
						}

						const billingId = 'BILL-' + (appt.appointmentId || Date.now().toString());
						
						// Create billing record in billing collection
						await addDoc(collection(db, 'billing'), {
							billingId,
							appointmentId: appt.appointmentId,
							patient: appt.patient || '',
							patientId: appt.patientId || '',
							doctor: appt.doctor || '',
							amount: billAmount,
							date: appt.date || defaultBillingDate,
							status: billStatus,
							paymentMode: billStatus === 'Completed' && (patientType === 'Dyes' || patientType === 'DYES') ? 'Auto-Paid' : null,
							utr: null,
							createdByFrontdesk: currentUser?.uid || null,
							createdByFrontdeskName: currentUser?.displayName || currentUser?.email || null,
							createdAt: serverTimestamp(),
							updatedAt: serverTimestamp(),
						});

						// Also update appointment with billing info
						await updateDoc(doc(db, 'appointments', appt.id), {
							billing: {
								amount: billAmount.toFixed(2),
								date: defaultBillingDate,
							},
						});
					}
				}
			} catch (error) {
				console.error('Failed to sync appointments to billing', error);
			} finally {
				setSyncing(false);
			}
		};

		syncAppointmentsToBilling();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [appointments.length, patients.length, loading, user]);

	const patientLookup = useMemo(() => {
		const map = new Map<string, AdminPatientRecord & { id?: string; patientType?: string; department?: string; sessionAllowance?: SessionAllowance }>();
		for (const patient of patients) {
			map.set(patient.patientId, patient);
		}
		return map;
	}, [patients]);

	const billingLookup = useMemo(() => {
		const map = new Map<string, BillingRecord>();
		for (const bill of billing) {
			if (bill.appointmentId) {
				map.set(bill.appointmentId, bill);
			}
		}
		return map;
	}, [billing]);

	const doctorOptions = useMemo(() => {
		const set = new Set<string>();
		staff.forEach(member => {
			if (member.role === 'ClinicalTeam' && member.status !== 'Inactive' && member.userName) {
				set.add(member.userName);
			}
		});
		appointments.forEach(appointment => {
			if (appointment.doctor) set.add(appointment.doctor);
		});
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [staff, appointments]);

	const pendingRows = useMemo(() => {
		return appointments
			.map(appointment => ({ appointment }))
			.filter(entry => entry.appointment.status === 'completed' && !entry.appointment.billing)
			.filter(entry => (doctorFilter === 'all' ? true : entry.appointment.doctor === doctorFilter))
			.filter(entry => {
				if (departmentFilter === 'all') return true;
				const patient = entry.appointment.patientId
					? patientLookup.get(entry.appointment.patientId)
					: undefined;
				return patient?.department === departmentFilter;
			})
			.filter(entry => isWithinDays(entry.appointment.date, pendingWindow))
			.map(entry => {
				const patient = entry.appointment.patientId
					? patientLookup.get(entry.appointment.patientId)
					: undefined;
				const patientName =
					entry.appointment.patient || (patient ? patient.name : undefined) || entry.appointment.patientId || 'N/A';
				return { ...entry, patientName, patientRecord: patient };
			});
	}, [appointments, doctorFilter, departmentFilter, pendingWindow, patientLookup]);

	const billingHistoryRows = useMemo(() => {
		return appointments
			.map(appointment => ({ appointment }))
			.filter(entry => entry.appointment.billing && entry.appointment.billing.amount)
			.filter(entry => (doctorFilter === 'all' ? true : entry.appointment.doctor === doctorFilter))
			.filter(entry => {
				if (departmentFilter === 'all') return true;
				const patient = entry.appointment.patientId
					? patientLookup.get(entry.appointment.patientId)
					: undefined;
				return patient?.department === departmentFilter;
			})
			.filter(entry => isWithinDays(entry.appointment.billing?.date, completedWindow))
			.map(entry => {
				const patient = entry.appointment.patientId
					? patientLookup.get(entry.appointment.patientId)
					: undefined;
				const patientName =
					entry.appointment.patient || (patient ? patient.name : undefined) || entry.appointment.patientId || 'N/A';
				const amount = Number(entry.appointment.billing?.amount ?? 0);
				const billingRecord = entry.appointment.appointmentId
					? billingLookup.get(entry.appointment.appointmentId)
					: undefined;
				return { ...entry, patientName, amount, patientRecord: patient, billingRecord };
			});
	}, [appointments, doctorFilter, departmentFilter, completedWindow, patientLookup, billingLookup]);

	const totalCollections = useMemo(
		() => billingHistoryRows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0),
		[billingHistoryRows]
	);

	useEffect(() => {
		setPendingDrafts(prev => {
			const next: Record<string, PendingDraft> = {};
			let changed = false;
			for (const row of pendingRows) {
				const appointmentId = row.appointment.id;
				const existing = prev[appointmentId];
				if (existing) {
					next[appointmentId] = existing;
				} else {
					next[appointmentId] = { amount: '', date: defaultBillingDate };
					changed = true;
				}
			}
			changed = changed || Object.keys(prev).length !== Object.keys(next).length;
			return changed ? next : prev;
		});
	}, [pendingRows, defaultBillingDate]);

	const handlePendingDraftChange = (appointmentId: string, field: keyof PendingDraft, value: string) => {
		setPendingDrafts(prev => ({
			...prev,
			[appointmentId]: {
				...(prev[appointmentId] ?? { amount: '', date: defaultBillingDate }),
				[field]: value,
			},
		}));
	};

	const handleSaveBilling = async (appointmentId: string) => {
		const draft = pendingDrafts[appointmentId] ?? { amount: '', date: defaultBillingDate };
		const amountValue = Number(draft.amount);
		if (!draft.amount || Number.isNaN(amountValue) || amountValue <= 0) {
			alert('Please enter a valid amount.');
			return;
		}
		if (!draft.date) {
			alert('Please select a billing date.');
			return;
		}

		const appointment = appointments.find(a => a.id === appointmentId);
		if (!appointment) {
			alert('Appointment not found.');
			return;
		}

		const wasAlreadyCompleted = appointment.status === 'completed';
		const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;
		const staffMember = staff.find(s => s.userName === appointment.doctor);

		let sessionUsageResult: RecordSessionUsageResult | null = null;

		try {
			// Update appointment
			await updateDoc(doc(db, 'appointments', appointmentId), {
				status: 'completed',
				billing: {
					amount: amountValue.toFixed(2),
					date: draft.date,
				},
			});

			// Update or create billing record
			const billingQuery = query(collection(db, 'billing'), where('appointmentId', '==', appointment.appointmentId));
			const billingSnapshot = await getDocs(billingQuery);
			if (!billingSnapshot.empty) {
				const existingBill = billingSnapshot.docs[0].data();
				await updateDoc(doc(db, 'billing', billingSnapshot.docs[0].id), {
					amount: amountValue,
					date: draft.date,
					createdByFrontdesk: existingBill.createdByFrontdesk || user?.uid || null,
					createdByFrontdeskName: existingBill.createdByFrontdeskName || user?.displayName || user?.email || null,
					updatedAt: serverTimestamp(),
				});
			} else {
				const billingId = 'BILL-' + (appointment.appointmentId || Date.now().toString());
				await addDoc(collection(db, 'billing'), {
					billingId,
					appointmentId: appointment.appointmentId,
					patient: appointment.patient || '',
					patientId: appointment.patientId || '',
					doctor: appointment.doctor || '',
					amount: amountValue,
					date: draft.date,
					status: 'Pending',
					paymentMode: null,
					utr: null,
					createdByFrontdesk: user?.uid || null,
					createdByFrontdeskName: user?.displayName || user?.email || null,
					createdAt: serverTimestamp(),
					updatedAt: serverTimestamp(),
				});
			}

			// Notify other admins about billing record update
			await notifyAdmins(
				'Billing Record Updated',
				`${user?.displayName || user?.email || 'Admin'} ${billingSnapshot.empty ? 'created' : 'updated'} billing record for ${appointment.patient || 'patient'}`,
				'billing_updated',
				{
					billingId: billingSnapshot.empty ? 'BILL-' + (appointment.appointmentId || Date.now().toString()) : billingSnapshot.docs[0].id,
					patientId: appointment.patientId || '',
					patientName: appointment.patient || '',
					amount: amountValue,
					updatedBy: user?.uid || '',
					updatedByName: user?.displayName || user?.email || 'Unknown',
				},
				user?.uid
			);

			// Send notifications only if status changed from non-completed to completed
			if (!wasAlreadyCompleted) {
				if (patient?.id) {
					try {
						sessionUsageResult = await recordSessionUsageForAppointment({
							patientDocId: patient.id,
							patientType: patient.patientType,
							appointmentId,
							sessionCost: amountValue,
						});
					} catch (sessionError) {
						console.error('Failed to record DYES session usage:', sessionError);
					}
				}

				// Send notification to patient
				if (patient?.email) {
					try {
						await sendEmailNotification({
							to: patient.email,
							subject: `Appointment Completed - ${appointment.date}`,
							template: 'appointment-status-changed',
							data: {
								patientName: appointment.patient || patient.name,
								patientEmail: patient.email,
								patientId: appointment.patientId,
								doctor: appointment.doctor,
								date: appointment.date,
								time: appointment.time,
								appointmentId: appointment.appointmentId,
								status: 'Completed',
							},
						});
					} catch (emailError) {
						console.error('Failed to send completion email to patient:', emailError);
					}
				}

				// Send notification to staff member
				if (staffMember?.userEmail) {
					try {
						await sendEmailNotification({
							to: staffMember.userEmail,
							subject: `Appointment Completed - ${appointment.patient} on ${appointment.date}`,
							template: 'appointment-status-changed',
							data: {
								patientName: appointment.patient || patient?.name,
								patientEmail: staffMember.userEmail,
								patientId: appointment.patientId,
								doctor: appointment.doctor,
								date: appointment.date,
								time: appointment.time,
								appointmentId: appointment.appointmentId,
								status: 'Completed',
							},
						});
					} catch (emailError) {
						console.error('Failed to send completion email to staff:', emailError);
					}
				}

				if (sessionUsageResult && !sessionUsageResult.wasFree && patient?.email) {
					try {
						await sendEmailNotification({
							to: patient.email,
							subject: `Session Balance Update - ${appointment.patient || patient.name}`,
							template: 'session-balance',
							data: {
								recipientName: appointment.patient || patient.name,
								recipientType: 'patient',
								patientName: appointment.patient || patient.name,
								patientEmail: patient.email,
								patientId: appointment.patientId,
								appointmentDate: appointment.date,
								appointmentTime: appointment.time,
								freeSessionsRemaining: sessionUsageResult.remainingFreeSessions,
								pendingPaidSessions: sessionUsageResult.allowance.pendingPaidSessions,
								pendingChargeAmount: sessionUsageResult.allowance.pendingChargeAmount,
							},
						});
					} catch (sessionEmailError) {
						console.error('Failed to send session balance email to patient:', sessionEmailError);
					}
				}

				if (sessionUsageResult && !sessionUsageResult.wasFree && staffMember?.userEmail) {
					try {
						await sendEmailNotification({
							to: staffMember.userEmail,
							subject: `Pending Sessions Alert - ${appointment.patient || patient?.name}`,
							template: 'session-balance',
							data: {
								recipientName: staffMember.userName,
								recipientType: 'therapist',
								patientName: appointment.patient || patient?.name || 'Patient',
								patientEmail: staffMember.userEmail,
								patientId: appointment.patientId,
								appointmentDate: appointment.date,
								appointmentTime: appointment.time,
								freeSessionsRemaining: sessionUsageResult.remainingFreeSessions,
								pendingPaidSessions: sessionUsageResult.allowance.pendingPaidSessions,
								pendingChargeAmount: sessionUsageResult.allowance.pendingChargeAmount,
							},
						});
					} catch (sessionEmailError) {
						console.error('Failed to send session balance email to staff:', sessionEmailError);
					}
				}
			}

			setPendingDrafts(prev => {
				const next = { ...prev };
				delete next[appointmentId];
				return next;
			});
		} catch (error) {
			console.error('Failed to save billing', error);
			alert('Failed to save billing. Please try again.');
		}
	};

	const openInvoice = (details: InvoiceDetails) => {
		setInvoiceDetails(details);
		
		// Find the billing record to initialize editable invoice
		const bill = billing.find(b => b.appointmentId === details.appointmentId || b.patientId === details.appointmentId);
		if (bill) {
			const patient = patients.find(p => p.patientId === bill.patientId);
			const invoiceNo = bill.invoiceNo || bill.billingId || `INV-${bill.id?.slice(0, 8) || 'NA'}`;
			const invoiceDate = bill.date || new Date().toISOString().split('T')[0];
			
			setEditableInvoice({
				invoiceNo,
				invoiceDate,
				patientName: bill.patient || '',
				patientAddress: patient?.address || `Patient ID: ${bill.patientId}`,
				patientCity: patient?.address?.split(',').pop()?.trim() || (bill.doctor || 'Bangalore'),
				amount: bill.amount || 0,
				description: 'Physiotherapy / Strength & Conditioning Sessions',
				paymentMode: bill.paymentMode || 'Cash',
				referenceNo: bill.appointmentId || '',
				hsnSac: '9993',
				cgstRate: 5, // Default 5% CGST
				sgstRate: 5, // Default 5% SGST
				companyBankDetails: details.companyBankDetails || 'A/c Holder\'s Name: Six Sports & Business Solutions INC\nBank Name: Canara Bank\nA/c No.: 0284201007444\nBranch & IFS Code: CNRB0000444',
			});
			setSelectedBill(bill);
		}
		setIsInvoiceOpen(true);
	};

	const closeInvoice = () => {
		setInvoiceDetails(null);
		setEditableInvoice(null);
		setSelectedBill(null);
		setPreviewHtml('');
		setIsInvoiceOpen(false);
	};

	// Generate preview HTML for iframe (memoized to update when editableInvoice changes)
	useEffect(() => {
		if (!editableInvoice || !selectedBill) {
			setPreviewHtml('');
			return;
		}

		const generatePreview = async () => {
			const modifiedBill: BillingRecord = {
				...selectedBill,
				patient: editableInvoice.patientName,
				amount: editableInvoice.amount,
				date: editableInvoice.invoiceDate,
				paymentMode: editableInvoice.paymentMode,
				appointmentId: editableInvoice.referenceNo || selectedBill.appointmentId,
			};

			const html = await generateInvoiceHtml(modifiedBill, editableInvoice.invoiceNo, {
				patientName: editableInvoice.patientName,
				patientAddress: editableInvoice.patientAddress,
				patientCity: editableInvoice.patientCity,
				description: editableInvoice.description,
				hsnSac: editableInvoice.hsnSac,
				cgstRate: editableInvoice.cgstRate,
				sgstRate: editableInvoice.sgstRate,
				companyBankDetails: editableInvoice.companyBankDetails,
			});

			setPreviewHtml(html);
		};

		generatePreview();
	}, [editableInvoice, selectedBill]);

	const handleGenerateInvoiceFromPreview = async () => {
		if (!editableInvoice || !selectedBill) return;

		try {
			const modifiedBill: BillingRecord = {
				...selectedBill,
				patient: editableInvoice.patientName,
				amount: editableInvoice.amount,
				date: editableInvoice.invoiceDate,
				paymentMode: editableInvoice.paymentMode,
				appointmentId: editableInvoice.referenceNo || selectedBill.appointmentId,
			};

			const html = await generateInvoiceHtml(modifiedBill, editableInvoice.invoiceNo, {
				patientName: editableInvoice.patientName,
				patientAddress: editableInvoice.patientAddress,
				patientCity: editableInvoice.patientCity,
				description: editableInvoice.description,
				hsnSac: editableInvoice.hsnSac,
				cgstRate: editableInvoice.cgstRate,
				sgstRate: editableInvoice.sgstRate,
				companyBankDetails: editableInvoice.companyBankDetails,
			});

			const printWindow = window.open('', '_blank');
			if (!printWindow) {
				alert('Please allow pop-ups to generate the invoice.');
				return;
			}

			printWindow.document.write(html);
			printWindow.document.close();
			printWindow.focus();
			printWindow.print();

			// Update Firestore with invoice details
			if (selectedBill.id) {
				await updateDoc(doc(db, 'billing', selectedBill.id), {
					invoiceNo: editableInvoice.invoiceNo,
					invoiceGeneratedAt: new Date().toISOString(),
				});
			}

			// Close preview
			closeInvoice();
		} catch (error) {
			console.error('Invoice generation error:', error);
			alert('Failed to generate invoice. Please try again.');
		}
	};

	const handlePay = (bill: BillingRecord) => {
		const info = getInstallmentInfo(bill);
		if (info.remaining <= 0) {
			alert('All installments for this bill have already been marked as paid.');
			return;
		}
		setSelectedBill(bill);
		setShowPayModal(true);
		setPaymentMode('Cash');
		setUtr('');
		setSelectedInstallmentNumber(info.nextInstallment);
	};

	const handleClosePayModal = () => {
		setShowPayModal(false);
		setSelectedBill(null);
		setPaymentMode('Cash');
		setUtr('');
		setSelectedInstallmentNumber(null);
	};

	const handleSubmitPayment = async () => {
		if (!selectedBill) return;
		if (paymentMode === 'UPI/Card' && !utr.trim()) {
			alert('Please enter UTR/Transaction ID for UPI/Card payment.');
			return;
		}

		const { total, paid, amountPerInstallment } = getInstallmentInfo(selectedBill);
		const targetInstallment = selectedInstallmentNumber ?? (paid < total ? paid + 1 : total);
		const normalizedTarget = Math.min(Math.max(targetInstallment, paid + 1), total);
		const installmentsToMark = Math.max(0, normalizedTarget - paid);

		if (installmentsToMark <= 0) {
			alert('All installments for this bill have already been marked as paid.');
			return;
		}

		const paymentAmount = Number((installmentsToMark * amountPerInstallment).toFixed(2));
		const newPaid = paid + installmentsToMark;
		const newAmountPaid = Number(((selectedBill.amountPaid ?? 0) + paymentAmount).toFixed(2));
		const newStatus: 'Pending' | 'Completed' = newPaid >= total ? 'Completed' : 'Pending';

		try {
			await updateDoc(doc(db, 'billing', selectedBill.id!), {
				status: newStatus,
				paymentMode,
				utr: paymentMode === 'UPI/Card' ? utr.trim() : null,
				installmentsPaid: newPaid,
				amountPaid: newAmountPaid,
				paymentRegisteredByFrontdesk: user?.uid || null,
				paymentRegisteredByFrontdeskName: user?.displayName || user?.email || null,
				updatedAt: serverTimestamp(),
			});

			// Also update appointment billing status if linked
			if (selectedBill.appointmentId) {
				const appointmentQuery = query(collection(db, 'appointments'), where('appointmentId', '==', selectedBill.appointmentId));
				const appointmentSnapshot = await getDocs(appointmentQuery);
				if (!appointmentSnapshot.empty) {
					await updateDoc(doc(db, 'appointments', appointmentSnapshot.docs[0].id), {
						'billing.status': newStatus,
						'billing.paymentMode': paymentMode,
						'billing.utr': paymentMode === 'UPI/Card' ? utr.trim() : null,
					});
				}
			}

			// Notify other admins about payment completion
			if (newStatus === 'Completed') {
				await notifyAdmins(
					'Payment Completed',
					`${user?.displayName || user?.email || 'Admin'} marked payment as completed for ${selectedBill.patient}`,
					'payment_completed',
					{
						billingId: selectedBill.billingId,
						patientId: selectedBill.patientId,
						patientName: selectedBill.patient,
						amount: newAmountPaid,
						completedBy: user?.uid || '',
						completedByName: user?.displayName || user?.email || 'Unknown',
					},
					user?.uid
				);
			}

			// Notify other admins about payment completion
			if (newStatus === 'Completed') {
				await notifyAdmins(
					'Payment Completed',
					`${user?.displayName || user?.email || 'Admin'} marked payment as completed for ${selectedBill.patient}`,
					'payment_completed',
					{
						billingId: selectedBill.billingId,
						patientId: selectedBill.patientId,
						patientName: selectedBill.patient,
						amount: newAmountPaid,
						completedBy: user?.uid || '',
						completedByName: user?.displayName || user?.email || 'Unknown',
					},
					user?.uid
				);
			}

			handleClosePayModal();
		} catch (error) {
			console.error('Failed to update payment', error);
			alert(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	const handleViewPaymentSlip = (bill: BillingRecord) => {
		setSelectedBill(bill);
		setShowPaymentSlipModal(true);
	};

	const handleDeleteBilling = async (bill: BillingRecord) => {
		if (!bill.id) {
			alert('Cannot delete: Billing record ID is missing.');
			return;
		}

		const confirmMessage = `Are you sure you want to delete the billing record for ${bill.patient} (${bill.billingId})?\n\nThis action cannot be undone and will remove the record from the monthly cycle.`;
		
		if (!confirm(confirmMessage)) {
			return;
		}

		try {
			const billingRef = doc(db, 'billing', bill.id);
			await deleteDoc(billingRef);
			
			// If this billing record is associated with an appointment, mark the appointment
			// to prevent it from being re-synced and creating a new billing record
			if (bill.appointmentId) {
				const appointmentQuery = query(collection(db, 'appointments'), where('appointmentId', '==', bill.appointmentId));
				const appointmentSnapshot = await getDocs(appointmentQuery);
				
				if (!appointmentSnapshot.empty) {
					const appointmentRef = appointmentSnapshot.docs[0].ref;
					// Clear the billing field and set a flag to prevent re-syncing
					await updateDoc(appointmentRef, {
						billing: null,
						billingDeleted: true, // Flag to prevent re-syncing
					});
				}
			}
			
			// The record will automatically be removed from the view since we're using onSnapshot
			// which will update the billing state when the document is deleted
		} catch (error) {
			console.error('Failed to delete billing record', error);
			alert(`Failed to delete billing record: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	// Parse Excel file
	const parseExcelFile = async (file: File): Promise<any[]> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const data = e.target?.result;
					const workbook = XLSX.read(data, { type: 'binary' });

					const allRows: any[] = [];

					workbook.SheetNames.forEach(sheetName => {
						const worksheet = workbook.Sheets[sheetName];
						const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

						if (jsonData.length < 2) {
							return; // skip empty/headers-only sheets
						}

						const headers = ((jsonData[0] as unknown) as any[]).map((h: any) => String(h || '').toLowerCase().trim());
						const rows = jsonData.slice(1).map((row: unknown) => {
							const rowArray = (row as unknown) as any[];
							const obj: any = {};
							headers.forEach((header, idx) => {
								obj[header] = rowArray[idx] !== undefined && rowArray[idx] !== null ? String(rowArray[idx]).trim() : '';
							});
							return obj;
						});

						allRows.push(...rows.filter(row => Object.values(row).some(v => v !== '')));
					});

					if (allRows.length === 0) {
						reject(new Error('Excel file must have at least one sheet with data rows'));
						return;
					}

					resolve(allRows);
				} catch (error) {
					reject(error);
				}
			};
			reader.onerror = () => reject(new Error('Failed to read Excel file'));
			reader.readAsBinaryString(file);
		});
	};

	// Handle file selection for import
	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setImportFile(file);
		try {
			const parsed = await parseExcelFile(file);
			
			// Map columns to billing fields (flexible column name matching)
			const mapped = parsed.map((row: any, index: number) => {
				// Find doctor
				const doctor = row['doctor'] || row['doctor name'] || row['doctorname'] || '';
				// Find amount
				const amountStr = row['amount'] || row['total'] || row['price'] || '0';
				const amount = parseFloat(String(amountStr).replace(/[^0-9.-]/g, '')) || 0;
				// Find date (this is the registration date)
				const dateStr = row['date'] || row['registration date'] || row['reg date'] || row['registered date'] || '';
				// Format date to YYYY-MM-DD
				let formattedDate = '';
				if (dateStr) {
					try {
						const date = new Date(dateStr);
						if (!isNaN(date.getTime())) {
							const year = date.getFullYear();
							const month = String(date.getMonth() + 1).padStart(2, '0');
							const day = String(date.getDate()).padStart(2, '0');
							formattedDate = `${year}-${month}-${day}`;
						} else {
							formattedDate = dateStr;
						}
					} catch {
						formattedDate = dateStr;
					}
				}

				// Generate IDs
				const timestamp = Date.now();
				const billingId = `BILL-IMPORT-${timestamp}-${index + 1}`;
				const patientId = `IMP-${timestamp}-${index + 1}`;
				const patientName =
					row['name of athlete'] ||
					row['name of athelete'] ||
					row['athlete name'] ||
					row['athlete'] ||
					row['patient'] ||
					row['patient name'] ||
					row['name'] ||
					row['patientname'] ||
					`Imported Patient ${index + 1}`;

				return {
					billingId,
					patient: patientName,
					patientId,
					doctor: doctor || undefined,
					amount,
					date: formattedDate || new Date().toISOString().split('T')[0],
					paymentMode: 'N/A',
					status: 'Completed' as const,
					rowIndex: index + 2, // Excel row number (1-indexed, +1 for header)
					originalRow: row,
					errors: [] as string[],
				};
			});

			// Validate mapped data
			const validated = mapped.map((item: any) => {
				const errors: string[] = [];
				if (!item.date) errors.push('Missing date');
				return { ...item, errors };
			});

			setImportPreview(validated);
		} catch (error: any) {
			console.error('Failed to parse Excel file', error);
			alert(`Failed to parse Excel file: ${error.message || 'Unknown error'}`);
			setImportFile(null);
		}
	};

	// Handle import confirmation
	const handleImportConfirm = async () => {
		if (!importPreview.length) return;

		const validRows = importPreview.filter((row: any) => row.errors.length === 0);
		if (validRows.length === 0) {
			alert('No valid rows to import. Please fix errors in the preview.');
			return;
		}

		setImporting(true);
		try {
			const batch = writeBatch(db);

			for (const row of validRows) {
				const billingRef = doc(collection(db, 'billing'));
				batch.set(billingRef, {
					billingId: row.billingId,
					patient: row.patient,
					patientId: row.patientId,
					doctor: row.doctor || null,
					amount: row.amount,
					date: row.date,
					status: 'Completed',
					paymentMode: 'N/A',
					utr: null,
					paymentRegisteredByFrontdeskName: 'N/A',
					createdAt: serverTimestamp(),
					updatedAt: serverTimestamp(),
				});
			}

			await batch.commit();

			alert(`Successfully imported ${validRows.length} completed payment(s)!`);
			setShowImportModal(false);
			setImportFile(null);
			setImportPreview([]);
		} catch (error: any) {
			console.error('Import failed:', error);
			alert(`Failed to import payments: ${error.message || 'Unknown error'}`);
		} finally {
			setImporting(false);
		}
	};

	// Generate receipt HTML when selectedBill changes
	useEffect(() => {
		if (selectedBill && showPaymentSlipModal) {
			const receiptNo = selectedBill.billingId || `BILL-${selectedBill.id?.slice(0, 8) || 'NA'}`;
			generateReceiptHtml(selectedBill, receiptNo).then(setReceiptHtml).catch(error => {
				console.error('Error generating receipt HTML:', error);
				setReceiptHtml('');
			});
		} else {
			setReceiptHtml('');
		}
	}, [selectedBill, showPaymentSlipModal]);

	const handlePrintPaymentSlip = async () => {
		if (!selectedBill) return;
		
		const receiptNo = selectedBill.billingId || `BILL-${selectedBill.id?.slice(0, 8) || 'NA'}`;
		const html = await generateReceiptHtml(selectedBill, receiptNo);
		const printWindow = window.open('', '_blank');
		if (!printWindow) return;
		
		// Write the complete HTML document directly
		printWindow.document.open();
		printWindow.document.write(html);
		printWindow.document.close();
		
		// Wait for the document to be ready and images to load
		const printWhenReady = () => {
			// Check if document is ready
			if (printWindow.document.readyState === 'complete') {
				// Wait a bit more for images to render
				setTimeout(() => {
					printWindow.focus();
					printWindow.print();
				}, 200);
			} else {
				// Wait for document to be ready
				printWindow.addEventListener('load', () => {
					setTimeout(() => {
						printWindow.focus();
						printWindow.print();
					}, 200);
				});
			}
		};
		
		// Try printing after a short delay to ensure everything is loaded
		setTimeout(printWhenReady, 100);
	};

	const handleGenerateInvoice = (bill: BillingRecord) => {
		// Open editable invoice modal instead of directly printing
		const patient = patients.find(p => p.patientId === bill.patientId);
		const invoiceNo = bill.invoiceNo || bill.billingId || `INV-${bill.id?.slice(0, 8) || 'NA'}`;
		const invoiceDate = bill.date || new Date().toISOString().split('T')[0];
		
		setEditableInvoice({
			invoiceNo,
			invoiceDate,
			patientName: bill.patient || '',
			patientAddress: patient?.address || `Patient ID: ${bill.patientId}`,
			patientCity: patient?.address?.split(',').pop()?.trim() || (bill.doctor || 'Bangalore'),
			amount: bill.amount || 0,
			description: 'Physiotherapy / Strength & Conditioning Sessions',
			paymentMode: bill.paymentMode || 'Cash',
			referenceNo: bill.appointmentId || '',
			hsnSac: '9993',
			cgstRate: 5, // Default 5% CGST
			sgstRate: 5, // Default 5% SGST
			companyBankDetails: 'A/c Holder\'s Name: Six Sports & Business Solutions INC\nBank Name: Canara Bank\nA/c No.: 0284201007444\nBranch & IFS Code: CNRB0000444',
		});
		setSelectedBill(bill);
		setInvoiceDetails({
			patient: bill.patient,
			appointmentId: bill.appointmentId || bill.patientId,
			doctor: bill.doctor || '',
			billingDate: bill.date || '',
			amount: bill.amount.toString(),
		});
		setIsInvoiceOpen(true);
	};

	const _handleExportHistory = (format: 'csv' | 'excel' = 'csv') => {
		if (!billingHistoryRows.length) {
			alert('No billing history to export.');
			return;
		}
		const rows = [
			['Patient ID', 'Patient Name', 'Clinician', 'Appointment Date', 'Billing Amount', 'Billing Date'],
			...billingHistoryRows.map(row => [
				row.appointment.patientId ?? '',
				row.patientName ?? '',
				row.appointment.doctor ?? '',
				row.appointment.date ?? '',
				Number(row.amount).toFixed(2),
				row.appointment.billing?.date ?? '',
			]),
		];

		if (format === 'csv') {
			const csv = rows
				.map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
				.join('\n');

			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `billing-history-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} else {
			// Excel export
			const ws = XLSX.utils.aoa_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Billing History');
			
			// Set column widths
			ws['!cols'] = [
				{ wch: 15 }, // Patient ID
				{ wch: 25 }, // Patient Name
				{ wch: 20 }, // Clinician
				{ wch: 18 }, // Appointment Date
				{ wch: 15 }, // Billing Amount
				{ wch: 15 }, // Billing Date
			];

			XLSX.writeFile(wb, `billing-history-${new Date().toISOString().slice(0, 10)}.xlsx`);
		}
	};

	const handleMonthlyReset = async () => {
		if (!confirm('Are you sure you want to close the current billing cycle and start a new one? This action cannot be undone.')) {
			return;
		}

		setResettingCycle(true);
		try {
			// Close current cycle
			const currentCycleId = getBillingCycleId(currentCycle.month, currentCycle.year);
			const existingCycle = billingCycles.find(c => 
				c.month === currentCycle.month && c.year === currentCycle.year
			);

			if (existingCycle && existingCycle.status === 'active') {
				await updateDoc(doc(db, 'billingCycles', existingCycle.id), {
					status: 'closed',
					closedAt: serverTimestamp(),
				});
			}

			// Create new cycle (next month)
			const nextCycle = getNextBillingCycle();
			const newCycleId = getBillingCycleId(nextCycle.month, nextCycle.year);
			
			// Check if next cycle already exists
			const nextCycleExists = billingCycles.find(c => 
				c.month === nextCycle.month && c.year === nextCycle.year
			);

			if (!nextCycleExists) {
				await addDoc(collection(db, 'billingCycles'), {
					id: newCycleId,
					startDate: nextCycle.startDate,
					endDate: nextCycle.endDate,
					month: nextCycle.month,
					year: nextCycle.year,
					status: 'active',
					createdAt: serverTimestamp(),
				});
			} else {
				await updateDoc(doc(db, 'billingCycles', nextCycleExists.id), {
					status: 'active',
				});
			}

			setCurrentCycle(nextCycle);
			alert('Billing cycle reset successfully!');
		} catch (error) {
			console.error('Failed to reset billing cycle', error);
			alert('Failed to reset billing cycle. Please try again.');
		} finally {
			setResettingCycle(false);
		}
	};

	const handleSendBillingNotifications = async () => {
		if (!confirm('Send billing notifications to all patients with pending bills older than 3 days?')) {
			return;
		}

		setSendingNotifications(true);
		try {
			const user = auth.currentUser;
			if (!user) throw new Error('Not authenticated');
			const token = await user.getIdToken();
			const response = await fetch('/api/billing/notifications?days=3', {
				headers: { Authorization: `Bearer ${token}` },
			});
			const result = await response.json();

			if (result.success) {
				alert(`Notifications sent successfully!\n\nEmails: ${result.emailsSent}\nSMS: ${result.smsSent}\nBills notified: ${result.billsNotified}`);
			} else {
				alert(`Failed to send notifications: ${result.message || 'Unknown error'}`);
			}
		} catch (error) {
			console.error('Failed to send billing notifications', error);
			alert('Failed to send billing notifications. Please try again.');
		} finally {
			setSendingNotifications(false);
		}
	};

	const _handleExportPending = (format: 'csv' | 'excel' = 'csv') => {
		if (pendingRows.length === 0) {
			alert('No pending items to export.');
		 return;
		}
		const rows = [
			['Patient', 'Clinician', 'Visit Date', 'Draft Amount (₹)', 'Draft Billing Date'],
			...pendingRows.map(row => {
				const draft = pendingDrafts[row.appointment.id] ?? { amount: '', date: defaultBillingDate };
				return [
					row.patientName || '',
					row.appointment.doctor || '',
					row.appointment.date || '',
					draft.amount || '',
					draft.date || '',
				];
			}),
		];
		if (format === 'csv') {
			const csv = rows.map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `pending-billing-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} else {
			const ws = XLSX.utils.aoa_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Pending Billing');
			ws['!cols'] = [
				{ wch: 25 }, // Patient
				{ wch: 20 }, // Clinician
				{ wch: 14 }, // Visit Date
				{ wch: 16 }, // Draft Amount
				{ wch: 16 }, // Draft Billing Date
			];
			XLSX.writeFile(wb, `pending-billing-${new Date().toISOString().slice(0, 10)}.xlsx`);
		}
	};

	const isWithinCycle = (dateIso: string | undefined, cycle?: { startDate?: string; endDate?: string }) => {
		if (!dateIso || !cycle?.startDate || !cycle?.endDate) return false;
		const d = new Date(dateIso);
		if (Number.isNaN(d.getTime())) return false;
		const start = new Date(cycle.startDate);
		const end = new Date(cycle.endDate);
		return d >= start && d <= end;
	};

	const selectedCycle = useMemo(() => {
		if (selectedCycleId === 'current') return currentCycle;
		return billingCycles.find(c => c.id === selectedCycleId) || currentCycle;
	}, [selectedCycleId, billingCycles, currentCycle]);

	const cycleSummary = useMemo(() => {
		const cycle = selectedCycle;
		if (!cycle) {
			return {
				pendingCount: 0,
				completedCount: 0,
				collectedAmount: 0,
				byClinician: [] as Array<{ doctor: string; amount: number }>,
			};
		}
		let pendingCount = 0;
		let completedCount = 0;
		let collectedAmount = 0;
		const byClinicianMap = new Map<string, number>();

		// Use billing collection for cycle summary
		for (const bill of billing) {
			const billDate = bill.date;
			const billAmount = Number(bill.amount ?? 0);
			if (billDate && isWithinCycle(billDate, cycle)) {
				if (bill.status === 'Pending') {
					pendingCount += 1;
				} else if (bill.status === 'Completed' || bill.status === 'Auto-Paid') {
					completedCount += 1;
					collectedAmount += Number.isFinite(billAmount) ? billAmount : 0;
					const key = bill.doctor || 'Unassigned';
					byClinicianMap.set(key, (byClinicianMap.get(key) || 0) + (Number.isFinite(billAmount) ? billAmount : 0));
				}
			}
		}

		const byClinician = Array.from(byClinicianMap.entries())
			.map(([doctor, amount]) => ({ doctor, amount }))
			.sort((a, b) => b.amount - a.amount);

		return { pendingCount, completedCount, collectedAmount, byClinician };
	}, [billing, selectedCycle]);

	// Pending payments from billing collection
	const pending = useMemo(() => {
		return billing.filter(b => b.status === 'Pending');
	}, [billing]);
	const filteredPending = useMemo(() => {
		if (!pendingSearchQuery.trim()) return pending;
		const query = pendingSearchQuery.toLowerCase().trim();
		return pending.filter(bill => 
			bill.billingId?.toLowerCase().includes(query) ||
			bill.patient?.toLowerCase().includes(query) ||
			bill.patientId?.toLowerCase().includes(query) ||
			bill.doctor?.toLowerCase().includes(query) ||
			bill.amount?.toString().includes(query) ||
			bill.date?.toLowerCase().includes(query)
		);
	}, [pending, pendingSearchQuery]);

	// Completed payments from billing collection
	const completed = useMemo(() => {
		return billing
			.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid')
			.filter(bill => {
				if (departmentFilter === 'all') return true;
				const patient = bill.patientId ? patientLookup.get(bill.patientId) : undefined;
				return patient?.department === departmentFilter;
			});
	}, [billing, departmentFilter, patientLookup]);
	const filteredCompleted = useMemo(() => {
		if (!completedSearchQuery.trim()) return completed;
		const query = completedSearchQuery.toLowerCase().trim();
		return completed.filter(bill => 
			bill.billingId?.toLowerCase().includes(query) ||
			bill.patient?.toLowerCase().includes(query) ||
			bill.patientId?.toLowerCase().includes(query) ||
			bill.doctor?.toLowerCase().includes(query) ||
			bill.amount?.toString().includes(query) ||
			bill.date?.toLowerCase().includes(query) ||
			bill.paymentMode?.toLowerCase().includes(query) ||
			bill.createdByFrontdeskName?.toLowerCase().includes(query) ||
			bill.paymentRegisteredByFrontdeskName?.toLowerCase().includes(query)
		);
	}, [completed, completedSearchQuery]);

	return (
		<div className="min-h-svh bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Billing & Payments"
				/>

				<div className="border-t border-slate-200" />

				{/* Billing Cycle Management */}
				<section className="rounded-2xl bg-white p-6 shadow-[0_20px_50px_rgba(30,58,138,0.15)] border border-blue-100">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">Billing Cycle Management</h3>
							<p className="text-sm text-slate-600">
								Current Cycle: <span className="font-medium">{getMonthName(currentCycle.month)} {currentCycle.year}</span>
								{' '}({currentCycle.startDate} to {currentCycle.endDate})
							</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleSendBillingNotifications}
								disabled={sendingNotifications}
								className="inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-amber-500 focus-visible:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<i className={`fas ${sendingNotifications ? 'fa-spinner fa-spin' : 'fa-bell'} mr-2 text-sm`} aria-hidden="true" />
								{sendingNotifications ? 'Sending...' : 'Send Notifications'}
							</button>
							<button
								type="button"
								onClick={handleMonthlyReset}
								disabled={resettingCycle}
								className="inline-flex items-center rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-purple-500 focus-visible:bg-purple-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<i className={`fas ${resettingCycle ? 'fa-spinner fa-spin' : 'fa-sync-alt'} mr-2 text-sm`} aria-hidden="true" />
								{resettingCycle ? 'Resetting...' : 'Reset Monthly Cycle'}
							</button>
						</div>
					</div>
					{billingCycles.length > 0 && (
						<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
							<p className="mb-2 text-sm font-medium text-slate-700">Recent Billing Cycles:</p>
							<div className="flex flex-wrap gap-2">
								{billingCycles.slice(-6).reverse().map(cycle => (
									<span
										key={cycle.id}
										className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
											cycle.status === 'active'
												? 'bg-green-100 text-green-800'
												: cycle.status === 'closed'
												? 'bg-slate-100 text-slate-800'
												: 'bg-amber-100 text-amber-800'
										}`}
									>
										{getMonthName(cycle.month)} {cycle.year} ({cycle.status})
									</span>
								))}
							</div>
						</div>
					)}
				</section>

				{/* Cycle Reports */}
				<section className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
					<div className="mb-4 flex flex-wrap items-end justify-between gap-3">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">Cycle Reports</h3>
							<p className="text-sm text-slate-600">Summary of pending and collections within a selected billing cycle.</p>
						</div>
						<div className="min-w-[220px]">
							<label className="block text-sm font-medium text-slate-700">Select Cycle</label>
							<select
								value={selectedCycleId}
								onChange={e => setSelectedCycleId(e.target.value as any)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="current">Current ({getMonthName(currentCycle.month)} {currentCycle.year})</option>
								{billingCycles.slice().reverse().map(cycle => (
									<option key={cycle.id} value={cycle.id}>
										{getMonthName(cycle.month)} {cycle.year} ({cycle.startDate} → {cycle.endDate})
									</option>
								))}
							</select>
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<p className="text-xs uppercase tracking-wide text-slate-500">Pending (in cycle)</p>
							<p className="mt-2 text-2xl font-semibold text-slate-900">{cycleSummary.pendingCount}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<p className="text-xs uppercase tracking-wide text-slate-500">Bills Completed (in cycle)</p>
							<p className="mt-2 text-2xl font-semibold text-slate-900">{cycleSummary.completedCount}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<p className="text-xs uppercase tracking-wide text-slate-500">Collections (in cycle)</p>
							<p className="mt-2 text-2xl font-semibold text-slate-900">{rupee(cycleSummary.collectedAmount)}</p>
						</div>
					</div>
					{cycleSummary.byClinician.length > 0 && (
						<div className="mt-6 overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
								<thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
									<tr>
										<th className="px-4 py-2 font-semibold">Clinician</th>
										<th className="px-4 py-2 font-semibold">Collections (₹)</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{cycleSummary.byClinician.map(row => (
										<tr key={row.doctor}>
											<td className="px-4 py-2">{row.doctor}</td>
											<td className="px-4 py-2">{rupee(row.amount)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				<section className="flex flex-wrap gap-4 rounded-2xl bg-white p-6 shadow-[0_20px_50px_rgba(30,58,138,0.15)] border border-navy-100">
				<div className="min-w-[220px] flex-1">
					<label className="block text-sm font-medium text-slate-700">Filter by Clinician</label>
					<select
						value={doctorFilter}
						onChange={event => setDoctorFilter(event.target.value)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						<option value="all">All Clinicians</option>
						{doctorOptions.map(option => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
				<div className="min-w-[220px] flex-1">
					<label className="block text-sm font-medium text-indigo-900">Filter by Department</label>
					<select
						value={departmentFilter}
						onChange={event => setDepartmentFilter(event.target.value)}
						className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm text-slate-700 transition focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
					>
						<option value="all">All Departments</option>
						{Array.from(new Set(patients.map(p => p.department).filter(Boolean))).sort().map(dept => (
							<option key={dept} value={dept}>
								{dept}
							</option>
						))}
					</select>
				</div>
				<div className="min-w-[200px]">
					<label className="block text-sm font-medium text-indigo-900">Pending Billing Period</label>
					<select
						value={pendingWindow}
						onChange={event => setPendingWindow(event.target.value as DateFilter)}
						className="mt-1 w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm text-slate-700 transition focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
					>
						{dateOptions.map(option => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
				<div className="min-w-[200px]">
					<label className="block text-sm font-medium text-slate-700">Completed Payments Period</label>
					<select
						value={completedWindow}
						onChange={event => setCompletedWindow(event.target.value as DateFilter)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						{dateOptions.map(option => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			</section>

			<p className="mx-auto mt-6 max-w-6xl text-sm font-medium text-sky-700">
				Total Collections (filtered): <span className="font-semibold">{rupee(totalCollections)}</span>
			</p>

			<section className="mx-auto mt-4 grid max-w-6xl gap-4 lg:grid-cols-2">
				<article className="flex flex-col rounded-2xl bg-white shadow-[0_20px_50px_rgba(30,58,138,0.15)] border border-navy-100 max-h-[calc(100vh-280px)]">
					<header className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-indigo-100 to-blue-100 px-4 py-3 border-b border-indigo-200 flex-shrink-0">
						<div>
							<h2 className="text-base font-semibold text-indigo-900">Pending Billing</h2>
							<p className="text-xs text-indigo-700">
								Completed appointments awaiting a recorded payment.
							</p>
						</div>
						<div className="flex items-center gap-2">
						<span className="inline-flex h-6 min-w-7 items-center justify-center rounded-full bg-navy-600 px-2 text-xs font-semibold text-white shadow-md">
							{pendingRows.length}
						</span>
						</div>
					</header>
					<div className="overflow-x-auto overflow-y-auto px-4 pb-4 pt-2 flex-1">
						<table className="min-w-full divide-y divide-indigo-200 text-left text-xs text-slate-700">
							<thead className="bg-indigo-50 text-xs uppercase tracking-wide text-indigo-900 sticky top-0">
								<tr>
									<th className="px-2 py-1.5 font-semibold">Patient / Department</th>
									<th className="px-2 py-1.5 font-semibold">Clinician</th>
									<th className="px-2 py-1.5 font-semibold">Visit Date</th>
									<th className="px-2 py-1.5 font-semibold">Amount (₹)</th>
									<th className="px-2 py-1.5 font-semibold">Billing Date</th>
									<th className="px-2 py-1.5 font-semibold text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-indigo-100">
								{pendingRows.length === 0 ? (
									<tr>
										<td colSpan={6} className="px-2 py-4 text-center text-xs text-slate-500">
											No pending billing items for the selected filters.
										</td>
									</tr>
								) : (
									pendingRows.map(row => {
										const draft = pendingDrafts[row.appointment.id] ?? {
											amount: '',
											date: defaultBillingDate,
										};
										return (
											<tr key={row.appointment.id}>
												<td className="px-2 py-2 font-medium text-slate-800">
													<div className="text-xs">{row.patientName}</div>
													{row.patientRecord?.department && (
														<p className="mt-0.5 text-[10px] text-indigo-600 font-medium">{row.patientRecord.department}</p>
													)}
													{row.patientRecord?.patientType === 'DYES' && (
														<p className="mt-0.5 text-[10px] text-amber-600">
															Pending sessions:{' '}
															{row.patientRecord.sessionAllowance?.pendingPaidSessions ?? 0}
															{row.patientRecord.sessionAllowance
																? ` · Free left: ${getRemainingFreeSessions(row.patientRecord.sessionAllowance)}`
																: ''}
														</p>
													)}
												</td>
												<td className="px-2 py-2 text-xs text-slate-600">{row.appointment.doctor || '—'}</td>
												<td className="px-2 py-2 text-xs text-slate-600">{row.appointment.date || '—'}</td>
												<td className="px-2 py-2">
													<input
														type="number"
														min="0"
														step="0.01"
														value={draft.amount}
														onChange={event =>
															handlePendingDraftChange(row.appointment.id, 'amount', event.target.value)
														}
														className="w-24 rounded border border-amber-200 px-1.5 py-0.5 text-xs text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
													/>
												</td>
												<td className="px-2 py-2">
													<input
														type="date"
														value={draft.date}
														onChange={event =>
															handlePendingDraftChange(row.appointment.id, 'date', event.target.value)
														}
														className="w-32 rounded border border-amber-200 px-1.5 py-0.5 text-xs text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
													/>
												</td>
												<td className="px-2 py-2 text-right">
													<button
														type="button"
														onClick={() => handleSaveBilling(row.appointment.id)}
														className="inline-flex items-center rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-500"
													>
														<i className="fas fa-save mr-1 text-[9px]" aria-hidden="true" />
														Save
													</button>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</article>

				<article className="flex flex-col rounded-2xl bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)] max-h-[calc(100vh-280px)]">
					<header className="flex items-center justify-between rounded-t-2xl bg-sky-500 px-4 py-3 text-white flex-shrink-0">
						<div>
							<h2 className="text-base font-semibold">Billing History</h2>
							<p className="text-xs text-blue-100">Recorded invoices that have been completed.</p>
						</div>
						<span className="inline-flex h-6 min-w-7 items-center justify-center rounded-full bg-indigo-800 px-2 text-xs font-semibold text-white shadow-md">
							{billingHistoryRows.length}
						</span>
					</header>
					<div className="overflow-x-auto overflow-y-auto px-4 pb-4 pt-2 flex-1">
						<table className="min-w-full divide-y divide-sky-200 text-left text-xs text-slate-700">
							<thead className="bg-indigo-50 text-xs uppercase tracking-wide text-indigo-900 sticky top-0">
								<tr>
									<th className="px-2 py-1.5 font-semibold">Patient / Department</th>
									<th className="px-2 py-1.5 font-semibold">Clinician</th>
									<th className="px-2 py-1.5 font-semibold">Visit Date</th>
									<th className="px-2 py-1.5 font-semibold">Amount (₹)</th>
									<th className="px-2 py-1.5 font-semibold">Billing Date</th>
									<th className="px-2 py-1.5 font-semibold">Created By</th>
									<th className="px-2 py-1.5 font-semibold text-right">Receipt</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-sky-100">
								{billingHistoryRows.length === 0 ? (
									<tr>
										<td colSpan={7} className="px-2 py-4 text-center text-xs text-slate-500">
											No billing history for the selected filters.
										</td>
									</tr>
								) : (
									billingHistoryRows.map(row => (
										<tr key={row.appointment.id}>
											<td className="px-2 py-2 font-medium text-slate-800">
												<div className="text-xs">{row.patientName}</div>
												{row.patientRecord?.department && (
													<p className="mt-0.5 text-[10px] text-indigo-600 font-medium">{row.patientRecord.department}</p>
												)}
											</td>
											<td className="px-2 py-2 text-xs text-slate-600">{row.appointment.doctor || '—'}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{row.appointment.date || '—'}</td>
											<td className="px-2 py-2 text-xs text-slate-700">
												{rupee(Number(row.appointment.billing?.amount ?? 0))}
											</td>
											<td className="px-2 py-2 text-xs text-slate-600">{row.appointment.billing?.date || '—'}</td>
											<td className="px-2 py-2 text-xs text-slate-600">
												{row.billingRecord?.createdByFrontdeskName || '—'}
											</td>
											<td className="px-2 py-2 text-right">
												<button
													type="button"
													onClick={() =>
														openInvoice({
															patient: row.patientName,
															appointmentId: row.appointment.appointmentId || row.appointment.patientId,
															doctor: row.appointment.doctor ?? '—',
															billingDate: row.appointment.billing?.date ?? '',
															amount: row.appointment.billing?.amount ?? '0',
														})
													}
													className="inline-flex items-center rounded-full border border-sky-200 px-2 py-0.5 text-[10px] font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-800 focus-visible:border-sky-400 focus-visible:text-sky-800 focus-visible:outline-none"
												>
													<i className="fas fa-receipt mr-1 text-[9px]" aria-hidden="true" />
													Invoice
												</button>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</article>
			</section>

			{/* Invoice Preview Modal */}
			{isInvoiceOpen && editableInvoice && selectedBill && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6 overflow-y-auto">
					<div className="w-full max-w-7xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-8 flex flex-col max-h-[90vh]">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
							<h2 className="text-lg font-semibold text-slate-900">Invoice Preview & Edit</h2>
							<button
								type="button"
								onClick={closeInvoice}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="p-6 overflow-y-auto flex-1">
							<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
								{/* Editable Fields */}
								<div className="space-y-4">
									<h3 className="text-md font-semibold text-slate-900 mb-4">Edit Invoice Details</h3>
									
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Invoice Number</label>
										<input
											type="text"
											value={editableInvoice.invoiceNo}
											onChange={e => setEditableInvoice({ ...editableInvoice, invoiceNo: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date</label>
										<input
											type="date"
											value={editableInvoice.invoiceDate}
											onChange={e => setEditableInvoice({ ...editableInvoice, invoiceDate: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Patient Name</label>
										<input
											type="text"
											value={editableInvoice.patientName}
											onChange={e => setEditableInvoice({ ...editableInvoice, patientName: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Patient Address</label>
										<textarea
											value={editableInvoice.patientAddress}
											onChange={e => setEditableInvoice({ ...editableInvoice, patientAddress: e.target.value })}
											rows={3}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">City</label>
										<input
											type="text"
											value={editableInvoice.patientCity}
											onChange={e => setEditableInvoice({ ...editableInvoice, patientCity: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Amount (Taxable Value)</label>
										<input
											type="number"
											step="0.01"
											value={editableInvoice.amount}
											onChange={e => setEditableInvoice({ ...editableInvoice, amount: parseFloat(e.target.value) || 0 })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
										<input
											type="text"
											value={editableInvoice.description}
											onChange={e => setEditableInvoice({ ...editableInvoice, description: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<label className="block text-sm font-medium text-slate-700 mb-1">HSN/SAC</label>
											<input
												type="text"
												value={editableInvoice.hsnSac}
												onChange={e => setEditableInvoice({ ...editableInvoice, hsnSac: e.target.value })}
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											/>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<label className="block text-sm font-medium text-slate-700 mb-1">CGST Tax Rate (%)</label>
											<input
												type="number"
												step="0.01"
												value={editableInvoice.cgstRate}
												onChange={e => setEditableInvoice({ ...editableInvoice, cgstRate: parseFloat(e.target.value) || 5 })}
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											/>
										</div>
										<div>
											<label className="block text-sm font-medium text-slate-700 mb-1">SGST Tax Rate (%)</label>
											<input
												type="number"
												step="0.01"
												value={editableInvoice.sgstRate}
												onChange={e => setEditableInvoice({ ...editableInvoice, sgstRate: parseFloat(e.target.value) || 5 })}
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											/>
										</div>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode</label>
										<select
											value={editableInvoice.paymentMode}
											onChange={e => setEditableInvoice({ ...editableInvoice, paymentMode: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										>
											<option value="Cash">Cash</option>
											<option value="UPI/Card">UPI/Card</option>
										</select>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Reference Number</label>
										<input
											type="text"
											value={editableInvoice.referenceNo}
											onChange={e => setEditableInvoice({ ...editableInvoice, referenceNo: e.target.value })}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">Company's Bank Details</label>
										<textarea
											value={editableInvoice.companyBankDetails || ''}
											onChange={e => setEditableInvoice({ ...editableInvoice, companyBankDetails: e.target.value })}
											placeholder="Enter company bank details..."
											rows={4}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
									</div>
								</div>

								{/* Preview */}
								<div className="space-y-4">
									<h3 className="text-md font-semibold text-slate-900 mb-4">Invoice Preview</h3>
									<div className="border border-slate-300 rounded-lg overflow-hidden bg-white" style={{ height: '800px' }}>
										<iframe
											title="Invoice Preview"
											srcDoc={previewHtml}
											key={previewHtml}
											className="w-full h-full border-0"
											style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%', height: '125%' }}
										/>
									</div>
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 flex-shrink-0">
							<button
								type="button"
								onClick={closeInvoice}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleGenerateInvoiceFromPreview}
								className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
							>
								<i className="fas fa-print mr-2 text-sm" aria-hidden="true" />
								Generate & Print Invoice
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Pending Payments Section */}
			<section className="mx-auto mt-4 grid max-w-6xl gap-4">
				<article className="flex flex-col rounded-2xl bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)] max-h-[calc(100vh-280px)]">
					<header className="flex flex-col rounded-t-2xl bg-amber-100 px-4 py-3 text-amber-900 flex-shrink-0">
						<div className="flex items-center justify-between mb-2">
							<div>
								<h2 className="text-base font-semibold">Pending Payments</h2>
								<p className="text-xs text-amber-800/80">
									Bills awaiting payment confirmation.
								</p>
							</div>
							<span className="inline-flex h-6 min-w-7 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-semibold text-white">
								{filteredPending.length}
							</span>
						</div>
						<div className="relative mt-2">
							<input
								type="text"
								placeholder="Search by Patient, Patient ID, Doctor, Amount, or Date..."
								value={pendingSearchQuery}
								onChange={(e) => setPendingSearchQuery(e.target.value)}
								className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 pl-8 text-xs text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
							/>
							<i className="fas fa-search absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden="true" />
						</div>
					</header>
					<div className="overflow-x-auto overflow-y-auto px-4 pb-4 pt-2 flex-1">
						<table className="min-w-full divide-y divide-amber-200 text-left text-xs text-slate-700">
							<thead className="bg-amber-50 text-xs uppercase tracking-wide text-amber-700 sticky top-0">
								<tr>
									<th className="px-2 py-1.5 font-semibold">Patient</th>
									<th className="px-2 py-1.5 font-semibold">Patient ID</th>
									<th className="px-2 py-1.5 font-semibold">Doctor</th>
									<th className="px-2 py-1.5 font-semibold">Amount (₹)</th>
									<th className="px-2 py-1.5 font-semibold">Plan</th>
									<th className="px-2 py-1.5 font-semibold">Date</th>
									<th className="px-2 py-1.5 font-semibold text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-amber-100">
								{filteredPending.length === 0 ? (
									<tr>
										<td colSpan={7} className="px-2 py-4 text-center text-xs text-slate-500">
											{pendingSearchQuery.trim() ? 'No pending payments match your search.' : 'No pending payments.'}
										</td>
									</tr>
								) : (
									filteredPending.map(bill => (
										<tr key={bill.id}>
											<td className="px-2 py-2 text-xs font-medium text-slate-800">{bill.patient}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.patientId}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.doctor || '—'}</td>
											<td className="px-2 py-2 text-xs text-slate-700">Rs. {bill.amount.toFixed(2)}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{formatInstallmentPlan(bill)}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.date || '—'}</td>
											<td className="px-2 py-2 text-right">
												<div className="flex items-center justify-end gap-1.5">
													<button
														type="button"
														onClick={() => handlePay(bill)}
														className="inline-flex items-center rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
													>
														Pay
													</button>
													<button
														type="button"
														onClick={() => handleDeleteBilling(bill)}
														className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
														title="Delete billing record"
													>
														<i className="fas fa-trash text-[9px]" aria-hidden="true" />
													</button>
												</div>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</article>
			</section>

			{/* Completed Payments Section */}
			<section className="mx-auto mt-4 grid max-w-6xl gap-4">
				<article className="flex flex-col rounded-2xl bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)] max-h-[calc(100vh-280px)]">
					<header className="flex flex-col rounded-t-2xl bg-emerald-100 px-4 py-3 text-emerald-900 flex-shrink-0">
						<div className="flex items-center justify-between mb-2">
							<div>
								<h2 className="text-base font-semibold">Completed Payments</h2>
								<p className="text-xs text-navy-700">
									Payments that have been completed.
								</p>
							</div>
							<div className="flex items-center gap-2">
								<span className="inline-flex h-6 min-w-7 items-center justify-center rounded-full bg-navy-600 px-2 text-xs font-semibold text-white shadow-md">
									{filteredCompleted.length}
								</span>
								<button
									type="button"
									onClick={() => setShowImportModal(true)}
									className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-emerald-700 hover:via-emerald-800 hover:to-teal-700 transition-all duration-200 hover:scale-105"
								>
									<i className="fas fa-file-excel text-[10px]" aria-hidden="true" />
									Import Excel
								</button>
							</div>
						</div>
						<div className="relative mt-2">
							<input
								type="text"
								placeholder="Search by Patient, Patient ID, Doctor, Amount, Date, Payment Mode, Created By, or Payment By..."
								value={completedSearchQuery}
								onChange={(e) => setCompletedSearchQuery(e.target.value)}
								className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-1.5 pl-8 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
							/>
							<i className="fas fa-search absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden="true" />
						</div>
					</header>
					<div className="overflow-x-auto overflow-y-auto px-4 pb-4 pt-2 flex-1">
						<table className="min-w-full divide-y divide-emerald-200 text-left text-xs text-slate-700">
							<thead className="bg-indigo-50 text-xs uppercase tracking-wide text-indigo-900 sticky top-0">
								<tr>
									<th className="px-2 py-1.5 font-semibold">Patient / Department</th>
									<th className="px-2 py-1.5 font-semibold">Patient ID</th>
									<th className="px-2 py-1.5 font-semibold">Doctor</th>
									<th className="px-2 py-1.5 font-semibold">Amount (₹)</th>
									<th className="px-2 py-1.5 font-semibold">Plan</th>
									<th className="px-2 py-1.5 font-semibold">Payment Mode</th>
									<th className="px-2 py-1.5 font-semibold">Created By</th>
									<th className="px-2 py-1.5 font-semibold">Payment By</th>
									<th className="px-2 py-1.5 font-semibold text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-emerald-100">
								{filteredCompleted.length === 0 ? (
									<tr>
										<td colSpan={9} className="px-2 py-4 text-center text-xs text-slate-500">
											{completedSearchQuery.trim() ? 'No completed payments match your search.' : 'No completed payments.'}
										</td>
									</tr>
								) : (
									filteredCompleted.map(bill => {
										const patient = bill.patientId ? patientLookup.get(bill.patientId) : undefined;
										return (
										<tr key={bill.id}>
												<td className="px-2 py-2 text-xs font-medium text-slate-800">
													<div>{bill.patient}</div>
													{patient?.department && (
														<p className="mt-0.5 text-[10px] text-indigo-600 font-medium">{patient.department}</p>
													)}
												</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.patientId}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.doctor || '—'}</td>
											<td className="px-2 py-2 text-xs text-slate-700">Rs. {bill.amount.toFixed(2)}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{formatInstallmentPlan(bill)}</td>
											<td className="px-2 py-2 text-xs text-slate-600">{bill.paymentMode || '—'}</td>
												<td className="px-2 py-2 text-xs text-slate-600">
													{bill.createdByFrontdeskName || '—'}
												</td>
												<td className="px-2 py-2 text-xs text-slate-600">
													{bill.paymentRegisteredByFrontdeskName || '—'}
												</td>
											<td className="px-2 py-2 text-right">
												<div className="flex items-center justify-end gap-1.5">
													<button
														type="button"
														onClick={() => handleViewPaymentSlip(bill)}
														className="inline-flex items-center rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
													>
														Receipt
													</button>
													<button
														type="button"
														onClick={() => handleGenerateInvoice(bill)}
														className="inline-flex items-center rounded-lg border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
													>
														Invoice
													</button>
													<button
														type="button"
														onClick={() => handleDeleteBilling(bill)}
														className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
														title="Delete billing record"
													>
														<i className="fas fa-trash text-[9px]" aria-hidden="true" />
													</button>
												</div>
											</td>
										</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</article>
			</section>

			{/* Payment Modal */}
			{showPayModal && selectedBill && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">Mark Payment as Completed</h2>
							<button
								type="button"
								onClick={handleClosePayModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="px-6 py-6">
							<div className="mb-4">
								<label className="block text-sm font-medium text-slate-700 mb-2">Payment Mode</label>
								<select
									value={paymentMode}
									onChange={e => setPaymentMode(e.target.value as 'Cash' | 'UPI/Card')}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								>
									<option value="Cash">Cash</option>
									<option value="UPI/Card">UPI/Card</option>
								</select>
							</div>
							{paymentMode === 'UPI/Card' && (
								<div className="mb-4">
									<label className="block text-sm font-medium text-slate-700 mb-2">UTR/Transaction ID</label>
									<input
										type="text"
										value={utr}
										onChange={e => setUtr(e.target.value)}
										placeholder="Enter UTR/Transaction ID"
										className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									/>
								</div>
							)}
							{(() => {
								const { total, paid } = getInstallmentInfo(selectedBill);
								if (total <= 1 || paid >= total) return null;
								return (
									<div className="mb-4">
										<label className="block text-sm font-medium text-slate-700 mb-2">Installment</label>
										<select
											value={selectedInstallmentNumber ?? ''}
											onChange={event => setSelectedInstallmentNumber(Number(event.target.value))}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										>
											{Array.from({ length: total }, (_, index) => index + 1).map(number => {
												const alreadyPaid = (selectedBill.installmentsPaid ?? 0) >= number;
												return (
													<option key={number} value={number} disabled={alreadyPaid}>
														Installment {number} {alreadyPaid ? '(Paid)' : ''}
													</option>
												);
											})}
										</select>
									</div>
								);
							})()}
							{(() => {
								const { total, paid, amountPerInstallment } = getInstallmentInfo(selectedBill);
								const target = selectedInstallmentNumber ?? paid + 1;
								const installmentsToMark = Math.max(0, Math.min(target, total) - paid);
								const charge = Number((installmentsToMark * amountPerInstallment).toFixed(2));
								return (
									<div className="rounded-lg bg-slate-50 p-4 space-y-1.5 text-sm text-slate-700">
										<p>
											Patient:{' '}
											<span className="font-medium text-slate-900">{selectedBill.patient}</span>
										</p>
										<p>
											Plan:{' '}
											<span className="font-medium text-slate-900">{formatInstallmentPlan(selectedBill)}</span>
										</p>
										<p>
											Installments paid: <strong>{paid}</strong> / {total}
										</p>
										<p>
											Remaining after this payment:{' '}
											<strong>{Math.max(total - (paid + installmentsToMark), 0)}</strong>
										</p>
										<p>
											Charge this payment:{' '}
											<strong>
												Rs.{' '}
												{charge.toLocaleString('en-IN', {
													minimumFractionDigits: 2,
													maximumFractionDigits: 2,
												})}
											</strong>
										</p>
									</div>
								);
							})()}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={handleClosePayModal}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSubmitPayment}
								className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
							>
								Confirm Payment
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Payment Slip Modal */}
			{showPaymentSlipModal && selectedBill && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">Payment Receipt</h2>
							<button
								type="button"
								onClick={() => {
									setShowPaymentSlipModal(false);
									setSelectedBill(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="px-6 py-6">
							{receiptHtml ? (
								<div dangerouslySetInnerHTML={{ __html: receiptHtml }} />
							) : (
								<div className="flex items-center justify-center py-8">
									<div className="text-center">
										<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
										<p className="text-sm text-slate-600">Loading receipt...</p>
									</div>
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={handlePrintPaymentSlip}
								className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
							>
								<i className="fas fa-print mr-2 text-sm" aria-hidden="true" />
								Print
							</button>
							<button
								type="button"
								onClick={() => {
									setShowPaymentSlipModal(false);
									setSelectedBill(null);
								}}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Import Excel Modal */}
			{showImportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
						<div className="p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">Import Completed Payments from Excel</h2>
							<p className="text-sm text-slate-600 mt-1">
								Upload an Excel file with payment data. BILL ID will be auto-generated and PAID BY will be set to "N/A".
							</p>
						</div>
						<div className="p-6">
							{!importFile ? (
								<div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
									<input
										type="file"
										accept=".xlsx,.xls"
										onChange={handleFileSelect}
										className="hidden"
										id="excel-file-input-admin"
									/>
									<label
										htmlFor="excel-file-input-admin"
										className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition"
									>
										<i className="fas fa-file-excel" aria-hidden="true" />
										Select Excel File
									</label>
									<p className="text-sm text-slate-500 mt-4">
										Supported formats: .xlsx, .xls
									</p>
								</div>
							) : (
								<div className="space-y-4">
									<div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
										<div className="flex items-center gap-3">
											<i className="fas fa-file-excel text-emerald-600 text-xl" aria-hidden="true" />
											<div>
												<p className="font-medium text-slate-900">{importFile.name}</p>
												<p className="text-xs text-slate-500">
													{(importFile.size / 1024).toFixed(2)} KB
												</p>
											</div>
										</div>
										<button
											type="button"
											onClick={() => {
												setImportFile(null);
												setImportPreview([]);
											}}
											className="text-slate-500 hover:text-slate-700"
										>
											<i className="fas fa-times" aria-hidden="true" />
										</button>
									</div>

									{importPreview.length > 0 && (
										<div className="border border-slate-200 rounded-lg overflow-hidden">
											<div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
												<p className="text-sm font-semibold text-slate-900">
													Preview ({importPreview.length} rows)
												</p>
											</div>
											<div className="overflow-x-auto max-h-96">
												<table className="min-w-full divide-y divide-slate-200 text-sm">
													<thead className="bg-slate-50">
														<tr>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Row</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Bill ID</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Patient</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Patient ID</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Amount</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Date</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Status</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-100">
														{importPreview.map((row: any, idx: number) => (
															<tr
																key={idx}
																className={row.errors.length > 0 ? 'bg-rose-50' : 'bg-white'}
															>
																<td className="px-3 py-2 text-slate-600">{row.rowIndex}</td>
																<td className="px-3 py-2 font-mono text-xs text-slate-700">{row.billingId}</td>
																<td className="px-3 py-2 text-slate-700">{row.patient || <span className="text-rose-600">Missing</span>}</td>
																<td className="px-3 py-2 text-slate-600">{row.patientId || <span className="text-rose-600">Missing</span>}</td>
																<td className="px-3 py-2 text-slate-700">Rs. {row.amount.toFixed(2)}</td>
																<td className="px-3 py-2 text-slate-600">{row.date}</td>
																<td className="px-3 py-2">
																	{row.errors.length > 0 ? (
																		<div className="text-xs text-rose-600">
																			{row.errors.join(', ')}
																		</div>
																	) : (
																		<span className="text-xs text-emerald-600 font-semibold">Valid</span>
																	)}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</div>
							)}
						</div>
						<div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
							<button
								type="button"
								onClick={() => {
									setShowImportModal(false);
									setImportFile(null);
									setImportPreview([]);
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
								disabled={importing}
							>
								Cancel
							</button>
							{importFile && importPreview.length > 0 && (
								<button
									type="button"
									onClick={handleImportConfirm}
									disabled={importing || importPreview.filter((r: any) => r.errors.length === 0).length === 0}
									className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{importing ? (
										<>
											<i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
											Importing...
										</>
									) : (
										<>
											Import {importPreview.filter((r: any) => r.errors.length === 0).length} Payment(s)
										</>
									)}
								</button>
							)}
						</div>
					</div>
				</div>
			)}
			</div>
		</div>
	);
}



