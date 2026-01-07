export type EmailTemplate = 
	| 'appointment-created'
	| 'appointment-reminder'
	| 'appointment-cancelled'
	| 'appointment-updated'
	| 'patient-registered'
	| 'appointment-status-changed'
	| 'billing-pending'
	| 'session-balance'
	| 'password-reset'
	| 'rating-submitted';

export interface EmailData {
	to: string;
	subject?: string;
	template: EmailTemplate;
	data: Record<string, unknown>;
}

export interface AppointmentEmailData {
	patientName: string;
	patientEmail: string;
	patientId?: string;
	doctor: string;
	date: string;
	time: string;
	appointmentId?: string;
	notes?: string;
}

export interface PatientRegistrationEmailData {
	patientName: string;
	patientEmail: string;
	patientId: string;
}

/**
 * Generate email subject based on template
 */
export function getEmailSubject(template: EmailTemplate, data: Record<string, unknown>): string {
	switch (template) {
		case 'appointment-created':
			return `Appointment Confirmed - ${data.date as string} at ${data.time as string}`;
		case 'appointment-reminder':
			return `Appointment Reminder - Tomorrow at ${data.time as string}`;
		case 'appointment-cancelled':
			return `Appointment Cancelled - ${data.date as string}`;
		case 'appointment-updated':
			return `Appointment Updated - ${data.date as string} at ${data.time as string}`;
		case 'appointment-status-changed':
			return `Appointment Status Update - ${data.status as string}`;
		case 'patient-registered':
			return `Welcome to Centre For Sports Science - Patient ID: ${data.patientId as string}`;
		case 'billing-pending':
			return `Pending Payment Reminder - ${data.amount as string}`;
		case 'session-balance': {
			const name = (data.recipientName as string) || (data.patientName as string) || 'Patient';
			return `Session Balance Update - ${name}`;
		}
		case 'password-reset':
			return 'Reset Your Password - Centre For Sports Science';
		case 'rating-submitted':
			return `New Performance Rating Submitted - ${data.ratedStaffName as string}`;
		default:
			return 'Notification from Centre For Sports Science';
	}
}

/**
 * Generate HTML email body based on template
 */
export function generateEmailBody(template: EmailTemplate, data: Record<string, unknown>): string {
	const clinicName = 'Centre For Sports Science';
	const clinicEmail = process.env.NEXT_PUBLIC_CLINIC_EMAIL || 'info@centersportsscience.com';
	const clinicPhone = process.env.NEXT_PUBLIC_CLINIC_PHONE || '';

	const baseStyles = `
		<style>
			body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #334155; }
			.container { max-width: 600px; margin: 0 auto; padding: 20px; }
			.header { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
			.content { background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
			.footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none; }
			.button { display: inline-block; padding: 12px 24px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
			.info-box { background: #f1f5f9; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0; border-radius: 4px; }
			.detail-row { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
			.detail-label { font-weight: 600; color: #475569; }
		</style>
	`;

	switch (template) {
		case 'appointment-created': {
			const appointmentData = data as unknown as AppointmentEmailData;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Appointment Confirmed</h1>
						</div>
						<div class="content">
							<p>Dear ${appointmentData.patientName},</p>
							<p>Your appointment has been successfully scheduled with ${clinicName}.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Date:</span> ${appointmentData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Time:</span> ${appointmentData.time}
								</div>
								<div class="detail-row">
									<span class="detail-label">Clinician:</span> ${appointmentData.doctor}
								</div>
								${appointmentData.patientId ? `<div class="detail-row"><span class="detail-label">Patient ID:</span> ${appointmentData.patientId}</div>` : ''}
								${appointmentData.appointmentId ? `<div class="detail-row"><span class="detail-label">Appointment ID:</span> ${appointmentData.appointmentId}</div>` : ''}
							</div>
							
							${appointmentData.notes ? `<p><strong>Notes:</strong> ${appointmentData.notes}</p>` : ''}
							
							<p>Please arrive 10 minutes before your scheduled time. If you need to reschedule or cancel, please contact us at least 24 hours in advance.</p>
							
							<p>We look forward to seeing you!</p>
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'appointment-reminder': {
			const appointmentData = data as unknown as AppointmentEmailData;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Appointment Reminder</h1>
						</div>
						<div class="content">
							<p>Dear ${appointmentData.patientName},</p>
							<p>This is a friendly reminder that you have an appointment scheduled for <strong>tomorrow</strong>.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Date:</span> ${appointmentData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Time:</span> ${appointmentData.time}
								</div>
								<div class="detail-row">
									<span class="detail-label">Clinician:</span> ${appointmentData.doctor}
								</div>
							</div>
							
							<p>Please arrive 10 minutes before your scheduled time. If you need to reschedule or cancel, please contact us as soon as possible.</p>
							
							<p>We look forward to seeing you!</p>
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'appointment-cancelled': {
			const appointmentData = data as unknown as AppointmentEmailData;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
							<h1 style="margin: 0; font-size: 24px;">Appointment Cancelled</h1>
						</div>
						<div class="content">
							<p>Dear ${appointmentData.patientName},</p>
							<p>Your appointment has been cancelled.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Date:</span> ${appointmentData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Time:</span> ${appointmentData.time}
								</div>
								<div class="detail-row">
									<span class="detail-label">Clinician:</span> ${appointmentData.doctor}
								</div>
							</div>
							
							<p>If you would like to reschedule, please contact us at your earliest convenience.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'appointment-updated': {
			const appointmentData = data as unknown as AppointmentEmailData;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Appointment Updated</h1>
						</div>
						<div class="content">
							<p>Dear ${appointmentData.patientName},</p>
							<p>Your appointment details have been updated.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Date:</span> ${appointmentData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Time:</span> ${appointmentData.time}
								</div>
								<div class="detail-row">
									<span class="detail-label">Clinician:</span> ${appointmentData.doctor}
								</div>
							</div>
							
							${appointmentData.notes ? `<p><strong>Notes:</strong> ${appointmentData.notes}</p>` : ''}
							
							<p>Please note the updated details above. If you have any questions, please contact us.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'appointment-status-changed': {
			const appointmentData = data as unknown as AppointmentEmailData & { status: string };
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Appointment Status Update</h1>
						</div>
						<div class="content">
							<p>Dear ${appointmentData.patientName},</p>
							<p>Your appointment status has been updated to: <strong>${appointmentData.status}</strong></p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Date:</span> ${appointmentData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Time:</span> ${appointmentData.time}
								</div>
								<div class="detail-row">
									<span class="detail-label">Clinician:</span> ${appointmentData.doctor}
								</div>
								<div class="detail-row">
									<span class="detail-label">Status:</span> ${appointmentData.status}
								</div>
							</div>
							
							<p>If you have any questions about this update, please contact us.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'patient-registered': {
			const registrationData = data as unknown as PatientRegistrationEmailData;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Welcome to ${clinicName}</h1>
						</div>
						<div class="content">
							<p>Dear ${registrationData.patientName},</p>
							<p>Thank you for registering with ${clinicName}. We're excited to have you as part of our patient community.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Patient ID:</span> ${registrationData.patientId}
								</div>
							</div>
							
							<p><strong>Please save your Patient ID</strong> - you'll need it for future appointments and when contacting our office.</p>
							
							<p>Our team is here to support your health and wellness journey. If you have any questions or would like to schedule an appointment, please don't hesitate to contact us.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'billing-pending': {
			const billingData = data as unknown as {
				patientName: string;
				patientEmail: string;
				patientId?: string;
				billingId?: string;
				amount: string | number;
				date: string;
				appointmentId?: string;
			};
			const amount = typeof billingData.amount === 'number' 
				? `₹${billingData.amount.toFixed(2)}` 
				: billingData.amount;
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Payment Reminder</h1>
						</div>
						<div class="content">
							<p>Dear ${billingData.patientName},</p>
							<p>This is a friendly reminder that you have a pending payment for services received at ${clinicName}.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Billing ID:</span> ${billingData.billingId || 'N/A'}
								</div>
								${billingData.appointmentId ? `
								<div class="detail-row">
									<span class="detail-label">Appointment ID:</span> ${billingData.appointmentId}
								</div>
								` : ''}
								<div class="detail-row">
									<span class="detail-label">Service Date:</span> ${billingData.date}
								</div>
								<div class="detail-row">
									<span class="detail-label">Amount Due:</span> <strong style="color: #dc2626; font-size: 18px;">${amount}</strong>
								</div>
							</div>
							
							<p>Please settle this payment at your earliest convenience. You can make the payment:</p>
							<ul style="margin: 15px 0; padding-left: 20px;">
								<li>In person at our clinic</li>
								<li>Via UPI/Card payment</li>
								<li>By contacting our billing department</li>
							</ul>
							
							${clinicPhone ? `<p>If you have any questions about this invoice, please contact us at ${clinicPhone}.</p>` : ''}
							
							<p>Thank you for your prompt attention to this matter.</p>
							
							<p>Best regards,<br>The ${clinicName} Billing Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'session-balance': {
			const sessionData = data as unknown as {
				recipientName?: string;
				recipientType?: 'patient' | 'therapist' | string;
				patientName: string;
				patientEmail: string;
				patientId?: string;
				appointmentDate?: string;
				appointmentTime?: string;
				freeSessionsRemaining: number;
				pendingPaidSessions: number;
				pendingChargeAmount?: number;
			};

			const recipientName = sessionData.recipientName || sessionData.patientName;
			const isTherapist = sessionData.recipientType === 'therapist';
			const pendingAmount =
				typeof sessionData.pendingChargeAmount === 'number'
					? `₹${sessionData.pendingChargeAmount.toFixed(2)}`
					: sessionData.pendingChargeAmount || '—';

			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Session Balance Update</h1>
						</div>
						<div class="content">
							<p>Dear ${recipientName},</p>
							<p>
								${isTherapist ? `Patient <strong>${sessionData.patientName}</strong> has exceeded their annual DYES session allowance.` : 'Here is your updated session balance for the DYES annual allocation.'}
							</p>
							
							<div class="info-box">
								${sessionData.patientId ? `<div class="detail-row"><span class="detail-label">Patient ID:</span> ${sessionData.patientId}</div>` : ''}
								${sessionData.appointmentDate ? `<div class="detail-row"><span class="detail-label">Latest Session:</span> ${sessionData.appointmentDate}${sessionData.appointmentTime ? ` at ${sessionData.appointmentTime}` : ''}</div>` : ''}
								<div class="detail-row"><span class="detail-label">Free Sessions Remaining:</span> ${sessionData.freeSessionsRemaining}</div>
								<div class="detail-row"><span class="detail-label">Pending Sessions to Bill:</span> ${sessionData.pendingPaidSessions}</div>
								<div class="detail-row"><span class="detail-label">Pending Amount:</span> ${pendingAmount}</div>
							</div>

							<p>The annual allotment provides 500 complimentary sessions for DYES. The balance resets automatically on January 1 every year.</p>
							
							<p>Please coordinate with the billing desk to settle any pending sessions.</p>

							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'password-reset': {
			const resetData = data as unknown as {
				userName?: string;
				userEmail: string;
				resetLink: string;
			};
			const userName = resetData.userName || 'User';
			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1 style="margin: 0; font-size: 24px;">Reset Your Password</h1>
						</div>
						<div class="content">
							<p>Dear ${userName},</p>
							<p>We received a request to reset your password for your ${clinicName} account.</p>
							
							<div class="info-box" style="text-align: center; padding: 20px;">
								<p style="margin: 0 0 15px 0;">Click the button below to reset your password:</p>
								<a href="${resetData.resetLink}" class="button" style="text-decoration: none; display: inline-block; padding: 12px 24px; background: #0ea5e9; color: white; border-radius: 6px; margin: 10px 0;">
									Reset Password
								</a>
								<p style="margin: 15px 0 0 0; font-size: 12px; color: #64748b;">
									Or copy and paste this link into your browser:<br>
									<a href="${resetData.resetLink}" style="color: #0ea5e9; word-break: break-all;">${resetData.resetLink}</a>
								</p>
							</div>
							
							<p><strong>This link will expire in 1 hour.</strong></p>
							
							<p>If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
							
							<p>For security reasons, if you continue to receive these emails, please contact our support team.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		case 'rating-submitted': {
			const ratedStaffName = (data.ratedStaffName as string) || 'Staff Member';
			const ratedStaffEmail = (data.ratedStaffEmail as string) || '';
			const raterName = (data.raterName as string) || 'Unknown';
			const raterEmail = (data.raterEmail as string) || '';
			const rating = (data.rating as number) || 0;
			const criteria = (data.criteria as string) || '';
			const comments = (data.comments as string) || '';

			return `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					${baseStyles}
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1>New Performance Rating Submitted</h1>
						</div>
						<div class="content">
							<p>Dear Admin,</p>
							
							<p>A new performance rating has been submitted and is pending your approval.</p>
							
							<div class="info-box">
								<div class="detail-row">
									<span class="detail-label">Rated Staff:</span> ${ratedStaffName}${ratedStaffEmail ? ` (${ratedStaffEmail})` : ''}
								</div>
								<div class="detail-row">
									<span class="detail-label">Rated By:</span> ${raterName}${raterEmail ? ` (${raterEmail})` : ''}
								</div>
								<div class="detail-row">
									<span class="detail-label">Rating:</span> ${rating} Star${rating > 1 ? 's' : ''}
								</div>
								<div class="detail-row">
									<span class="detail-label">Criteria:</span> ${criteria}
								</div>
								${comments ? `
								<div class="detail-row">
									<span class="detail-label">Comments:</span> ${comments}
								</div>
								` : ''}
							</div>
							
							<p>Please review and approve or reject this rating in the admin panel.</p>
							
							<p>Best regards,<br>The ${clinicName} Team</p>
						</div>
						<div class="footer">
							<p><strong>${clinicName}</strong></p>
							${clinicEmail ? `<p>Email: ${clinicEmail}</p>` : ''}
							${clinicPhone ? `<p>Phone: ${clinicPhone}</p>` : ''}
						</div>
					</div>
				</body>
				</html>
			`;
		}

		default:
			return '<p>Notification from Centre For Sports Science</p>';
	}
}

/**
 * Send email notification (server-side only - directly uses Resend)
 * For client-side use, call the /api/email endpoint directly
 */
export async function sendEmailNotification(emailData: EmailData): Promise<{ success: boolean; error?: string }> {
	// Check if we're in a server environment
	if (typeof window === 'undefined') {
		// Server-side: use Resend directly
		try {
			const { Resend } = await import('resend');
			const resend = new Resend(process.env.RESEND_API_KEY);

			// Validate required fields
			if (!emailData.to || !emailData.template) {
				return { success: false, error: 'Missing required fields: to, template' };
			}

			// Validate email format
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(emailData.to)) {
				return { success: false, error: 'Invalid email address' };
			}

			// Check if Resend API key is configured
			if (!process.env.RESEND_API_KEY) {
				console.warn('RESEND_API_KEY not configured. Email will not be sent.');
				if (process.env.NODE_ENV === 'development') {
					console.log('Email would be sent:', {
						to: emailData.to,
						subject: emailData.subject || getEmailSubject(emailData.template, emailData.data),
						template: emailData.template,
					});
					return { success: true };
				}
				return { success: false, error: 'Email service not configured' };
			}

			// Generate subject and body
			const subject = emailData.subject || getEmailSubject(emailData.template, emailData.data);
			const html = generateEmailBody(emailData.template, emailData.data);

			// Get sender email from environment or use default
			const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
			const fromName = process.env.RESEND_FROM_NAME || 'Centre For Sports Science';

			// Send email via Resend
			const result = await resend.emails.send({
				from: `${fromName} <${fromEmail}>`,
				to: emailData.to,
				subject,
				html,
			});

			if (result.error) {
				console.error('Resend API error:', result.error);
				let errorMessage = result.error.message || JSON.stringify(result.error) || 'Failed to send email';
				
				// Provide helpful guidance for common Resend errors
				if (result.error.statusCode === 403 && errorMessage.includes('testing emails')) {
					console.warn('Resend test mode restriction: You can only send to verified email addresses.');
					console.warn('To send to other recipients, verify a domain at https://resend.com/domains');
					console.warn('For now, emails can only be sent to:', emailData.to);
					// In development, we'll still try to proceed if sending to the verified email
					if (process.env.NODE_ENV === 'development') {
						console.warn('Continuing in development mode...');
					}
				}
				
				return { success: false, error: errorMessage };
			}

			return { success: true };
		} catch (error) {
			console.error('Failed to send email notification:', error);
			return { 
				success: false, 
				error: error instanceof Error ? error.message : 'Unknown error' 
			};
		}
	} else {
		// Client-side: use API route
		try {
			const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
			const response = await fetch(`${baseUrl}/api/email`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(emailData),
			});

			if (!response.ok) {
				const error = await response.text();
				return { success: false, error };
			}

			return { success: true };
		} catch (error) {
			console.error('Failed to send email notification:', error);
			return { 
				success: false, 
				error: error instanceof Error ? error.message : 'Unknown error' 
			};
		}
	}
}

