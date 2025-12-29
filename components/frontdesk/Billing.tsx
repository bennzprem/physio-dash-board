'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	addDoc,
	updateDoc,
	deleteDoc,
	query,
	where,
	getDocs,
	serverTimestamp,
	orderBy,
	writeBatch,
	type QuerySnapshot,
	type Timestamp,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import {
	getCurrentBillingCycle,
	getNextBillingCycle,
	getBillingCycleId,
	getMonthName,
	getCurrentCalendarYear,
	type BillingCycle,
} from '@/lib/billingUtils';

interface BillingRecord {
	id?: string;
	billingId: string;
	appointmentId?: string;
	patient: string;
	patientId: string;
	doctor?: string;
	amount: number;
	date: string;
	status: 'Pending' | 'Completed' | 'Auto-Paid';
	paymentMode?: string;
	utr?: string;
	createdAt?: string | Timestamp;
	updatedAt?: string | Timestamp;

	// Invoice-related fields (may or may not exist in Firestore)
	invoiceNo?: string;
	invoiceGeneratedAt?: string;
}

function getCurrentMonthYear() {
	const now = new Date();
	return `${now.getFullYear()}-${now.getMonth() + 1}`;
}

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
		patientType?: string;
	}
) {
	const isReferral = (options?.patientType || '').toUpperCase() === 'REFERRAL';
	const taxableValue = isReferral ? 0 : Number(bill.amount || 0);
	const cgstRate = options?.cgstRate ?? 5; // Default 5% CGST
	const sgstRate = options?.sgstRate ?? 5; // Default 5% SGST
	const cgstAmount = isReferral ? 0 : Number((taxableValue * (cgstRate / 100)).toFixed(2));
	const sgstAmount = isReferral ? 0 : Number((taxableValue * (sgstRate / 100)).toFixed(2));
	const grandTotal = isReferral ? 0 : Number((taxableValue + cgstAmount + sgstAmount).toFixed(2));

	const words = isReferral ? 'N/A' : numberToWords(grandTotal);
	const taxWords = isReferral ? 'N/A' : numberToWords(cgstAmount + sgstAmount);
	const showDate = bill.date || new Date().toLocaleDateString('en-IN');

	// Show last 5 digits of UTR if payment mode is UPI / Online
	let paymentModeDisplay = bill.paymentMode || 'Cash';
	const normalizedMode = paymentModeDisplay.toLowerCase();
	if ((normalizedMode.includes('upi') || normalizedMode.includes('online')) && bill.utr) {
		const lastFive = bill.utr.slice(-5);
		paymentModeDisplay += ` (...${lastFive})`;
	}

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
									`<span class="bold" style="font-size: 14px;">SIXS SPORTS AND BUSINESS SOLUTIONS INC</span><br>
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
								<td><strong>Reference No. & Date</strong><br>${escapeHtml(bill.appointmentId || '')}</td>
								<td><strong>Other References</strong><br>&nbsp;</td>
							</tr>
							<tr>
								<td><strong>Buyer's Order No.</strong><br>&nbsp;</td>
								<td><strong>Dated</strong><br>&nbsp;</td>
							</tr>
							<tr>
								<td><strong>Dispatch Doc No.</strong><br>&nbsp;</td>
								<td><strong>Delivery Note Date</strong><br>&nbsp;</td>
							</tr>
							<tr>
								<td><strong>Dispatched through</strong><br>&nbsp;</td>
								<td><strong>Destination</strong><br>&nbsp;</td>
							</tr>
							<tr>
								<td colspan="2" style="height: 30px;"><strong>Terms of Delivery</strong><br>&nbsp;</td>
							</tr>
						</table>
					</td>
				</tr>
				<tr>
					<td colspan="2">
						<strong>Consignee (Ship to)</strong><br>
						${buyerName}<br>
						${buyerAddress}
					</td>
				</tr>
				<tr>
					<td colspan="2">
						<strong>Buyer (Bill to)</strong><br>
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
						<td>${isReferral ? 'N/A' : taxableValue.toFixed(2)}</td>
						<td>Session</td>
						<td class="text-right">${isReferral ? 'N/A' : taxableValue.toFixed(2)}</td>
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
							${isReferral ? 'N/A' : cgstAmount.toFixed(2)}<br>
							${isReferral ? 'N/A' : sgstAmount.toFixed(2)}
						</td>
					</tr>
					
					<tr class="bold">
						<td colspan="6" class="text-right">Total</td>
						<td class="text-right">${isReferral ? 'N/A' : grandTotal.toFixed(2)}</td>
					</tr>
				</tbody>
			</table>

			<div style="border: 1px solid #000; border-top: none; padding: 5px;">
				<strong>Amount Chargeable (in words):</strong><br>
				${isReferral ? 'N/A' : escapeHtml(words.toUpperCase())} ${isReferral ? '' : 'ONLY'}
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
					<td>${isReferral ? 'N/A' : taxableValue.toFixed(2)}</td>
					<td>${cgstRate}%</td>
					<td>${isReferral ? 'N/A' : cgstAmount.toFixed(2)}</td>
					<td>${sgstRate}%</td>
					<td>${isReferral ? 'N/A' : sgstAmount.toFixed(2)}</td>
					<td>${isReferral ? 'N/A' : (cgstAmount + sgstAmount).toFixed(2)}</td>
				</tr>
				<tr class="bold">
					<td class="text-right">Total</td>
					<td>${isReferral ? 'N/A' : taxableValue.toFixed(2)}</td>
					<td></td>
					<td>${isReferral ? 'N/A' : cgstAmount.toFixed(2)}</td>
					<td></td>
					<td>${isReferral ? 'N/A' : sgstAmount.toFixed(2)}</td>
					<td>${isReferral ? 'N/A' : (cgstAmount + sgstAmount).toFixed(2)}</td>
				</tr>
			</table>

			<div style="border: 1px solid #000; border-top: none; padding: 5px;">
				<strong>Tax Amount (In words):</strong> ${escapeHtml(taxWords.toUpperCase())} ONLY
			</div>

			<table style="border-top: none;">
				<tr>
					<td width="50%" style="border-right: 1px solid #000;">
						Company's PAN: <strong>ADZF83168H</strong><br><br>
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
							for <strong>SIXS SPORTS AND BUSINESS SOLUTIONS INC</strong><br><br><br>
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
async function generateReceiptHtml(bill: BillingRecord, receiptNo: string, options?: { patientType?: string }) {
	const isReferral = (options?.patientType || '').toUpperCase() === 'REFERRAL';
	const amount = isReferral ? 'N/A' : Number(bill.amount || 0).toFixed(2);
	const words = isReferral ? 'N/A' : numberToWords(Number(bill.amount || 0));
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
						<strong>${isReferral ? 'N/A' : `Rs. ${amount}`}</strong>
					</div>
				</div>
				<div class="words-row">
					Amount in words: <span style="font-weight: normal;">${isReferral ? 'N/A' : escapeHtml(words)}</span>
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
	const [billing, setBilling] = useState<BillingRecord[]>([]);
	const [appointments, setAppointments] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [filterRange, setFilterRange] = useState<string>('30');
	const [selectedBill, setSelectedBill] = useState<BillingRecord | null>(null);
	const [showPayModal, setShowPayModal] = useState(false);
	const [showPaymentSlipModal, setShowPaymentSlipModal] = useState(false);
	const [isEditingReceipt, setIsEditingReceipt] = useState(false);
	const [editableReceiptData, setEditableReceiptData] = useState<{
		amount: number;
		date: string;
		paymentMode: string;
		utr: string;
		patient: string;
		patientId: string;
		doctor?: string;
		appointmentId?: string;
	} | null>(null);
	const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI/Card'>('Cash');
	const [utr, setUtr] = useState('');
	const [paymentAmount, setPaymentAmount] = useState<number | string>(0);
	const [syncing, setSyncing] = useState(false);
	const [resettingCycle, setResettingCycle] = useState(false);
	const [sendingNotifications, setSendingNotifications] = useState(false);
	const [currentCycle, setCurrentCycle] = useState(() => getCurrentBillingCycle());
	const [billingCycles, setBillingCycles] = useState<BillingCycle[]>([]);
	const [patients, setPatients] = useState<any[]>([]);
	const [selectedCycleId, setSelectedCycleId] = useState<string>('current');
	const [showInvoicePreview, setShowInvoicePreview] = useState(false);
	const [pendingSearchQuery, setPendingSearchQuery] = useState<string>('');
	const [completedSearchQuery, setCompletedSearchQuery] = useState<string>('');
	const [showImportModal, setShowImportModal] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [importPreview, setImportPreview] = useState<any[]>([]);
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
		patientType?: string;
	} | null>(null);

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
						date: data.date ? String(data.date) : '',
						status: (data.status as 'Pending' | 'Completed') || 'Pending',
						paymentMode: data.paymentMode ? String(data.paymentMode) : undefined,
						utr: data.utr ? String(data.utr) : undefined,
						createdAt: created ? created.toISOString() : undefined,
						updatedAt: updated ? updated.toISOString() : undefined,
						invoiceNo: data.invoiceNo ? String(data.invoiceNo) : undefined,
						invoiceGeneratedAt: data.invoiceGeneratedAt ? String(data.invoiceGeneratedAt) : undefined,
					} as BillingRecord;
				});
				setBilling([...mapped]);
				setLoading(false);
			},
			error => {
				console.error('Failed to load billing', error);
				setBilling([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load appointments from Firestore for syncing
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						appointmentId: data.appointmentId ? String(data.appointmentId) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						status: data.status ? String(data.status) : '',
						amount: data.amount ? Number(data.amount) : 1200,
					};
				});
				setAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
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

	// Sync completed appointments to billing
	useEffect(() => {
		if (loading || syncing || appointments.length === 0) return;

		const syncAppointmentsToBilling = async () => {
			setSyncing(true);
			try {
				const completedAppointments = appointments.filter(appt => appt.status === 'completed');
				const existingBillingIds = new Set(billing.map(b => b.appointmentId).filter(Boolean));

				for (const appt of completedAppointments) {
					if (!appt.appointmentId || existingBillingIds.has(appt.appointmentId)) continue;

					// Check if billing record already exists
					const existingQuery = query(collection(db, 'billing'), where('appointmentId', '==', appt.appointmentId));
					const existingSnapshot = await getDocs(existingQuery);
					if (!existingSnapshot.empty) continue;

					// Fetch patient document to get patientType
					const patientQuery = query(collection(db, 'patients'), where('patientId', '==', appt.patientId));
					const patientSnapshot = await getDocs(patientQuery);

					if (patientSnapshot.empty) {
						console.warn(`Patient not found for appointment ${appt.appointmentId}`);
						continue;
					}

					const patientData = patientSnapshot.docs[0].data();
					const patientType = (patientData.patientType as string) || '';
					const paymentType = (patientData.paymentType as string) || 'without';
					const standardAmount = appt.amount || 1200;

					// Apply billing rules based on patient type
					let shouldCreateBill = false;
					let billAmount = standardAmount;

					if (patientType === 'Referral' || patientType === 'REFERRAL') {
						// Referral: Create billing record with 0 amount (will show N/A in invoices/receipts)
						shouldCreateBill = true;
						billAmount = 0;
					} else if (patientType === 'VIP') {
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
								}
							}
							continue;
						}

						const billingId = 'BILL-' + (appt.appointmentId || Date.now().toString());
						
						await addDoc(collection(db, 'billing'), {
							billingId,
							appointmentId: appt.appointmentId,
							patient: appt.patient || '',
							patientId: appt.patientId || '',
							doctor: appt.doctor || '',
							amount: billAmount,
							date: appt.date || new Date().toISOString().split('T')[0],
							status: billStatus,
							paymentMode: billStatus === 'Completed' && (patientType === 'Dyes' || patientType === 'DYES') ? 'Auto-Paid' : null,
							utr: null,
							createdAt: serverTimestamp(),
							updatedAt: serverTimestamp(),
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
	}, [appointments.length, billing.length]);

	const filteredBilling = useMemo(() => {
		if (filterRange === 'all') return billing;
		const days = parseInt(filterRange, 10);
		const now = new Date();
		return billing.filter(b => {
			const d = new Date(b.date);
			return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= days;
		});
	}, [billing, filterRange]);

	const monthlyTotal = useMemo(() => {
		return filteredBilling
			.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid')
			.reduce((sum, bill) => sum + (bill.amount || 0), 0);
	}, [filteredBilling]);

	const pending = useMemo(() => filteredBilling.filter(b => b.status === 'Pending'), [filteredBilling]);
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
	const completed = useMemo(() => filteredBilling.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid'), [filteredBilling]);
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
			bill.paymentMode?.toLowerCase().includes(query)
		);
	}, [completed, completedSearchQuery]);

	// Calculate cycle summary based on selected cycle
	type CycleRange = ReturnType<typeof getCurrentBillingCycle>;
	const cycleSummary = useMemo(() => {
		let selectedCycle: BillingCycle | CycleRange | null = null;

		if (selectedCycleId === 'current') {
			selectedCycle = currentCycle;
		} else {
			selectedCycle = billingCycles.find(c => c.id === selectedCycleId) || null;
		}

		if (!selectedCycle) {
			return {
				pending: 0,
				completed: 0,
				collections: 0,
			};
		}

		const startDate = new Date(selectedCycle.startDate);
		const endDate = new Date(selectedCycle.endDate);
		endDate.setHours(23, 59, 59, 999); // Include the entire end date

		const cycleBills = billing.filter(bill => {
			const billDate = new Date(bill.date);
			return billDate >= startDate && billDate <= endDate;
		});

		const pendingCount = cycleBills.filter(b => b.status === 'Pending').length;
		const completedCount = cycleBills.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid').length;
		const collections = cycleBills
			.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid')
			.reduce((sum, bill) => sum + (bill.amount || 0), 0);

		return {
			pending: pendingCount,
			completed: completedCount,
			collections,
		};
	}, [selectedCycleId, currentCycle, billingCycles, billing]);

	const handlePay = (bill: BillingRecord) => {
		setSelectedBill(bill);
		setPaymentMode('Cash');
		setUtr('');
		const patient = patients.find(p => p.patientId === bill.patientId);
		const isReferral = (patient?.patientType || '').toUpperCase() === 'REFERRAL';
		setPaymentAmount(isReferral ? 'N/A' : bill.amount);
		setShowPayModal(true);
	};

	const handleSubmitPayment = async () => {
		if (!selectedBill || !selectedBill.id) return;

		// For referral patients, amount should be 0 (stored in DB) even if displayed as "N/A"
		const paymentAmountStr = String(paymentAmount).trim().toUpperCase();
		const amountToSave = paymentAmountStr === 'N/A' ? 0 : (typeof paymentAmount === 'number' ? paymentAmount : parseFloat(String(paymentAmount)) || 0);

		try {
			const billingRef = doc(db, 'billing', selectedBill.id);
			await updateDoc(billingRef, {
				status: 'Completed',
				amount: amountToSave,
				paymentMode,
				utr: paymentMode === 'UPI/Card' ? utr : null,
				updatedAt: serverTimestamp(),
			});
			setShowPayModal(false);
			setSelectedBill(null);
			setPaymentMode('Cash');
			setUtr('');
			setPaymentAmount(0);
		} catch (error) {
			console.error('Failed to update payment', error);
			alert(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
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
			// The record will automatically be removed from the view since we're using onSnapshot
			// which will update the billing state when the document is deleted
		} catch (error) {
			console.error('Failed to delete billing record', error);
			alert(`Failed to delete billing record: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	// Helper function to convert date string to YYYY-MM-DD format for date input
	const formatDateForInput = (dateStr: string): string => {
		if (!dateStr) return '';
		// If already in YYYY-MM-DD format, return as is
		if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
		// Try to parse and format
		try {
			const date = new Date(dateStr);
			if (!isNaN(date.getTime())) {
				const year = date.getFullYear();
				const month = String(date.getMonth() + 1).padStart(2, '0');
				const day = String(date.getDate()).padStart(2, '0');
				return `${year}-${month}-${day}`;
			}
		} catch (e) {
			// If parsing fails, return original
		}
		return dateStr;
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

	const handleViewPaymentSlip = (bill: BillingRecord) => {
		setSelectedBill(bill);
		setIsEditingReceipt(false);
		setEditableReceiptData({
			amount: bill.amount,
			date: formatDateForInput(bill.date),
			paymentMode: bill.paymentMode || 'Cash',
			utr: bill.utr || '',
			patient: bill.patient,
			patientId: bill.patientId,
			doctor: bill.doctor,
			appointmentId: bill.appointmentId,
		});
		setShowPaymentSlipModal(true);
	};

	const handleSaveReceipt = async () => {
		if (!selectedBill || !editableReceiptData) return;

		try {
			const billingRef = doc(db, 'billing', selectedBill.id!);
			await updateDoc(billingRef, {
				amount: editableReceiptData.amount,
				date: editableReceiptData.date,
				paymentMode: editableReceiptData.paymentMode,
				utr: editableReceiptData.utr || null,
				patient: editableReceiptData.patient,
				patientId: editableReceiptData.patientId,
				doctor: editableReceiptData.doctor || null,
				appointmentId: editableReceiptData.appointmentId || null,
				updatedAt: serverTimestamp(),
			});

			// Update local state
			setSelectedBill({
				...selectedBill,
				amount: editableReceiptData.amount,
				date: editableReceiptData.date,
				paymentMode: editableReceiptData.paymentMode,
				utr: editableReceiptData.utr,
				patient: editableReceiptData.patient,
				patientId: editableReceiptData.patientId,
				doctor: editableReceiptData.doctor,
				appointmentId: editableReceiptData.appointmentId,
			});

			setIsEditingReceipt(false);
			alert('Receipt updated successfully!');
		} catch (error) {
			console.error('Failed to update receipt:', error);
			alert('Failed to update receipt. Please try again.');
		}
	};

	const handlePrintPaymentSlip = async () => {
		if (!selectedBill) return;
		
		// Use editable data if available, otherwise use selectedBill
		const billToPrint = editableReceiptData ? {
			...selectedBill,
			amount: editableReceiptData.amount,
			date: editableReceiptData.date,
			paymentMode: editableReceiptData.paymentMode,
			utr: editableReceiptData.utr,
			patient: editableReceiptData.patient,
			patientId: editableReceiptData.patientId,
			doctor: editableReceiptData.doctor,
			appointmentId: editableReceiptData.appointmentId,
		} : selectedBill;
		
		const receiptNo = billToPrint.billingId || `BILL-${billToPrint.id?.slice(0, 8) || 'NA'}`;
		const patient = patients.find(p => p.patientId === billToPrint.patientId);
		const patientType = patient?.patientType || '';
		const html = await generateReceiptHtml(billToPrint, receiptNo, { patientType });
		const printWindow = window.open('', '_blank');

		if (!printWindow) {
			alert('Please allow pop-ups to generate the receipt.');
			return;
		}

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

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: data.gender ? String(data.gender) : '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						diagnosis: data.diagnosis ? String(data.diagnosis) : '',
						treatmentProvided: data.treatmentProvided ? String(data.treatmentProvided) : '',
						progressNotes: data.progressNotes ? String(data.progressNotes) : '',
						patientType: data.patientType ? String(data.patientType) : '',
					};
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

	const handleExportBilling = (format: 'csv' | 'excel' = 'csv') => {
		if (!filteredBilling.length) {
			alert('No billing records to export.');
			return;
		}

		const rows = [
			['Bill ID', 'Patient ID', 'Patient Name', 'Appointment ID', 'Doctor', 'Amount', 'Date', 'Status', 'Payment Mode', 'UTR'],
			...filteredBilling.map(bill => [
				bill.billingId || '',
				bill.patientId || '',
				bill.patient || '',
				bill.appointmentId || '',
				bill.doctor || '',
				bill.amount || 0,
				bill.date || '',
				bill.status || '',
				bill.paymentMode || '',
				bill.utr || '',
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
			link.setAttribute('download', `billing-export-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} else {
			// Excel export
			const ws = XLSX.utils.aoa_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Billing Records');

			// Set column widths
			ws['!cols'] = [
				{ wch: 15 }, // Bill ID
				{ wch: 15 }, // Patient ID
				{ wch: 25 }, // Patient Name
				{ wch: 15 }, // Appointment ID
				{ wch: 20 }, // Doctor
				{ wch: 12 }, // Amount
				{ wch: 12 }, // Date
				{ wch: 12 }, // Status
				{ wch: 15 }, // Payment Mode
				{ wch: 20 }, // UTR
			];

			XLSX.writeFile(wb, `billing-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
		}
	};

	const handleMonthlyReset = async () => {
		if (
			!confirm(
				'Are you sure you want to close the current billing cycle and start a new one? This action cannot be undone.'
			)
		) {
			return;
		}

		setResettingCycle(true);
		try {
			// Close current cycle
			const currentCycleId = getBillingCycleId(currentCycle.month, currentCycle.year);
			const existingCycle = billingCycles.find(
				c => c.month === currentCycle.month && c.year === currentCycle.year
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
			const nextCycleExists = billingCycles.find(
				c => c.month === nextCycle.month && c.year === nextCycle.year
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
			const response = await fetch('/api/billing/notifications?days=3');
			const result = await response.json();

			if (result.success) {
				alert(
					`Notifications sent successfully!\n\nEmails: ${result.emailsSent}\nSMS: ${result.smsSent}\nBills notified: ${result.billsNotified}`
				);
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

	// Show invoice preview with editable fields
	const handleShowInvoicePreview = (bill: BillingRecord) => {
		const patient = patients.find(p => p.patientId === bill.patientId);
		const invoiceNo = bill.invoiceNo || bill.billingId || `INV-${bill.id?.slice(0, 8) || 'NA'}`;
		const invoiceDate = bill.date || new Date().toISOString().split('T')[0];
		const patientType = patient?.patientType || '';
		
		setEditableInvoice({
			invoiceNo,
			invoiceDate,
			patientName: bill.patient || '',
			patientAddress: patient?.address || `Patient ID: ${bill.patientId}`,
			patientCity: patient?.address?.split(',').pop()?.trim() || 'Bangalore',
			amount: bill.amount || 0,
			description: 'Physiotherapy / Strength & Conditioning Sessions',
			paymentMode: bill.paymentMode || 'Cash',
			referenceNo: bill.appointmentId || '',
			hsnSac: '9993',
			cgstRate: 5, // Default 5% CGST
			sgstRate: 5, // Default 5% SGST
			companyBankDetails: 'A/c Holder\'s Name: Six Sports & Business Solutions INC\nBank Name: Canara Bank\nA/c No.: 0284201007444\nBranch & IFS Code: CNRB0000444',
			patientType,
		});
		setSelectedBill(bill);
		setShowInvoicePreview(true);
	};

	// Generate invoice from edited preview data
	const handleGenerateInvoiceFromPreview = async () => {
		if (!editableInvoice || !selectedBill) return;

		try {
			// Create a modified bill with edited values
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
				patientType: editableInvoice.patientType,
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
			setShowInvoicePreview(false);
			setEditableInvoice(null);
			setSelectedBill(null);
		} catch (error) {
			console.error('Invoice generation error:', error);
			alert('Failed to generate invoice. Please try again.');
		}
	};

	// Generate preview HTML for iframe (memoized to update when editableInvoice changes)
	const [previewHtml, setPreviewHtml] = useState('');

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
				patientType: editableInvoice.patientType,
			});

			setPreviewHtml(html);
		};

		generatePreview();
	}, [editableInvoice, selectedBill]);

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Billing & Payments"
					statusCard={{
						label: 'Monthly Total',
						value: `Rs. ${monthlyTotal.toFixed(2)}`,
						subtitle: 'Completed payments this month',
					}}
				/>

				<div className="border-t border-slate-200" />

				{/* Billing Cycle Management */}
				<section className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">Billing Cycle Management</h3>
							<p className="text-sm text-slate-600">
								Current Cycle:{' '}
								<span className="font-medium">
									{getMonthName(currentCycle.month)} {currentCycle.year}
								</span>{' '}
								({currentCycle.startDate} to {currentCycle.endDate})
							</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleSendBillingNotifications}
								disabled={sendingNotifications}
								className="inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-amber-500 focus-visible:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<i
									className={`fas ${sendingNotifications ? 'fa-spinner fa-spin' : 'fa-bell'} mr-2 text-sm`}
									aria-hidden="true"
								/>
								{sendingNotifications ? 'Sending...' : 'Send Notifications'}
							</button>
							<button
								type="button"
								onClick={handleMonthlyReset}
								disabled={resettingCycle}
								className="inline-flex items-center rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-purple-500 focus-visible:bg-purple-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<i
									className={`fas ${
										resettingCycle ? 'fa-spinner fa-spin' : 'fa-sync-alt'
									} mr-2 text-sm`}
									aria-hidden="true"
								/>
								{resettingCycle ? 'Resetting...' : 'Reset Monthly Cycle'}
							</button>
						</div>
					</div>
					{billingCycles.length > 0 && (
						<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
							<p className="mb-2 text-sm font-medium text-slate-700">Recent Billing Cycles:</p>
							<div className="flex flex-wrap gap-2">
								{billingCycles
									.slice(-6)
									.reverse()
									.map(cycle => (
										<span
											key={cycle.id}
											className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
												cycle.status === 'active'
													? 'bg-emerald-100 text-emerald-800'
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
					<div className="mb-4 flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">Cycle Reports</h3>
							<p className="text-sm text-slate-600">
								Summary of pending and collections within a selected billing cycle.
							</p>
						</div>
						<div className="flex items-center gap-3">
							<label htmlFor="cycleSelect" className="text-sm font-medium text-slate-700">
								Select Cycle:
							</label>
							<select
								id="cycleSelect"
								value={selectedCycleId}
								onChange={e => setSelectedCycleId(e.target.value)}
								className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="current">
									Current ({getMonthName(currentCycle.month)} {currentCycle.year})
								</option>
								{billingCycles
									.sort((a, b) => {
										if (a.year !== b.year) return b.year - a.year;
										return b.month - a.month;
									})
									.map(cycle => (
										<option key={cycle.id} value={cycle.id}>
											{getMonthName(cycle.month)} {cycle.year}
										</option>
									))}
							</select>
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
							<div className="text-sm font-medium text-amber-700">PENDING (IN CYCLE)</div>
							<div className="mt-2 text-2xl font-bold text-amber-900">{cycleSummary.pending}</div>
						</div>
						<div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
							<div className="text-sm font-medium text-blue-700">BILLS COMPLETED (IN CYCLE)</div>
							<div className="mt-2 text-2xl font-bold text-blue-900">{cycleSummary.completed}</div>
						</div>
						<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
							<div className="text-sm font-medium text-emerald-700">COLLECTIONS (IN CYCLE)</div>
							<div className="mt-2 text-2xl font-bold text-emerald-900">
								Rs. {cycleSummary.collections.toFixed(2)}
							</div>
						</div>
					</div>
				</section>

				<section className="section-card">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<label htmlFor="billingFilter" className="block text-sm font-medium text-slate-700">
								Show records from:
							</label>
							<select
								id="billingFilter"
								value={filterRange}
								onChange={e => setFilterRange(e.target.value)}
								className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="15">Last 15 days</option>
								<option value="30">Last 1 month</option>
								<option value="90">Last 3 months</option>
								<option value="180">Last 6 months</option>
								<option value="all">All time</option>
							</select>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => handleExportBilling('csv')}
								className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
							>
								<i className="fas fa-file-csv mr-2 text-sm" aria-hidden="true" />
								Export CSV
							</button>
							<button
								type="button"
								onClick={() => handleExportBilling('excel')}
								className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-500 focus-visible:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
							>
								<i className="fas fa-file-excel mr-2 text-sm" aria-hidden="true" />
								Export Excel
							</button>
						</div>
					</div>
				</section>

				{loading ? (
					<section className="section-card mx-auto mt-8 max-w-6xl">
						<div className="py-12 text-center text-sm text-slate-500">
							<div className="loading-spinner" aria-hidden="true" />
							<span className="ml-3 align-middle">Loading billing records...</span>
						</div>
					</section>
				) : (
					<>
						<section className="section-card mx-auto mt-8 flex max-w-6xl flex-col gap-6">
							{/* Pending Payments */}
							<div className="rounded-2xl border border-amber-200 bg-white shadow-sm flex flex-col" style={{ maxHeight: '500px' }}>
								<div className="border-b border-amber-200 bg-amber-50 px-6 py-4 flex-shrink-0">
									<div className="flex items-center justify-between mb-3">
										<h2 className="text-lg font-semibold text-slate-900">
											Pending Payments{' '}
											<span className="ml-2 rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-semibold text-white">
												{pending.length}
											</span>
										</h2>
									</div>
									<div className="relative">
										<input
											type="text"
											placeholder="Search by Bill ID, Patient, Patient ID, Doctor, Amount, or Date..."
											value={pendingSearchQuery}
											onChange={(e) => setPendingSearchQuery(e.target.value)}
											className="w-full rounded-lg border border-amber-300 bg-white px-4 py-2 pl-10 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
										/>
										<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
									</div>
								</div>
								<div className="overflow-y-auto overflow-x-auto flex-1">
									{filteredPending.length === 0 ? (
										<div className="p-6">
											<p className="py-8 text-center text-sm text-slate-500">
												{pendingSearchQuery.trim() ? 'No pending payments match your search.' : 'No pending payments.'}
											</p>
										</div>
									) : (
										<table className="min-w-full divide-y divide-slate-200 text-left text-sm m-6">
											<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 sticky top-0 z-10">
												<tr>
														<th className="px-3 py-2 font-semibold bg-slate-50">Bill ID</th>
														<th className="px-3 py-2 font-semibold bg-slate-50">Patient</th>
														<th className="px-3 py-2 font-semibold bg-slate-50">Amount</th>
														<th className="px-3 py-2 font-semibold bg-slate-50">Date</th>
														<th className="px-3 py-2 text-right font-semibold bg-slate-50">
															Action
														</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-slate-100">
													{filteredPending.map(bill => {
														const patientType = patients.find(p => p.patientId === bill.patientId)?.patientType;
														const isDyes = (patientType || '').toUpperCase() === 'DYES';
														const isReferral = (patientType || '').toUpperCase() === 'REFERRAL';
														const payLabel = isDyes ? 'Bill' : 'Pay';
														return (
															<tr key={bill.billingId}>
															<td className="px-3 py-3 text-sm font-medium text-slate-800">
																{bill.billingId}
															</td>
															<td className="px-3 py-3 text-sm text-slate-600">
																{bill.patient}
															</td>
															<td className="px-3 py-3 text-sm font-semibold text-slate-900">
																{isReferral ? 'N/A' : `Rs. ${bill.amount}`}
															</td>
															<td className="px-3 py-3 text-sm text-slate-600">
																{bill.date}
															</td>
															<td className="px-3 py-3">
																<div className="flex items-center justify-end gap-2">
																	{isDyes && (
																		<button
																			type="button"
																			onClick={() => handleShowInvoicePreview(bill)}
																			className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
																		>
																			Invoice
																		</button>
																	)}
																	<button
																		type="button"
																		onClick={() => handlePay(bill)}
																		className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
																	>
																		{payLabel}
																	</button>
																	<button
																		type="button"
																		onClick={() => handleDeleteBilling(bill)}
																		className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-600 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
																		title="Delete billing record"
																	>
																		<i className="fas fa-trash text-xs" aria-hidden="true" />
																	</button>
																</div>
															</td>
															</tr>
														);
													})}
												</tbody>
											</table>
									)}
								</div>
							</div>

							{/* Completed Payments */}
							<div className="rounded-2xl border border-emerald-200 bg-white shadow-sm flex flex-col" style={{ maxHeight: '500px' }}>
								<div className="border-b border-emerald-200 bg-emerald-50 px-6 py-4 flex-shrink-0">
									<div className="flex items-center justify-between mb-3">
										<h2 className="text-lg font-semibold text-slate-900">
											Completed Payments{' '}
											<span className="ml-2 rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
												{completed.length}
											</span>
										</h2>
										<button
											type="button"
											onClick={() => setShowImportModal(true)}
											className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-emerald-700 hover:via-emerald-800 hover:to-teal-700 transition-all duration-200 hover:scale-105"
										>
											<i className="fas fa-file-excel text-xs" aria-hidden="true" />
											Import Excel
										</button>
									</div>
									<div className="relative">
										<input
											type="text"
											placeholder="Search by Bill ID, Patient, Patient ID, Doctor, Amount, Date, or Payment Mode..."
											value={completedSearchQuery}
											onChange={(e) => setCompletedSearchQuery(e.target.value)}
											className="w-full rounded-lg border border-emerald-300 bg-white px-4 py-2 pl-10 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
										/>
										<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
									</div>
								</div>
								<div className="overflow-y-auto overflow-x-auto flex-1">
									{filteredCompleted.length === 0 ? (
										<div className="p-6">
											<p className="py-8 text-center text-sm text-slate-500">
												{completedSearchQuery.trim() ? 'No completed payments match your search.' : 'No completed payments.'}
											</p>
										</div>
									) : (
										<table className="min-w-full divide-y divide-slate-200 text-left text-sm m-6">
											<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 sticky top-0 z-10">
												<tr>
													<th className="px-3 py-2 font-semibold bg-slate-50">Bill ID</th>
													<th className="px-3 py-2 font-semibold bg-slate-50">Patient</th>
													<th className="px-3 py-2 font-semibold bg-slate-50">Amount</th>
													<th className="px-3 py-2 font-semibold bg-slate-50">Paid By</th>
													<th className="px-3 py-2 font-semibold bg-slate-50">Actions</th>
												</tr>
											</thead>
												<tbody className="divide-y divide-slate-100">
													{filteredCompleted.map(bill => {
														const patientType = patients.find(p => p.patientId === bill.patientId)?.patientType;
														const isReferral = (patientType || '').toUpperCase() === 'REFERRAL';
														return (
														<tr key={bill.billingId}>
															<td className="px-3 py-3 text-sm font-medium text-slate-800">
																{bill.billingId}
															</td>
															<td className="px-3 py-3 text-sm text-slate-600">
																{bill.patient}
															</td>
															<td className="px-3 py-3 text-sm font-semibold text-slate-900">
																{isReferral ? 'N/A' : `Rs. ${bill.amount}`}
															</td>
															<td className="px-3 py-3 text-sm text-slate-600">
																{bill.paymentMode || '--'}
															</td>
															<td className="px-3 py-3">
																<div className="flex items-center justify-end gap-2">
																	<button
																		type="button"
																		onClick={() =>
																			handleViewPaymentSlip(bill)
																		}
																		className="inline-flex items-center rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
																	>
																		Receipt
																	</button>
																	<button
																		type="button"
																		onClick={() => handleShowInvoicePreview(bill)}
																		className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
																	>
																		Invoice
																	</button>
																	<button
																		type="button"
																		onClick={() => handleDeleteBilling(bill)}
																		className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-600 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
																		title="Delete billing record"
																	>
																		<i className="fas fa-trash text-xs" aria-hidden="true" />
																	</button>
																</div>
															</td>
														</tr>
														);
													})}
												</tbody>
											</table>
									)}
								</div>
							</div>
						</section>
					</>
				)}

				{/* Payment Modal */}
				{showPayModal && selectedBill && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">
									Mark Payment for {selectedBill.patient}
								</h2>
								<button
									type="button"
									onClick={() => setShowPayModal(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="px-6 py-6">
								<div className="space-y-3 text-sm">
									<div>
										<span className="font-semibold text-slate-700">Billing ID:</span>{' '}
										<span className="text-slate-600">{selectedBill.billingId}</span>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">Amount</label>
										{(() => {
											const patient = patients.find(p => p.patientId === selectedBill.patientId);
											const isReferral = (patient?.patientType || '').toUpperCase() === 'REFERRAL';
											return (
												<div className="relative">
													{!isReferral && (
														<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
															Rs.
														</span>
													)}
													<input
														type={isReferral ? 'text' : 'number'}
														min={isReferral ? undefined : '0'}
														step={isReferral ? undefined : '0.01'}
														value={paymentAmount}
														onChange={e => {
															if (!isReferral) {
																setPaymentAmount(parseFloat(e.target.value) || 0);
															}
														}}
														disabled={isReferral}
														readOnly={isReferral}
														className={`w-full rounded-lg border border-slate-300 ${isReferral ? 'px-3' : 'pl-12 pr-3'} py-2 text-sm ${isReferral ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'text-slate-800'} transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200`}
														placeholder={isReferral ? 'N/A' : 'Enter amount'}
													/>
												</div>
											);
										})()}
									</div>
									<div>
										<span className="font-semibold text-slate-700">Date:</span>{' '}
										<span className="text-slate-600">{selectedBill.date}</span>
									</div>
									<div className="pt-3">
										<label className="block text-sm font-medium text-slate-700">
											Mode of Payment
										</label>
										<div className="mt-2 space-y-2">
											<label className="flex items-center">
												<input
													type="radio"
													name="paymode"
													value="Cash"
													checked={paymentMode === 'Cash'}
													onChange={() => setPaymentMode('Cash')}
													className="mr-2"
												/>
												<span className="text-sm text-slate-700">Cash</span>
											</label>
											<label className="flex items-center">
												<input
													type="radio"
													name="paymode"
													value="UPI/Card"
													checked={paymentMode === 'UPI/Card'}
													onChange={() => setPaymentMode('UPI/Card')}
													className="mr-2"
												/>
												<span className="text-sm text-slate-700">Card / UPI</span>
											</label>
										</div>
										{paymentMode === 'UPI/Card' && (
											<input
												type="text"
												value={utr}
												onChange={e => setUtr(e.target.value)}
												placeholder="Txn ID / UTR Number"
												className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											/>
										)}
									</div>
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => setShowPayModal(false)}
									className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleSubmitPayment}
									className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
								>
									Submit Payment
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Invoice Preview Modal */}
				{showInvoicePreview && editableInvoice && selectedBill && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6 overflow-y-auto">
						<div className="w-full max-w-7xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-8 flex flex-col max-h-[90vh]">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
								<h2 className="text-lg font-semibold text-slate-900">Invoice Preview & Edit</h2>
								<button
									type="button"
									onClick={() => {
										setShowInvoicePreview(false);
										setEditableInvoice(null);
										setSelectedBill(null);
									}}
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
												key={previewHtml} // Force re-render when HTML changes
												className="w-full h-full border-0"
												style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%', height: '125%' }}
											/>
										</div>
									</div>
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setShowInvoicePreview(false);
										setEditableInvoice(null);
										setSelectedBill(null);
									}}
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

				{/* Payment Slip Modal */}
				{showPaymentSlipModal && selectedBill && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">
									Payment Receipt / Acknowledgement
								</h2>
								<div className="flex items-center gap-2">
									{!isEditingReceipt ? (
										<button
											type="button"
											onClick={() => setIsEditingReceipt(true)}
											className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
										>
											<i className="fas fa-edit text-xs" aria-hidden="true" />
											Edit Receipt
										</button>
									) : (
										<button
											type="button"
											onClick={() => {
												setIsEditingReceipt(false);
												// Reset to original values
												if (selectedBill) {
													setEditableReceiptData({
														amount: selectedBill.amount,
														date: selectedBill.date,
														paymentMode: selectedBill.paymentMode || 'Cash',
														utr: selectedBill.utr || '',
														patient: selectedBill.patient,
														patientId: selectedBill.patientId,
														doctor: selectedBill.doctor,
														appointmentId: selectedBill.appointmentId,
													});
												}
											}}
											className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
										>
											Cancel
										</button>
									)}
									<button
										type="button"
										onClick={() => {
											setShowPaymentSlipModal(false);
											setIsEditingReceipt(false);
											setEditableReceiptData(null);
										}}
										className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
										aria-label="Close"
									>
										<i className="fas fa-times" aria-hidden="true" />
									</button>
								</div>
							</header>
							<div className="px-6 py-6">
								<div
									id="paymentSlipCard"
									className="bg-white border border-gray-800 p-6"
									style={{ width: '800px', maxWidth: '100%' }}
								>
									<div className="flex justify-between items-start mb-4">
										<div className="flex items-start gap-4">
											<img
												src="/CenterSportsScience_logo.jpg"
												alt="Company Logo"
												className="w-24 h-auto"
											/>
											<div>
												<h2 className="text-xl font-bold uppercase mb-1 text-black">
													Centre For Sports Science
												</h2>
												<p className="text-xs text-black mb-0.5">
													Sports & Business Solutions Pvt. Ltd.
												</p>
												<p className="text-xs text-black">
													Sri Kanteerava Outdoor Stadium · Bangalore · +91 97311 28396
												</p>
											</div>
										</div>
										<div className="text-right">
											<h2 className="text-lg font-bold uppercase mb-1 text-black">Receipt</h2>
											<p className="text-xs font-bold text-black">
												Receipt No: {selectedBill.billingId}
											</p>
											{isEditingReceipt && editableReceiptData ? (
												<input
													type="date"
													value={editableReceiptData.date}
													onChange={e => setEditableReceiptData({ ...editableReceiptData, date: e.target.value })}
													className="text-xs font-bold text-black border border-gray-300 px-2 py-1 rounded mt-1"
												/>
											) : (
												<p className="text-xs font-bold text-black">Date: {editableReceiptData?.date || selectedBill.date}</p>
											)}
										</div>
									</div>
									<hr className="border-t border-black my-4" />
									<div className="flex justify-between mb-4">
										<div>
											<div className="text-sm text-black">Received from:</div>
											{isEditingReceipt && editableReceiptData ? (
												<>
													<input
														type="text"
														value={editableReceiptData.patient}
														onChange={e => setEditableReceiptData({ ...editableReceiptData, patient: e.target.value })}
														className="text-lg font-bold text-black border border-gray-300 px-2 py-1 rounded mt-1 w-full max-w-xs"
													/>
													<input
														type="text"
														value={editableReceiptData.patientId}
														onChange={e => setEditableReceiptData({ ...editableReceiptData, patientId: e.target.value })}
														placeholder="Patient ID"
														className="text-xs text-black border border-gray-300 px-2 py-1 rounded mt-1 w-full max-w-xs"
													/>
												</>
											) : (
												<>
													<div className="text-lg font-bold mt-1 text-black">{editableReceiptData?.patient || selectedBill.patient}</div>
													<div className="text-xs text-black mt-1">
														ID: {editableReceiptData?.patientId || selectedBill.patientId}
													</div>
												</>
											)}
										</div>
										<div className="text-right">
											<div className="text-xs text-black">Amount</div>
											{isEditingReceipt && editableReceiptData ? (
												<input
													type="number"
													step="0.01"
													min="0"
													value={editableReceiptData.amount}
													onChange={e => setEditableReceiptData({ ...editableReceiptData, amount: parseFloat(e.target.value) || 0 })}
													className="text-2xl font-bold text-black border border-gray-300 px-2 py-1 rounded mt-1 w-32 text-right"
												/>
											) : (
												<div className="text-2xl font-bold mt-1 text-black">
													Rs. {(editableReceiptData?.amount || selectedBill.amount).toFixed(2)}
												</div>
											)}
										</div>
									</div>
									<div className="text-sm font-bold mb-5 text-black">
										Amount in words:{' '}
										<span className="font-normal text-black">
											{numberToWords(editableReceiptData?.amount || selectedBill.amount)}
										</span>
									</div>
									<div
										className="border border-black p-4 relative"
										style={{ height: '120px' }}
									>
										<div className="font-bold mb-2 text-black">For</div>
										{isEditingReceipt && editableReceiptData ? (
											<div className="text-sm text-black space-y-2">
												<input
													type="text"
													value={editableReceiptData.appointmentId || ''}
													onChange={e => setEditableReceiptData({ ...editableReceiptData, appointmentId: e.target.value })}
													placeholder="Appointment ID"
													className="w-full border border-gray-300 px-2 py-1 rounded"
												/>
												<input
													type="text"
													value={editableReceiptData.doctor || ''}
													onChange={e => setEditableReceiptData({ ...editableReceiptData, doctor: e.target.value })}
													placeholder="Doctor Name"
													className="w-full border border-gray-300 px-2 py-1 rounded"
												/>
												<div className="flex items-center gap-2">
													<label className="text-sm">Payment Mode:</label>
													<select
														value={editableReceiptData.paymentMode}
														onChange={e => setEditableReceiptData({ ...editableReceiptData, paymentMode: e.target.value })}
														className="border border-gray-300 px-2 py-1 rounded text-sm"
													>
														<option value="Cash">Cash</option>
														<option value="UPI/Card">UPI/Card</option>
													</select>
												</div>
												{editableReceiptData.paymentMode === 'UPI/Card' && (
													<input
														type="text"
														value={editableReceiptData.utr}
														onChange={e => setEditableReceiptData({ ...editableReceiptData, utr: e.target.value })}
														placeholder="Txn ID / UTR Number"
														className="w-full border border-gray-300 px-2 py-1 rounded"
													/>
												)}
											</div>
										) : (
											<div className="text-sm text-black">
												{editableReceiptData?.appointmentId || selectedBill.appointmentId || ''}
												{(editableReceiptData?.doctor || selectedBill.doctor) && (
													<>
														<br />
														Doctor: {editableReceiptData?.doctor || selectedBill.doctor}
													</>
												)}
												<br />
												Payment Mode: {editableReceiptData?.paymentMode || selectedBill.paymentMode || 'Cash'}
												{(editableReceiptData?.utr || selectedBill.utr) && (
													<>
														<br />
														UTR: {editableReceiptData?.utr || selectedBill.utr}
													</>
												)}
											</div>
										)}
										<div className="absolute bottom-3 left-0 right-0 text-center text-xs font-bold text-black">
											Digitally Signed
										</div>
									</div>
									<div className="flex justify-between mt-4 text-xs text-black">
										<div>Computer generated receipt.</div>
										<div className="uppercase">For Centre For Sports Science</div>
									</div>
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								{isEditingReceipt ? (
									<>
										<button
											type="button"
											onClick={handleSaveReceipt}
											className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
										>
											<i className="fas fa-save text-xs" aria-hidden="true" />
											Save Changes
										</button>
										<button
											type="button"
											onClick={() => {
												setIsEditingReceipt(false);
												if (selectedBill) {
													setEditableReceiptData({
														amount: selectedBill.amount,
														date: selectedBill.date,
														paymentMode: selectedBill.paymentMode || 'Cash',
														utr: selectedBill.utr || '',
														patient: selectedBill.patient,
														patientId: selectedBill.patientId,
														doctor: selectedBill.doctor,
														appointmentId: selectedBill.appointmentId,
													});
												}
											}}
											className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
										>
											Cancel
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											onClick={handlePrintPaymentSlip}
											className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:outline-none"
										>
											Download / Print
										</button>
										<button
											type="button"
											onClick={() => {
												setShowPaymentSlipModal(false);
												setIsEditingReceipt(false);
												setEditableReceiptData(null);
											}}
											className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
										>
											Close
										</button>
									</>
								)}
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
											id="excel-file-input"
										/>
										<label
											htmlFor="excel-file-input"
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
