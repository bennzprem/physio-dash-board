'use client';

import { useState } from 'react';
import { 
	JOINT_WISE_SPECIAL_TESTS, 
	CONDITION_TEST_BUNDLES,
	type SpecialTest,
	type ConditionTestBundle,
	searchSpecialTests 
} from '@/lib/specialTestsLibrary';

interface SpecialTestsLibrarySelectorProps {
	onSelectTests: (tests: string) => void;
	currentValue?: string;
}

export default function SpecialTestsLibrarySelector({ 
	onSelectTests, 
	currentValue = ''
}: SpecialTestsLibrarySelectorProps) {
	const [showModal, setShowModal] = useState(false);
	const [activeTab, setActiveTab] = useState<'joints' | 'conditions' | 'search'>('joints');
	const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState('');
	const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
	const [selectedCondition, setSelectedCondition] = useState<string | null>(null);

	const handleTestToggle = (testName: string) => {
		const newSelected = new Set(selectedTests);
		if (newSelected.has(testName)) {
			newSelected.delete(testName);
		} else {
			newSelected.add(testName);
		}
		setSelectedTests(newSelected);
	};

	const handleInsertTests = () => {
		const testsList = Array.from(selectedTests).map(test => `• ${test}`).join('\n');
		const newValue = currentValue 
			? `${currentValue}\n\n${testsList}`
			: testsList;
		onSelectTests(newValue);
		setShowModal(false);
		setSelectedTests(new Set());
	};

	const handleSelectConditionBundle = (bundle: ConditionTestBundle) => {
		const tests: string[] = [];
		
		tests.push(`\n${bundle.name}:`);
		if (bundle.description) {
			tests.push(bundle.description);
		}
		if (bundle.structures && bundle.structures.length > 0) {
			tests.push(`Structures: ${bundle.structures.join(', ')}`);
		}
		
		if (bundle.primaryTests.length > 0) {
			tests.push('\nPrimary Tests:');
			bundle.primaryTests.forEach(test => tests.push(`• ${test.name}`));
		}
		
		if (bundle.secondaryTests && bundle.secondaryTests.length > 0) {
			tests.push('\nSecondary Tests:');
			bundle.secondaryTests.forEach(test => tests.push(`• ${test.name}`));
		}
		
		if (bundle.testCluster) {
			tests.push(`\nTest Cluster Rule: ${bundle.testCluster.rule}`);
		}
		
		if (bundle.diagnosticLogic) {
			tests.push(`\nDiagnostic Logic: ${bundle.diagnosticLogic}`);
		}
		
		if (bundle.warning) {
			tests.push(`\n⚠️ ${bundle.warning}`);
		}
		
		const bundleText = tests.join('\n');
		const newValue = currentValue 
			? `${currentValue}\n\n${bundleText}`
			: bundleText;
		onSelectTests(newValue);
		setShowModal(false);
		setSelectedCondition(null);
	};

	const searchResults = searchQuery ? searchSpecialTests(searchQuery) : [];

	return (
		<>
			<button
				type="button"
				onClick={() => setShowModal(true)}
				className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
			>
				<i className="fas fa-stethoscope" aria-hidden="true" />
				Special Tests Library
			</button>

			{showModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
							<h2 className="text-lg font-semibold text-slate-900">Special Tests Library</h2>
							<button
								type="button"
								onClick={() => {
									setShowModal(false);
									setSelectedTests(new Set());
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
										{JOINT_WISE_SPECIAL_TESTS.map(category => (
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
															category.tests.reduce((acc, ex) => {
																if (!acc[ex.category]) acc[ex.category] = [];
																acc[ex.category].push(ex);
																return acc;
															}, {} as Record<string, SpecialTest[]>)
														).map(([subcategory, tests]) => (
															<div key={subcategory}>
																<h4 className="text-sm font-medium text-slate-700 mb-2">{subcategory}</h4>
																<div className="space-y-2">
																	{tests.map(test => (
																		<label
																			key={test.id}
																			className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded"
																		>
																			<input
																				type="checkbox"
																				checked={selectedTests.has(test.name)}
																				onChange={() => handleTestToggle(test.name)}
																				className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
																			/>
																			<span className="text-sm text-slate-700">{test.name}</span>
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
										{CONDITION_TEST_BUNDLES.map(bundle => (
											<div key={bundle.id} className="border border-slate-200 rounded-lg">
												<div className="px-4 py-3 bg-slate-50">
													<div className="flex items-start justify-between mb-2">
														<div className="flex-1">
															<h3 className="font-semibold text-slate-900 mb-1">{bundle.name}</h3>
															{bundle.warning && (
																<p className="text-xs font-medium text-red-600 mb-1">⚠️ {bundle.warning}</p>
															)}
															<p className="text-xs text-slate-600">{bundle.description}</p>
															{bundle.structures && bundle.structures.length > 0 && (
																<p className="text-xs text-slate-500 mt-1">
																	Structures: {bundle.structures.join(', ')}
																</p>
															)}
														</div>
														<button
															type="button"
															onClick={() => handleSelectConditionBundle(bundle)}
															className="ml-4 px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded hover:bg-sky-700 transition flex-shrink-0"
														>
															Insert Protocol
														</button>
													</div>
													<button
														type="button"
														onClick={() => setSelectedCondition(
															selectedCondition === bundle.id ? null : bundle.id
														)}
														className="text-xs text-sky-600 hover:text-sky-700 font-medium transition"
													>
														{selectedCondition === bundle.id ? 'Hide Details' : 'View Details'}
													</button>
												</div>
												{selectedCondition === bundle.id && (
													<div className="p-4 space-y-3 border-t border-slate-200">
														{bundle.primaryTests.length > 0 && (
															<div>
																<h4 className="text-sm font-medium text-slate-900 mb-2">Primary Tests:</h4>
																<div className="space-y-1">
																	{bundle.primaryTests.map(test => (
																		<div key={test.id} className="text-sm text-slate-700 pl-4">
																			• {test.name}
																		</div>
																	))}
																</div>
															</div>
														)}
														{bundle.secondaryTests && bundle.secondaryTests.length > 0 && (
															<div>
																<h4 className="text-sm font-medium text-slate-900 mb-2">Secondary Tests:</h4>
																<div className="space-y-1">
																	{bundle.secondaryTests.map(test => (
																		<div key={test.id} className="text-sm text-slate-700 pl-4">
																			• {test.name}
																		</div>
																	))}
																</div>
															</div>
														)}
														{bundle.testCluster && (
															<div className="bg-amber-50 border border-amber-200 rounded p-3">
																<p className="text-xs font-medium text-amber-900">
																	Test Cluster Rule: {bundle.testCluster.rule}
																</p>
															</div>
														)}
														{bundle.diagnosticLogic && (
															<div className="bg-sky-50 border border-sky-200 rounded p-3">
																<p className="text-xs font-medium text-sky-900">
																	Diagnostic Logic: {bundle.diagnosticLogic}
																</p>
															</div>
														)}
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
											placeholder="Search special tests..."
											className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
										{searchResults.length > 0 ? (
											<div className="space-y-2">
												{searchResults.map(test => (
													<label
														key={test.id}
														className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded border border-slate-200"
													>
														<input
															type="checkbox"
															checked={selectedTests.has(test.name)}
															onChange={() => handleTestToggle(test.name)}
															className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
														/>
														<div>
															<span className="text-sm font-medium text-slate-900">{test.name}</span>
															<span className="text-xs text-slate-500 ml-2">({test.category})</span>
														</div>
													</label>
												))}
											</div>
										) : searchQuery ? (
											<p className="text-sm text-slate-500 text-center py-8">No tests found</p>
										) : (
											<p className="text-sm text-slate-500 text-center py-8">Start typing to search special tests</p>
										)}
									</div>
								)}
							</div>

							{/* Footer */}
							{(activeTab === 'joints' || activeTab === 'search') && selectedTests.size > 0 && (
								<footer className="border-t border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
									<span className="text-sm text-slate-600">
										{selectedTests.size} test{selectedTests.size !== 1 ? 's' : ''} selected
									</span>
									<button
										type="button"
										onClick={handleInsertTests}
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

