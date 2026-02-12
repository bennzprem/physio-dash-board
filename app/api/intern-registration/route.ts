import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const DEGREE_AMOUNTS: Record<string, number> = {
	"Bachelor's Degree (BPT)": 2500,
	"Master's Degree (MPT)": 5000,
	Clinical: 2500,
};

function getAmountForDegree(degree: string): number {
	const normalized = degree.trim();
	if (DEGREE_AMOUNTS[normalized] !== undefined) return DEGREE_AMOUNTS[normalized];
	if (/Bachelor|BPT/i.test(normalized)) return 2500;
	if (/Master|MPT/i.test(normalized)) return 5000;
	if (/Clinical/i.test(normalized)) return 2500;
	return 2500;
}

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const college = typeof body.college === 'string' ? body.college.trim() : '';
		const degree = typeof body.degree === 'string' ? body.degree.trim() : "Bachelor's Degree (BPT)";
		const dateOfJoining = typeof body.dateOfJoining === 'string' ? body.dateOfJoining.trim() : '';
		const dateOfLeaving = typeof body.dateOfLeaving === 'string' ? body.dateOfLeaving.trim() : '';

		if (!name || !college || !dateOfJoining || !dateOfLeaving) {
			return NextResponse.json(
				{ error: 'Missing required fields: name, college, dateOfJoining, dateOfLeaving' },
				{ status: 400 }
			);
		}

		const joining = new Date(dateOfJoining);
		const leaving = new Date(dateOfLeaving);
		if (Number.isNaN(joining.getTime()) || Number.isNaN(leaving.getTime())) {
			return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 });
		}
		if (leaving < joining) {
			return NextResponse.json({ error: 'Date of leaving must be after date of joining.' }, { status: 400 });
		}

		const amount = typeof body.amount === 'number' && body.amount >= 0
			? Math.round(body.amount)
			: getAmountForDegree(degree);

		await dbAdmin.collection('internRegistrations').add({
			name,
			college,
			degree: degree || "Bachelor's Degree (BPT)",
			dateOfJoining,
			dateOfLeaving,
			amount,
			status: 'pending',
			createdAt: FieldValue.serverTimestamp(),
			updatedAt: FieldValue.serverTimestamp(),
		});

		return NextResponse.json({ success: true, message: 'Registration submitted. Front desk will review and add you to the interns list.' });
	} catch (err) {
		console.error('Intern registration API error:', err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to submit registration' },
			{ status: 500 }
		);
	}
}
