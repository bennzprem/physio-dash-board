'use client';

import { useState, useEffect, useMemo } from 'react';
import type { PatientRecordFull } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';

interface PsychologyReportData {
	// Demographics
	assessmentType?: 'pre' | 'post';
	dateOfAssessment?: string;
	name?: string;
	age?: string;
	gender?: string;
	fatherName?: string;
	motherName?: string;
	sport?: string;
	psychologist?: string;
	phone?: string;
	email?: string;
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
		"Oxygenation (P)"?: number;
	};
	brainSensing?: {
		attention?: number;
		spatialAbility?: number;
		decisionMaking?: number;
		memory?: number;
		cognitiveFlexibility?: number;
	};
	
	// 
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
			"Oxygenation (P)"?: number;
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
			speed?: number; // ms
			accuracy?: number; // %
		};
		vrMeditation?: string;
		extraAssessment?: string;
	};
}

interface PsychologyReportProps {
	patientData: PatientRecordFull | null;
	formData: PsychologyReportData;
	onChange: (data: PsychologyReportData) => void;
	editable?: boolean;
	sessionIndex?: number; // 0-based index (0 = first session)
	totalSessions?: number; // Total number of sessions
	hasExistingVersions?: boolean; // Whether there are existing report versions
	isViewingSavedVersion?: boolean; // When true, follow-up visibility is based only on saved data content
	isEditingLoadedVersion?: boolean; // When true, form was loaded from a version for editing - follow-up visibility from form data
	sessionCompleted?: boolean;
	onSessionCompletedChange?: (checked: boolean) => void;
}

// Helper functions for categorization
const getCategory = (score: number, ranges: Array<{ min: number; max: number; label: string }>): string => {
	for (const range of ranges) {
		if (score >= range.min && score <= range.max) {
			return range.label;
		}
	}
	return 'N/A';
};

const getSensoryCategory = (score: number): string => {
	return getCategory(score, [
		{ min: 1, max: 20, label: 'Poor' },
		{ min: 21, max: 40, label: 'Below Average' },
		{ min: 41, max: 60, label: 'Average' },
		{ min: 61, max: 80, label: 'Good' },
		{ min: 81, max: 100, label: 'Excellent' },
	]);
};

const getTrackingSpeedCategory = (score: number): string => {
	if (score >= 0 && score <= 0.5) return 'Low tracking speed';
	if (score >= 0.51 && score <= 1.0) return 'Below average';
	if (score >= 1.01 && score <= 1.5) return 'Average';
	if (score >= 1.51 && score <= 2.0) return 'Above average';
	if (score >= 2.01) return 'High tracking speed';
	return 'N/A';
};

const getReactionTimeCategory = (ms: number): string => {
	if (ms >= 201) return 'Poor';
	if (ms >= 151 && ms <= 200) return 'Below Average';
	if (ms >= 101 && ms <= 150) return 'Average';
	if (ms >= 51 && ms <= 100) return 'Good';
	if (ms >= 0 && ms <= 50) return 'Excellent';
	return 'N/A';
};

const getHandEyeCoordinationCategory = (cm: number): string => {
	if (cm >= 12.1 && cm <= 15.0) return 'Poor';
	if (cm >= 9.1 && cm <= 12.0) return 'Below Average';
	if (cm >= 6.1 && cm <= 9.0) return 'Average';
	if (cm >= 3.1 && cm <= 6.0) return 'Good';
	if (cm >= 0.0 && cm <= 3.0) return 'Excellent';
	return 'N/A';
};

const getCompetitiveStateAnxietyCategory = (score: number): string => {
	if (score >= 9 && score <= 17) return 'Low';
	if (score >= 18 && score <= 27) return 'Average';
	if (score >= 28 && score <= 36) return 'High';
	return 'N/A';
};

const getMentalToughnessCategory = (score: number): string => {
	if (score >= 0 && score <= 4) return 'Thriving';
	if (score >= 5 && score <= 14) return 'Surviving';
	if (score >= 15 && score <= 24) return 'Struggling';
	return 'N/A';
};

const getBigFiveCategory = (score: number): string => {
	if (score >= 0 && score <= 13) return 'Low';
	if (score >= 14 && score <= 26) return 'Moderate/Average';
	if (score >= 27 && score <= 40) return 'High';
	return 'N/A';
};

const getControlsCategory = (sec: number): string => {
	return getCategory(sec, [
		{ min: 1, max: 10, label: 'Poor' },
		{ min: 11, max: 20, label: 'Below Average' },
		{ min: 21, max: 30, label: 'Average' },
		{ min: 31, max: 40, label: 'Good' },
		{ min: 41, max: 50, label: 'Excellent' },
	]);
};

// Helper function to calculate age from date of birth
const calculateAge = (dob?: string): string => {
	if (!dob) return '—';
	try {
		const birth = new Date(dob);
		if (Number.isNaN(birth.getTime())) return '—';
		const now = new Date();
		let age = now.getFullYear() - birth.getFullYear();
		const monthDiff = now.getMonth() - birth.getMonth();
		if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
			age -= 1;
		}
		return age > 0 ? String(age) : '—';
	} catch {
		return '—';
	}
};

export default function PsychologyReport({ patientData, formData, onChange, editable = true, sessionIndex, totalSessions, hasExistingVersions = false, isViewingSavedVersion = false, isEditingLoadedVersion = false, sessionCompleted = false, onSessionCompletedChange }: PsychologyReportProps) {
	const [localData, setLocalData] = useState<PsychologyReportData>(formData);
	const { user } = useAuth();

	// Helper function to check if an object has any actual values (not just empty object)
	const hasActualValues = (obj: any): boolean => {
		if (!obj || typeof obj !== 'object') return false;
		return Object.values(obj).some(val => val !== undefined && val !== null && val !== '');
	};

	// Determine if this is the first session
	// When viewing OR editing a loaded version: show follow-up ONLY if that version's data contains follow-up content
	// Otherwise: 1) hasExistingVersions, 2) sessionIndex, 3) check form data, 4) patient data, 5) default first session
	const isFirstSession = useMemo(() => {
		// When viewing or editing a loaded version, derive from that version's form data only
		if ((isViewingSavedVersion || isEditingLoadedVersion) && formData) {
			const dataToCheck = formData;
			// Show follow-up section only if THIS version's data has follow-up assessment content
			const hasFollowUpContent = hasActualValues(dataToCheck.followUpAssessment);
			return !hasFollowUpContent; // First session = no follow-up data in this version
		}

		// If hasExistingVersions is explicitly false, this is the first session
		if (hasExistingVersions === false) {
			return true;
		}
		// If hasExistingVersions is true, this is NOT the first session
		if (hasExistingVersions === true) {
			return false;
		}
		
		if (sessionIndex !== undefined) {
			return sessionIndex === 0;
		}
		if (totalSessions !== undefined) {
			return totalSessions === 1;
		}
		
		// Helper to safely check string values
		const hasStringValue = (val: any): boolean => {
			return val && typeof val === 'string' && val.trim().length > 0;
		};
		
		// Use formData if it has data, otherwise fall back to localData
		const dataToCheck = Object.keys(formData).length > 0 ? formData : localData;
		
		// Check if there's existing psychology report data with initial assessment sections filled
		// If any initial assessment data exists, this is NOT the first session (it's a follow-up)
		// We check for actual assessment data, not just demographics
		const hasInitialAssessmentData = 
			hasActualValues(dataToCheck.sensoryStation) ||
			hasActualValues(dataToCheck.neurofeedbackHeadset) ||
			hasActualValues(dataToCheck.brainSensing) ||
			(dataToCheck.trackingSpeed !== undefined && dataToCheck.trackingSpeed !== null) ||
			(dataToCheck.reactionTime !== undefined && dataToCheck.reactionTime !== null) ||
			(dataToCheck.handEyeCoordination !== undefined && dataToCheck.handEyeCoordination !== null) ||
			hasActualValues(dataToCheck.competitiveStateAnxiety) ||
			hasActualValues(dataToCheck.mentalToughness) ||
			hasActualValues(dataToCheck.bigFivePersonality) ||
			hasStringValue(dataToCheck.extraAssessments) ||
			// Check for player history and concerns which are part of initial assessment
			hasStringValue(dataToCheck.playingSince) ||
			hasStringValue(dataToCheck.highestAchievement) ||
			hasStringValue(dataToCheck.currentLevel) ||
			(dataToCheck.currentConcerns && Array.isArray(dataToCheck.currentConcerns) && dataToCheck.currentConcerns.length > 0 && dataToCheck.currentConcerns.some((c: string) => hasStringValue(c))) ||
			hasActualValues(dataToCheck.stressors) ||
			hasActualValues(dataToCheck.socialEnvironment) ||
			hasActualValues(dataToCheck.familyHistory) ||
			hasStringValue(dataToCheck.historyOfConcerns) ||
			// Check if follow-up assessment data exists (definitely means it's not first session)
			hasActualValues(dataToCheck.followUpAssessment);
		
		// If there's initial assessment data, this is a follow-up session
		if (hasInitialAssessmentData) {
			return false;
		}
		
		// Calculate from patient data if available
		if (patientData) {
			const remaining = typeof patientData.remainingSessions === 'number' ? patientData.remainingSessions : null;
			const total = typeof patientData.totalSessionsRequired === 'number' ? patientData.totalSessionsRequired : null;
			if (remaining !== null && total !== null) {
				// If remaining is equal to or very close to total, it's likely the first session
				return remaining >= total - 1;
			}
			// If only total is available and it's 1, it's the first session
			if (total === 1) {
				return true;
			}
		}
		// Default: assume first session if we can't determine
		return true;
	}, [sessionIndex, totalSessions, patientData, formData, localData, isViewingSavedVersion, isEditingLoadedVersion]);

	useEffect(() => {
		setLocalData(formData);
	}, [formData]);

	// Auto-populate date of assessment with current date if not set (only on initial load)
	useEffect(() => {
		if (!formData.dateOfAssessment) {
			const today = new Date();
			const formattedDate = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
			updateField('dateOfAssessment', formattedDate);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // Only run once on mount

	// Auto-populate psychologist field with logged-in user's name if not set
	useEffect(() => {
		if (!localData.psychologist && user?.displayName && editable) {
			updateField('psychologist', user.displayName);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user?.displayName]); // Run when user becomes available

	const updateField = (field: keyof PsychologyReportData, value: any) => {
		const updated = { ...localData, [field]: value };
		setLocalData(updated);
		onChange(updated);
	};

	const updateNestedField = (parentField: keyof PsychologyReportData, field: string, value: any) => {
		const parent = localData[parentField] as any || {};
		const updated = { ...localData, [parentField]: { ...parent, [field]: value } };
		setLocalData(updated);
		onChange(updated);
	};

	const updateFollowUpNestedField = (subField: string, value: any) => {
		const followUp = localData.followUpAssessment || {};
		const updated = { ...localData, followUpAssessment: { ...followUp, [subField]: value } };
		setLocalData(updated);
		onChange(updated);
	};

	const updateConcern = (index: number, value: string) => {
		const concerns = [...(localData.currentConcerns || [])];
		concerns[index] = value;
		updateField('currentConcerns', concerns);
	};

	return (
		<div className="space-y-8">
			{/* Demographics Details */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-xl font-bold text-indigo-600">Demographics Details</h2>
				
				<div className="mb-4 flex gap-6">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={localData.assessmentType === 'pre'}
							onChange={(e) => updateField('assessmentType', e.target.checked ? 'pre' : undefined)}
							disabled={!editable}
							className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-200"
						/>
						<span className="text-sm font-medium text-slate-700">Pre-Assessment</span>
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={localData.assessmentType === 'post'}
							onChange={(e) => updateField('assessmentType', e.target.checked ? 'post' : undefined)}
							disabled={!editable}
							className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-200"
						/>
						<span className="text-sm font-medium text-slate-700">Post-Assessment</span>
					</label>
				</div>

				<div className="mb-4">
					<label className="block text-sm font-medium text-slate-700 mb-1">Date of Assessment</label>
					{editable ? (
						<input
							type="date"
							value={localData.dateOfAssessment || ''}
							onChange={(e) => updateField('dateOfAssessment', e.target.value)}
							className="w-full sm:w-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
						/>
					) : (
						<p className="text-sm text-slate-900">
							{localData.dateOfAssessment 
								? new Date(localData.dateOfAssessment).toLocaleDateString('en-US', { 
									year: 'numeric', 
									month: 'long', 
									day: 'numeric' 
								})
								: '—'}
						</p>
					)}
				</div>

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Age</label>
						<p className="text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-md px-3 py-2">
							{calculateAge(patientData?.dob)}
						</p>
					</div>
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Father's name</label>
						{editable ? (
							<input
								type="text"
								value={localData.fatherName || ''}
								onChange={(e) => updateField('fatherName', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter father's name"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.fatherName || '—'}</p>
						)}
					</div>
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Mother's name</label>
						{editable ? (
							<input
								type="text"
								value={localData.motherName || ''}
								onChange={(e) => updateField('motherName', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter mother's name"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.motherName || '—'}</p>
						)}
					</div>
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Sport</label>
						{editable ? (
							<input
								type="text"
								value={localData.sport || ''}
								onChange={(e) => updateField('sport', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter sport"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.sport || '—'}</p>
						)}
					</div>
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">State/City</label>
						{editable ? (
							<input
								type="text"
								value={localData.stateCity || ''}
								onChange={(e) => updateField('stateCity', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter state/city"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.stateCity || '—'}</p>
						)}
					</div>
				</div>
			</div>

			{/* Initial Assessment Sections - Only show on first session */}
			{isFirstSession && (
				<>
					{/* Player's History */}
					<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Player's History</h2>
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Playing since (Month/Year)</label>
						{editable ? (
							<input
								type="text"
								value={localData.playingSince || ''}
								onChange={(e) => updateField('playingSince', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="e.g., January 2020"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.playingSince || '—'}</p>
						)}
					</div>
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">Highest achievement</label>
						{editable ? (
							<input
								type="text"
								value={localData.highestAchievement || ''}
								onChange={(e) => updateField('highestAchievement', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter highest achievement"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.highestAchievement || '—'}</p>
						)}
					</div>
					<div className="sm:col-span-2">
						<label className="block text-sm font-medium text-slate-700 mb-1">Current level of playing</label>
						{editable ? (
							<input
								type="text"
								value={localData.currentLevel || ''}
								onChange={(e) => updateField('currentLevel', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter current level"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.currentLevel || '—'}</p>
						)}
					</div>
				</div>

				<div className="mt-4">
					<label className="block text-sm font-medium text-slate-700 mb-2">Current Concerns</label>
					<div className="space-y-2">
						{Array.from({ length: 8 }).map((_, index) => (
							<div key={index} className="flex items-center gap-2">
								<span className="text-sm font-medium text-slate-600 w-6">{index + 1}.</span>
								{editable ? (
									<input
										type="text"
										value={localData.currentConcerns?.[index] || ''}
										onChange={(e) => updateConcern(index, e.target.value)}
										className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
										placeholder={`Enter concern ${index + 1}`}
									/>
								) : (
									<p className="text-sm text-slate-900 flex-1">{localData.currentConcerns?.[index] || '—'}</p>
								)}
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Current Psychological Stressor */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Current Psychological Stressor</h2>
				<p className="mb-4 text-sm text-slate-600">Select the number to denote its intensity (Scale 1-10).</p>
				<div className="space-y-3">
					{[
						{ key: 'lackOfFocusExternal', label: 'Lack of Focus (Due to external factors)' },
						{ key: 'lackOfFocusInternal', label: 'Lack of Focus (Due to internal factors)' },
						{ key: 'nervousness', label: 'Nervousness' },
						{ key: 'performancePressure', label: 'Performance Pressure' },
						{ key: 'attentionDisruption', label: 'Attention disruption' },
						{ key: 'fearOfFailure', label: 'Fear of failure' },
						{ key: 'thoughtsWondering', label: 'Thoughts wondering' },
						{ key: 'lowReactionTime', label: 'Low reaction time' },
						{ key: 'lackOfMentalPreparation', label: 'Lack of mental preparation' },
						{ key: 'overthinking', label: 'Overthinking' },
					].map(({ key, label }) => (
						<div key={key} className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">{label}</label>
							{editable ? (
								<select
									value={typeof localData.stressors?.[key as keyof typeof localData.stressors] === 'number' 
										? String(localData.stressors[key as keyof typeof localData.stressors]) 
										: ''}
									onChange={(e) => updateNestedField('stressors', key, e.target.value ? parseInt(e.target.value) : undefined)}
									className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
								>
									<option value="">—</option>
									{Array.from({ length: 10 }, (_, i) => i + 1).map(num => (
										<option key={num} value={num}>{num}</option>
									))}
								</select>
							) : (
								<span className="text-sm text-slate-900 w-24 text-right">
									{typeof localData.stressors?.[key as keyof typeof localData.stressors] === 'number'
										? String(localData.stressors[key as keyof typeof localData.stressors])
										: '—'}
								</span>
							)}
						</div>
					))}
					<div className="flex items-center gap-2 mt-4">
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={localData.stressors?.none || false}
								onChange={(e) => updateNestedField('stressors', 'none', e.target.checked)}
								disabled={!editable}
								className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-200"
							/>
							<span className="text-sm font-medium text-slate-700">None</span>
						</label>
					</div>
					<div className="mt-2">
						<label className="block text-sm font-medium text-slate-700 mb-1">Other</label>
						{editable ? (
							<input
								type="text"
								value={localData.stressors?.other || ''}
								onChange={(e) => updateNestedField('stressors', 'other', e.target.value)}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
								placeholder="Enter other stressor"
							/>
						) : (
							<p className="text-sm text-slate-900">{localData.stressors?.other || '—'}</p>
						)}
					</div>
				</div>
			</div>

			{/* Social Environment & Family History */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Social Environment & Family History</h2>
				<div className="mb-4">
					<h3 className="mb-2 text-sm font-medium text-slate-700">Social Environment</h3>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{['parents', 'siblings', 'friends', 'relatives'].map((field) => (
							<div key={field}>
								<label className="block text-sm font-medium text-slate-700 mb-1 capitalize">{field}</label>
								{editable ? (
									<input
										type="text"
										value={localData.socialEnvironment?.[field as keyof typeof localData.socialEnvironment] || ''}
										onChange={(e) => updateNestedField('socialEnvironment', field, e.target.value)}
										className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
										placeholder={`Enter ${field}`}
									/>
								) : (
									<p className="text-sm text-slate-900">
										{localData.socialEnvironment?.[field as keyof typeof localData.socialEnvironment] || '—'}
									</p>
								)}
							</div>
						))}
					</div>
				</div>
				<div>
					<h3 className="mb-2 text-sm font-medium text-slate-700">Family History of Medical and Mental Health Issues</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1">Maternal Family</label>
							{editable ? (
								<input
									type="text"
									value={localData.familyHistory?.maternalFamily || ''}
									onChange={(e) => updateNestedField('familyHistory', 'maternalFamily', e.target.value)}
									className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
									placeholder="Enter maternal family history"
								/>
							) : (
								<p className="text-sm text-slate-900">{localData.familyHistory?.maternalFamily || '—'}</p>
							)}
						</div>
						<div>
							<label className="block text-sm font-medium text-slate-700 mb-1">Paternal Family</label>
							{editable ? (
								<input
									type="text"
									value={localData.familyHistory?.paternalFamily || ''}
									onChange={(e) => updateNestedField('familyHistory', 'paternalFamily', e.target.value)}
									className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
									placeholder="Enter paternal family history"
								/>
							) : (
								<p className="text-sm text-slate-900">{localData.familyHistory?.paternalFamily || '—'}</p>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* History of Present Concerns */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">History of Present Concerns</h2>
				<p className="mb-4 text-sm text-slate-600">
					Please write why you chose your sport and your first match experience; also, please mention any issues you are facing and the reason behind those issues, like when/why/how they started.
				</p>
				{editable ? (
					<textarea
						value={localData.historyOfConcerns || ''}
						onChange={(e) => updateField('historyOfConcerns', e.target.value)}
						rows={6}
						className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
						placeholder="Enter history of present concerns..."
					/>
				) : (
					<p className="text-sm text-slate-900 whitespace-pre-wrap">{localData.historyOfConcerns || '—'}</p>
				)}
			</div>

			{/* Brain Training Assessment */}
			<div className="pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Brain Training Assessment</h2>
				
				{/* Sensory Station Assessment */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">1. Sensory Station Assessment</h3>
					<div className="space-y-3">
						{[
							{ key: 'visualClarity', label: 'Visual clarity' },
							{ key: 'contrastSensitivity', label: 'Contrast sensitivity' },
							{ key: 'depthPerception', label: 'Depth perception' },
							{ key: 'nearFarQuickness', label: 'Near far quickness' },
							{ key: 'perceptionSpan', label: 'Perception span' },
							{ key: 'multipleObjectTracking', label: 'Multiple object tracking' },
							{ key: 'reactionTime', label: 'Reaction Time' },
						].map(({ key, label }) => {
							const score = localData.sensoryStation?.[key as keyof typeof localData.sensoryStation] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">a) {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="1"
												max="100"
												value={score || ''}
												onChange={(e) => updateNestedField('sensoryStation', key, e.target.value ? parseInt(e.target.value) : undefined)}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
										{score && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getSensoryCategory(score)})
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Neurofeedback Headset Training */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">2. Neurofeedback Headset Training</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">a) Neural activity (%)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="1"
										max="100"
										value={localData.neurofeedbackHeadset?.neuralActivity || ''}
										onChange={(e) => updateNestedField('neurofeedbackHeadset', 'neuralActivity', e.target.value ? parseInt(e.target.value) : undefined)}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="Score"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.neurofeedbackHeadset?.neuralActivity || '—'}
									</span>
								)}
								{localData.neurofeedbackHeadset?.neuralActivity && (
									<span className="text-sm font-medium text-indigo-600 w-32">
										({getSensoryCategory(localData.neurofeedbackHeadset.neuralActivity)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">b) Controls (sec)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="1"
										max="50"
										value={localData.neurofeedbackHeadset?.controls || ''}
										onChange={(e) => updateNestedField('neurofeedbackHeadset', 'controls', e.target.value ? parseInt(e.target.value) : undefined)}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="Seconds"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.neurofeedbackHeadset?.controls || '—'}
									</span>
								)}
								{localData.neurofeedbackHeadset?.controls && (
									<span className="text-sm font-medium text-indigo-600 w-32">
										({getControlsCategory(localData.neurofeedbackHeadset.controls)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">c) Oxygenation (P)</label>
							{editable ? (
								<input
									type="number"
									value={localData.neurofeedbackHeadset?.["Oxygenation (P)"] || ''}
									onChange={(e) => updateNestedField('neurofeedbackHeadset', 'Oxygenation (P)', e.target.value ? parseFloat(e.target.value) : undefined)}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="Value"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">
									{localData.neurofeedbackHeadset?.["Oxygenation (P)"] || '—'}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Brain Sensing Cognitive Trainer */}
				<div>
					<h3 className="mb-3 text-sm font-semibold text-slate-800">3. Brain Sensing Cognitive Trainer</h3>
					<div className="space-y-3">
						{[
							{ key: 'attention', label: 'Attention' },
							{ key: 'spatialAbility', label: 'Spatial ability' },
							{ key: 'decisionMaking', label: 'Decision making' },
							{ key: 'memory', label: 'Memory' },
							{ key: 'cognitiveFlexibility', label: 'Cognitive flexibility' },
						].map(({ key, label }) => {
							const score = localData.brainSensing?.[key as keyof typeof localData.brainSensing] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">Parameters: {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="1"
												max="100"
												value={score || ''}
												onChange={(e) => updateNestedField('brainSensing', key, e.target.value ? parseInt(e.target.value) : undefined)}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
										{score && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getSensoryCategory(score)})
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			<div className="border-b border-slate-200 pb-6">
				{/* 3D - Multiple Object Tracking */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">4. 3D - Multiple Object Tracking</h3>
					<div className="flex items-center justify-between">
						<label className="text-sm font-medium text-slate-700 flex-1">Tracking Speed</label>
						<div className="flex items-center gap-3">
							{editable ? (
								<input
									type="number"
									step="0.01"
									min="0"
									value={localData.trackingSpeed || ''}
									onChange={(e) => updateField('trackingSpeed', e.target.value ? parseFloat(e.target.value) : undefined)}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="Value"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">{localData.trackingSpeed || '—'}</span>
							)}
							{localData.trackingSpeed !== undefined && (
								<span className="text-sm font-medium text-indigo-600 w-40">
									({getTrackingSpeedCategory(localData.trackingSpeed)})
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Reaction Time & Hand-Eye Coordination */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">5. Reaction Time & Hand-Eye Coordination</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Reaction Time (ms)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="0"
										value={localData.reactionTime || ''}
										onChange={(e) => updateField('reactionTime', e.target.value ? parseInt(e.target.value) : undefined)}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="ms"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">{localData.reactionTime || '—'}</span>
								)}
								{localData.reactionTime !== undefined && (
									<span className="text-sm font-medium text-indigo-600 w-40">
										({getReactionTimeCategory(localData.reactionTime)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Hand-Eye Coordination (cm)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										step="0.1"
										min="0"
										value={localData.handEyeCoordination || ''}
										onChange={(e) => updateField('handEyeCoordination', e.target.value ? parseFloat(e.target.value) : undefined)}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="cm"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">{localData.handEyeCoordination || '—'}</span>
								)}
								{localData.handEyeCoordination !== undefined && (
									<span className="text-sm font-medium text-indigo-600 w-40">
										({getHandEyeCoordinationCategory(localData.handEyeCoordination)})
									</span>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Psychological Assessment */}
			<div className="pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Psychological Assessment</h2>
				{/* Competitive State Anxiety Test */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">6. Competitive State Anxiety Test</h3>
					<div className="space-y-3">
						{[
							{ key: 'cognitiveStateAnxiety', label: 'Cognitive State anxiety' },
							{ key: 'somaticStateAnxiety', label: 'Somatic State anxiety' },
							{ key: 'selfConfidence', label: 'Self-confidence' },
						].map(({ key, label }) => {
							const score = localData.competitiveStateAnxiety?.[key as keyof typeof localData.competitiveStateAnxiety] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">Parameters: {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="9"
												max="36"
												value={score || ''}
												onChange={(e) => updateNestedField('competitiveStateAnxiety', key, e.target.value ? parseInt(e.target.value) : undefined)}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
										{score && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getCompetitiveStateAnxietyCategory(score)})
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Mental Toughness Test */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">7. Mental Toughness Test</h3>
					<div className="space-y-3">
						{[
							{ key: 'commitment', label: 'Commitment' },
							{ key: 'concentration', label: 'Concentration' },
							{ key: 'controlUnderPressure', label: 'Control Under pressure' },
							{ key: 'confidence', label: 'Confidence' },
						].map(({ key, label }) => {
							const score = localData.mentalToughness?.[key as keyof typeof localData.mentalToughness] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">parameters: {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="0"
												max="24"
												value={score || ''}
												onChange={(e) => updateNestedField('mentalToughness', key, e.target.value ? parseInt(e.target.value) : undefined)}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
									</div>
								</div>
							);
						})}
						{/* Total Score Row */}
						{(() => {
							const commitment = localData.mentalToughness?.commitment ?? 0;
							const concentration = localData.mentalToughness?.concentration ?? 0;
							const controlUnderPressure = localData.mentalToughness?.controlUnderPressure ?? 0;
							const confidence = localData.mentalToughness?.confidence ?? 0;
							const totalScore = commitment + concentration + controlUnderPressure + confidence;
							const hasAnyScore = commitment !== 0 || concentration !== 0 || controlUnderPressure !== 0 || confidence !== 0;
							
							return (
								<div className="flex items-center justify-between pt-2 border-t border-slate-200">
									<label className="text-sm font-medium text-slate-700 flex-1">Total score</label>
									<div className="flex items-center gap-3">
										<span className="text-sm text-slate-900 w-20 text-right font-semibold">{hasAnyScore ? totalScore : '—'}</span>
										{hasAnyScore && totalScore !== undefined && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getMentalToughnessCategory(totalScore)})
											</span>
										)}
									</div>
								</div>
							);
						})()}
					</div>
				</div>

				{/* The Big Five Personality Test */}
				<div>
					<h3 className="mb-3 text-sm font-semibold text-slate-800">8. The Big Five Personality Test</h3>
					<div className="space-y-3">
						{[
							{ key: 'extroversion', label: 'Extroversion' },
							{ key: 'agreeableness', label: 'Agreeableness' },
							{ key: 'conscientiousness', label: 'Conscientiousness' },
							{ key: 'neuroticism', label: 'Neuroticism' },
							{ key: 'opennessToExperience', label: 'Openness to experience' },
						].map(({ key, label }) => {
							const score = localData.bigFivePersonality?.[key as keyof typeof localData.bigFivePersonality] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">parameters: {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="0"
												max="40"
												value={score || ''}
												onChange={(e) => updateNestedField('bigFivePersonality', key, e.target.value ? parseInt(e.target.value) : undefined)}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
										{score !== undefined && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getBigFiveCategory(score)})
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{/* Extra Assessments */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Extra Assessments</h2>
				<p className="mb-4 text-sm text-slate-600">
					Enter any additional assessment information or notes.
				</p>
				{editable ? (
					<textarea
						value={localData.extraAssessments || ''}
						onChange={(e) => updateField('extraAssessments', e.target.value)}
						rows={6}
						className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
						placeholder="Enter extra assessments or additional notes..."
					/>
				) : (
					<p className="text-sm text-slate-900 whitespace-pre-wrap">{localData.extraAssessments || '—'}</p>
				)}
			</div>

			{/* Psychologist */}
			<div className="border-b border-slate-200 pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Psychologist</h2>
				<div className="max-w-md">
					{editable ? (
						<input
							type="text"
							value={localData.psychologist || ''}
							onChange={(e) => updateField('psychologist', e.target.value)}
							className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
							placeholder="Enter psychologist name"
						/>
					) : (
						<p className="text-sm text-slate-900">{localData.psychologist || '—'}</p>
					)}
				</div>
			</div>
				</>
			)}

			{/* Follow-up Assessment Report - Only show on subsequent sessions */}
			{!isFirstSession && (
			<div className="pb-6">
				<h2 className="mb-4 text-lg font-semibold text-slate-900">Follow-up Assessment Report</h2>

				<div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
					<p className="text-sm text-blue-800">
						<i className="fas fa-info-circle mr-2" aria-hidden="true" />
						This is a follow-up assessment. Please update the follow-up assessment, progress, and treatment details.
					</p>
				</div>

				{/* Neurofeedback Headset Training */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">1. Neurofeedback Headset Training</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">a) Neural activity (%)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="1"
										max="100"
										value={localData.followUpAssessment?.neurofeedbackHeadset?.neuralActivity || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.neurofeedbackHeadset || {};
										updateFollowUpNestedField('neurofeedbackHeadset', {
											...parent,
											neuralActivity: e.target.value ? parseInt(e.target.value) : undefined
										});
									}}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="Score"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.followUpAssessment?.neurofeedbackHeadset?.neuralActivity || '—'}
									</span>
								)}
								{localData.followUpAssessment?.neurofeedbackHeadset?.neuralActivity && (
									<span className="text-sm font-medium text-indigo-600 w-32">
										({getSensoryCategory(localData.followUpAssessment.neurofeedbackHeadset.neuralActivity)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">b) Controls (sec)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="1"
										max="50"
										value={localData.followUpAssessment?.neurofeedbackHeadset?.controls || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.neurofeedbackHeadset || {};
										updateFollowUpNestedField('neurofeedbackHeadset', {
											...parent,
											controls: e.target.value ? parseInt(e.target.value) : undefined
										});
									}}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="Seconds"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.followUpAssessment?.neurofeedbackHeadset?.controls || '—'}
									</span>
								)}
								{localData.followUpAssessment?.neurofeedbackHeadset?.controls && (
									<span className="text-sm font-medium text-indigo-600 w-32">
										({getControlsCategory(localData.followUpAssessment.neurofeedbackHeadset.controls)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">c) Oxygenation (P)</label>
							{editable ? (
								<input
									type="number"
									value={localData.followUpAssessment?.neurofeedbackHeadset?.["Oxygenation (P)"] || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.neurofeedbackHeadset || {};
										updateFollowUpNestedField('neurofeedbackHeadset', {
											...parent,
											"Oxygenation (P)": e.target.value ? parseFloat(e.target.value) : undefined
										});
									}}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="Value"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">
									{localData.followUpAssessment?.neurofeedbackHeadset?.["Oxygenation (P)"] || '—'}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Brain Sensing Cognitive Trainer */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">2. Brain Sensing Cognitive Trainer</h3>
					<div className="space-y-3">
						{[
							{ key: 'attention', label: 'Attention' },
							{ key: 'spatialAbility', label: 'Spatial ability' },
							{ key: 'decisionMaking', label: 'Decision making' },
							{ key: 'memory', label: 'Memory' },
							{ key: 'cognitiveFlexibility', label: 'Cognitive flexibility' },
						].map(({ key, label }) => {
							const score = localData.followUpAssessment?.brainSensing?.[key as keyof typeof localData.followUpAssessment.brainSensing] as number | undefined;
							return (
								<div key={key} className="flex items-center justify-between">
									<label className="text-sm font-medium text-slate-700 flex-1">Parameters: {label}</label>
									<div className="flex items-center gap-3">
										{editable ? (
											<input
												type="number"
												min="1"
												max="100"
												value={score || ''}
												onChange={(e) => {
													const parent = localData.followUpAssessment?.brainSensing || {};
													updateFollowUpNestedField('brainSensing', {
														...parent,
														[key]: e.target.value ? parseInt(e.target.value) : undefined
													});
												}}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
												placeholder="Score"
											/>
										) : (
											<span className="text-sm text-slate-900 w-20 text-right">{score || '—'}</span>
										)}
										{score && (
											<span className="text-sm font-medium text-indigo-600 w-32">
												({getSensoryCategory(score)})
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* 3D - Multiple Object Tracking */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">3. 3D - Multiple Object Tracking</h3>
					<div className="flex items-center justify-between">
						<label className="text-sm font-medium text-slate-700 flex-1">Tracking Speed</label>
						<div className="flex items-center gap-3">
							{editable ? (
								<input
									type="number"
									step="0.01"
									min="0"
									value={localData.followUpAssessment?.multipleObjectTracking?.trackingSpeed || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.multipleObjectTracking || {};
										updateFollowUpNestedField('multipleObjectTracking', {
											...parent,
											trackingSpeed: e.target.value ? parseFloat(e.target.value) : undefined
										});
									}}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="Value"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">
									{localData.followUpAssessment?.multipleObjectTracking?.trackingSpeed || '—'}
								</span>
							)}
							{localData.followUpAssessment?.multipleObjectTracking?.trackingSpeed !== undefined && (
								<span className="text-sm font-medium text-indigo-600 w-40">
									({getTrackingSpeedCategory(localData.followUpAssessment.multipleObjectTracking.trackingSpeed)})
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Reaction Time & Hand-Eye Coordination */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">4. Reaction Time & Hand-Eye Coordination</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Reaction Time (ms)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										min="0"
										value={localData.followUpAssessment?.reactionTimeHandEye?.reactionTime || ''}
										onChange={(e) => {
											const parent = localData.followUpAssessment?.reactionTimeHandEye || {};
											updateFollowUpNestedField('reactionTimeHandEye', {
												...parent,
												reactionTime: e.target.value ? parseInt(e.target.value) : undefined
											});
										}}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="ms"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.followUpAssessment?.reactionTimeHandEye?.reactionTime || '—'}
									</span>
								)}
								{localData.followUpAssessment?.reactionTimeHandEye?.reactionTime !== undefined && (
									<span className="text-sm font-medium text-indigo-600 w-40">
										({getReactionTimeCategory(localData.followUpAssessment.reactionTimeHandEye.reactionTime)})
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Hand-Eye Coordination (cm)</label>
							<div className="flex items-center gap-3">
								{editable ? (
									<input
										type="number"
										step="0.1"
										min="0"
										value={localData.followUpAssessment?.reactionTimeHandEye?.handEyeCoordination || ''}
										onChange={(e) => {
											const parent = localData.followUpAssessment?.reactionTimeHandEye || {};
											updateFollowUpNestedField('reactionTimeHandEye', {
												...parent,
												handEyeCoordination: e.target.value ? parseFloat(e.target.value) : undefined
											});
										}}
										className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
										placeholder="cm"
									/>
								) : (
									<span className="text-sm text-slate-900 w-20 text-right">
										{localData.followUpAssessment?.reactionTimeHandEye?.handEyeCoordination || '—'}
									</span>
								)}
								{localData.followUpAssessment?.reactionTimeHandEye?.handEyeCoordination !== undefined && (
									<span className="text-sm font-medium text-indigo-600 w-40">
										({getHandEyeCoordinationCategory(localData.followUpAssessment.reactionTimeHandEye.handEyeCoordination)})
									</span>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Decision making speed (ms) & Accuracy (%) */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">5. Decision making speed (ms) & Accuracy (%)</h3>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Decision making speed (ms)</label>
							{editable ? (
								<input
									type="number"
									min="0"
									value={localData.followUpAssessment?.decisionMaking?.speed || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.decisionMaking || {};
										updateFollowUpNestedField('decisionMaking', {
											...parent,
											speed: e.target.value ? parseInt(e.target.value) : undefined
										});
									}}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="ms"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">
									{localData.followUpAssessment?.decisionMaking?.speed || '—'}
								</span>
							)}
						</div>
						<div className="flex items-center justify-between">
							<label className="text-sm font-medium text-slate-700 flex-1">Accuracy (%)</label>
							{editable ? (
								<input
									type="number"
									min="0"
									max="100"
									value={localData.followUpAssessment?.decisionMaking?.accuracy || ''}
									onChange={(e) => {
										const parent = localData.followUpAssessment?.decisionMaking || {};
										updateFollowUpNestedField('decisionMaking', {
											...parent,
											accuracy: e.target.value ? parseInt(e.target.value) : undefined
										});
									}}
									className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-center text-slate-900 placeholder:text-slate-400"
									placeholder="%"
								/>
							) : (
								<span className="text-sm text-slate-900 w-20 text-right">
									{localData.followUpAssessment?.decisionMaking?.accuracy || '—'}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* VR Meditation */}
				<div className="mb-6">
					<h3 className="mb-3 text-sm font-semibold text-slate-800">6. VR Meditation</h3>
					{editable ? (
						<textarea
							value={localData.followUpAssessment?.vrMeditation || ''}
							onChange={(e) => {
								updateFollowUpNestedField('vrMeditation', e.target.value);
							}}
							rows={4}
							className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
							placeholder="Enter VR Meditation assessment details..."
						/>
					) : (
						<p className="text-sm text-slate-900 whitespace-pre-wrap">
							{localData.followUpAssessment?.vrMeditation || '—'}
						</p>
					)}
				</div>

				{/* Extra Assessment */}
				<div>
					<h3 className="mb-3 text-sm font-semibold text-slate-800">7. Extra Assessment</h3>
					{editable ? (
						<textarea
							value={localData.followUpAssessment?.extraAssessment || ''}
							onChange={(e) => {
								updateFollowUpNestedField('extraAssessment', e.target.value);
							}}
							rows={4}
							className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
							placeholder="Enter extra assessment details..."
						/>
					) : (
						<p className="text-sm text-slate-900 whitespace-pre-wrap">
							{localData.followUpAssessment?.extraAssessment || '—'}
						</p>
					)}
				</div>
			</div>
			)}
		</div>
	);
}

