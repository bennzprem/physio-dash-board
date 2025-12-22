import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getEmailSubject, generateEmailBody, type EmailData } from '@/lib/email';

export async function POST(request: NextRequest) {
	try {
		const emailData: EmailData = await request.json();

		// Validate required fields
		if (!emailData.to || !emailData.template) {
			return NextResponse.json(
				{ error: 'Missing required fields: to, template' },
				{ status: 400 }
			);
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(emailData.to)) {
			return NextResponse.json(
				{ error: 'Invalid email address' },
				{ status: 400 }
			);
		}

		// Check if Resend API key is configured
		if (!process.env.RESEND_API_KEY) {
			console.warn('RESEND_API_KEY not configured. Email will not be sent.');
			// In development, return success but log the email
			if (process.env.NODE_ENV === 'development') {
				console.log('Email would be sent:', {
					to: emailData.to,
					subject: emailData.subject || getEmailSubject(emailData.template, emailData.data),
					template: emailData.template,
				});
				return NextResponse.json({ success: true, message: 'Email logged (development mode)' });
			}
			return NextResponse.json(
				{ error: 'Email service not configured' },
				{ status: 500 }
			);
		}

		// Initialize Resend only when API key is available
		const resend = new Resend(process.env.RESEND_API_KEY);

		// Generate subject and body
		const subject = emailData.subject || getEmailSubject(emailData.template, emailData.data);
		const html = generateEmailBody(emailData.template, emailData.data);

		// Get sender email from environment or use default
		const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
		const fromName = process.env.RESEND_FROM_NAME || 'Centre For Sports Science';

		// Send email via Resend
		try {
			const result = await resend.emails.send({
				from: `${fromName} <${fromEmail}>`,
				to: emailData.to,
				subject,
				html,
			});

			if (result.error) {
				console.error('Resend API error:', result.error);
				const errorMessage = result.error.message || JSON.stringify(result.error) || 'Failed to send email';
				return NextResponse.json(
					{ error: errorMessage },
					{ status: 500 }
				);
			}

			return NextResponse.json({ 
				success: true, 
				messageId: result.data?.id 
			});
		} catch (resendError) {
			console.error('Resend send error:', resendError);
			const errorMessage = resendError instanceof Error 
				? resendError.message 
				: typeof resendError === 'string' 
					? resendError 
					: 'Failed to send email via Resend API';
			return NextResponse.json(
				{ error: errorMessage },
				{ status: 500 }
			);
		}
	} catch (error) {
		console.error('Email API error:', error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
}

