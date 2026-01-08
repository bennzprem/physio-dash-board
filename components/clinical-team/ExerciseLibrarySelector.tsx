'use client';

import { useState } from 'react';
import { 
	JOINT_WISE_EXERCISES, 
	CONDITION_BUNDLES, 
	type Exercise, 
	type ConditionBundle,
	searchExercises 
} from '@/lib/exerciseLibrary';

interface ExerciseLibrarySelectorProps {
	onSelectExercises: (exercises: string) => void;
	currentValue?: string;
	mode?: 'rehab-protocol' | 'treatment-provided';
}

export default function ExerciseLibrarySelector({ 
	onSelectExercises, 
	currentValue = '',
	mode = 'rehab-protocol' 
}: ExerciseLibrarySelectorProps) {
	const [showModal, setShowModal] = useState(false);
	const [activeTab, setActiveTab] = useState<'joints' | 'conditions' | 'search'>('joints');
	const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState('');
	const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
	const [selectedCondition, setSelectedCondition] = useState<string | null>(null);

	const handleExerciseToggle = (exerciseName: string) => {
		const newSelected = new Set(selectedExercises);
		if (newSelected.has(exerciseName)) {
			newSelected.delete(exerciseName);
		} else {
			newSelected.add(exerciseName);
		}
		setSelectedExercises(newSelected);
	};

	const handleInsertExercises = () => {
		const exercisesList = Array.from(selectedExercises).map(ex => `• ${ex}`).join('\n');
		const newValue = currentValue 
			? `${currentValue}\n\n${exercisesList}`
			: exercisesList;
		onSelectExercises(newValue);
		setShowModal(false);
		setSelectedExercises(new Set());
	};

	const handleSelectConditionBundle = (bundle: ConditionBundle, phaseIndex?: number) => {
		const exercises: string[] = [];
		
		if (phaseIndex !== undefined) {
			// Select specific phase
			const phase = bundle.phases[phaseIndex];
			exercises.push(`\n${bundle.name} - ${phase.phase}:`);
			exercises.push(`Goals: ${phase.goals.join(', ')}`);
			if (phase.progressCriteria) {
				exercises.push(`Progress Criteria: ${phase.progressCriteria}`);
			}
			exercises.push('Exercises:');
			phase.exercises.forEach(ex => exercises.push(`• ${ex.name}`));
		} else {
			// Select entire bundle
			exercises.push(`\n${bundle.name}:`);
			exercises.push(bundle.description);
			bundle.phases.forEach(phase => {
				exercises.push(`\n${phase.phase}:`);
				exercises.push(`Goals: ${phase.goals.join(', ')}`);
				if (phase.progressCriteria) {
					exercises.push(`Progress Criteria: ${phase.progressCriteria}`);
				}
				exercises.push('Exercises:');
				phase.exercises.forEach(ex => exercises.push(`• ${ex.name}`));
			});
		}
		
		const bundleText = exercises.join('\n');
		const newValue = currentValue 
			? `${currentValue}\n\n${bundleText}`
			: bundleText;
		onSelectExercises(newValue);
		setShowModal(false);
		setSelectedCondition(null);
	};

	const searchResults = searchQuery ? searchExercises(searchQuery) : [];

	return (
		<>
			<button
				type="button"
				onClick={() => setShowModal(true)}
				className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
			>
				<i className="fas fa-book-medical" aria-hidden="true" />
				Exercise Library
			</button>

			{showModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
							<h2 className="text-lg font-semibold text-slate-900">Exercise Library</h2>
							<button
								type="button"
								onClick={() => {
									setShowModal(false);
									setSelectedExercises(new Set());
									setSearchQuery('');
									setExpandedCategory(null);
									setSelectedCondition(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>

						<div className="flex-1 overflow-hidden flex flex-col">
							{/* Tabs */}
							<div className="border-b border-slate-200 px-6 flex-shrink-0">
								<nav className="flex gap-4">
									<button
										type="button"
										onClick={() => setActiveTab('joints')}
										className={`px-4 py-2 text-sm font-medium transition ${
											activeTab === 'joints'
												? 'border-b-2 border-sky-500 text-sky-600'
												: 'text-slate-600 hover:text-slate-900'
										}`}
									>
										By Joint
									</button>
									<button
										type="button"
										onClick={() => setActiveTab('conditions')}
										className={`px-4 py-2 text-sm font-medium transition ${
											activeTab === 'conditions'
												? 'border-b-2 border-sky-500 text-sky-600'
												: 'text-slate-600 hover:text-slate-900'
										}`}
									>
										By Condition
									</button>
									<button
										type="button"
										onClick={() => setActiveTab('search')}
										className={`px-4 py-2 text-sm font-medium transition ${
											activeTab === 'search'
												? 'border-b-2 border-sky-500 text-sky-600'
												: 'text-slate-600 hover:text-slate-900'
										}`}
									>
										Search
									</button>
								</nav>
							</div>

							{/* Content */}
							<div className="flex-1 overflow-y-auto px-6 py-4">
								{activeTab === 'joints' && (
									<div className="space-y-4">
										{JOINT_WISE_EXERCISES.map(category => (
											<div key={category.id} className="border border-slate-200 rounded-lg">
												<button
													type="button"
													onClick={() => setExpandedCategory(
														expandedCategory === category.id ? null : category.id
													)}
													className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition"
												>
													<span className="font-semibold text-slate-900">{category.name}</span>
													<i 
														className={`fas fa-chevron-${expandedCategory === category.id ? 'up' : 'down'} text-slate-400`}
														aria-hidden="true"
													/>
												</button>
												{expandedCategory === category.id && (
													<div className="p-4 space-y-3">
														{Object.entries(
															category.exercises.reduce((acc, ex) => {
																if (!acc[ex.category]) acc[ex.category] = [];
																acc[ex.category].push(ex);
																return acc;
															}, {} as Record<string, Exercise[]>)
														).map(([subcategory, exercises]) => (
															<div key={subcategory}>
																<h4 className="text-sm font-medium text-slate-700 mb-2">{subcategory}</h4>
																<div className="space-y-2">
																	{exercises.map(ex => (
																		<label
																			key={ex.id}
																			className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded"
																		>
																			<input
																				type="checkbox"
																				checked={selectedExercises.has(ex.name)}
																				onChange={() => handleExerciseToggle(ex.name)}
																				className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
																			/>
																			<span className="text-sm text-slate-700">{ex.name}</span>
																		</label>
																	))}
																</div>
															</div>
														))}
													</div>
												)}
											</div>
										))}
									</div>
								)}

								{activeTab === 'conditions' && (
									<div className="space-y-4">
										{CONDITION_BUNDLES.map(bundle => (
											<div key={bundle.id} className="border border-slate-200 rounded-lg">
												<div className="px-4 py-3 bg-slate-50">
													<h3 className="font-semibold text-slate-900 mb-1">{bundle.name}</h3>
													<p className="text-xs text-slate-600 mb-3">{bundle.description}</p>
													<div className="flex gap-2">
														<button
															type="button"
															onClick={() => handleSelectConditionBundle(bundle)}
															className="px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded hover:bg-sky-700 transition"
														>
															Insert Full Protocol
														</button>
														<button
															type="button"
															onClick={() => setSelectedCondition(
																selectedCondition === bundle.id ? null : bundle.id
															)}
															className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100 transition"
														>
															View Phases
														</button>
													</div>
												</div>
												{selectedCondition === bundle.id && (
													<div className="p-4 space-y-3">
														{bundle.phases.map((phase, idx) => (
															<div key={idx} className="border-l-2 border-sky-200 pl-3">
																<h4 className="font-medium text-slate-900 mb-1">{phase.phase}</h4>
																<p className="text-xs text-slate-600 mb-2">
																	Goals: {phase.goals.join(', ')}
																</p>
																{phase.progressCriteria && (
																	<p className="text-xs text-amber-600 mb-2">
																		⚠️ {phase.progressCriteria}
																	</p>
																)}
																<button
																	type="button"
																	onClick={() => handleSelectConditionBundle(bundle, idx)}
																	className="text-xs text-sky-600 hover:text-sky-700 font-medium transition"
																>
																	Insert Phase →
																</button>
															</div>
														))}
													</div>
												)}
											</div>
										))}
									</div>
								)}

								{activeTab === 'search' && (
									<div className="space-y-4">
										<input
											type="text"
											value={searchQuery}
											onChange={e => setSearchQuery(e.target.value)}
											placeholder="Search exercises..."
											className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
										{searchResults.length > 0 ? (
											<div className="space-y-2">
												{searchResults.map(ex => (
													<label
														key={ex.id}
														className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded border border-slate-200"
													>
														<input
															type="checkbox"
															checked={selectedExercises.has(ex.name)}
															onChange={() => handleExerciseToggle(ex.name)}
															className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
														/>
														<div>
															<span className="text-sm font-medium text-slate-900">{ex.name}</span>
															<span className="text-xs text-slate-500 ml-2">({ex.category})</span>
														</div>
													</label>
												))}
											</div>
										) : searchQuery ? (
											<p className="text-sm text-slate-500 text-center py-8">No exercises found</p>
										) : (
											<p className="text-sm text-slate-500 text-center py-8">Start typing to search exercises</p>
										)}
									</div>
								)}
							</div>

							{/* Footer */}
							{activeTab !== 'conditions' && selectedExercises.size > 0 && (
								<footer className="border-t border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
									<span className="text-sm text-slate-600">
										{selectedExercises.size} exercise{selectedExercises.size !== 1 ? 's' : ''} selected
									</span>
									<button
										type="button"
										onClick={handleInsertExercises}
										className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition"
									>
										Insert Selected
									</button>
								</footer>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}

