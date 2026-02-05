import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { reportHistory } = body;

		if (!reportHistory || !Array.isArray(reportHistory)) {
			return NextResponse.json(
				{ success: false, message: 'Missing or invalid field: reportHistory (must be an array)' },
				{ status: 400 }
			);
		}

		if (reportHistory.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Report history is empty. At least one report is required for analysis.' },
				{ status: 400 }
			);
		}

		if (!process.env.OPENAI_API_KEY) {
			console.error('OPENAI_API_KEY is not set');
			return NextResponse.json(
				{ success: false, message: 'OpenAI API key is not configured' },
				{ status: 500 }
			);
		}

		const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

		// Prepare the system prompt
		const systemPrompt = `You are an expert Clinical Data Analyst. I am providing you with a chronological list of report versions (sessions) for a patient.

Goal: Analyze the *trend* over time.

Output JSON with these exact keys:
- \`summary\`: A 2-sentence summary of their overall progress across these versions.
- \`trend_analysis\`: A specific comment on how their Pain Scale and Range of Motion (ROM) have changed from the first report to the last.
- \`key_achievements\`: An array of bullet points (strings) of specific improvements.
- \`recommendation\`: Suggestion for the next session based on the latest report.

Keep the tone professional and concise.`;

		// Prepare the user message with report history
		const userMessage = `Please analyze the following chronological report history for this patient:\n\n${JSON.stringify(reportHistory, null, 2)}\n\nProvide a clinical trend analysis in the requested JSON format.`;

		// Call OpenAI API
		let completion;
		try {
			completion = await openai.chat.completions.create({
				model: 'gpt-3.5-turbo',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
				response_format: { type: 'json_object' },
				temperature: 0.7,
			});
		} catch (rateLimitError: any) {
			// Handle rate limit errors specifically
			if (rateLimitError?.status === 429 || rateLimitError?.code === 'rate_limit_exceeded') {
				console.warn('OpenAI rate limit exceeded, returning fallback response');
				// Return a user-friendly fallback response that matches the expected structure
				return NextResponse.json({
					success: true,
					data: {
						summary: 'AI services are currently busy. Please try again in a moment.',
						trend_analysis: 'Unable to analyze trends at this time due to high service demand. Please retry shortly.',
						key_achievements: ['Analysis temporarily unavailable'],
						recommendation: 'Please wait a moment and try again to get the latest analytics.',
					},
				});
			}
			// Re-throw if it's not a rate limit error
			throw rateLimitError;
		}

		const responseContent = completion.choices[0]?.message?.content;

		if (!responseContent) {
			return NextResponse.json(
				{ success: false, message: 'No response from OpenAI' },
				{ status: 500 }
			);
		}

		// Parse the JSON response
		let analysisResult;
		try {
			analysisResult = JSON.parse(responseContent);
		} catch (parseError) {
			console.error('Failed to parse OpenAI response:', parseError);
			return NextResponse.json(
				{ success: false, message: 'Invalid JSON response from AI' },
				{ status: 500 }
			);
		}

		// Validate the response structure
		if (!analysisResult.summary || !analysisResult.trend_analysis || !Array.isArray(analysisResult.key_achievements) || !analysisResult.recommendation) {
			return NextResponse.json(
				{ success: false, message: 'Invalid analysis structure from AI. Missing required fields.' },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			success: true,
			data: analysisResult,
		});
	} catch (error: any) {
		console.error('Error analyzing patient data:', error);
		
		// Handle OpenAI-specific errors
		if (error?.status === 401) {
			return NextResponse.json(
				{ success: false, message: 'Invalid OpenAI API key' },
				{ status: 401 }
			);
		}
		
		if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
			// Return a user-friendly fallback response that matches the expected structure
			return NextResponse.json({
				success: true,
				data: {
					summary: 'AI services are currently busy. Please try again in a moment.',
					trend_analysis: 'Unable to analyze trends at this time due to high service demand. Please retry shortly.',
					key_achievements: ['Analysis temporarily unavailable'],
					recommendation: 'Please wait a moment and try again to get the latest analytics.',
				},
			});
		}

		return NextResponse.json(
			{ success: false, message: error?.message || 'Failed to analyze patient data' },
			{ status: 500 }
		);
	}
}
