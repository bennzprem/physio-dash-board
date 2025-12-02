'use client';

export default function BugReportButton() {
	const handleBugReport = () => {
		const subject = encodeURIComponent('Bug Report - Center for Sports Science');
		const body = encodeURIComponent(
			'Please describe the bug you encountered:\n\n' +
			'Steps to reproduce:\n1. \n2. \n3. \n\n' +
			'Expected behavior:\n\n' +
			'Actual behavior:\n\n' +
			'Browser/Device:\n\n' +
			'Additional notes:'
		);
		window.location.href = `mailto:aarysasahas@gmail.com?subject=${subject}&body=${body}`;
	};

	return (
		<button
			type="button"
			onClick={handleBugReport}
			className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-red-500 to-pink-500 px-4 py-3 text-white shadow-lg hover:from-red-600 hover:to-pink-600 transition-all duration-200 hover:scale-105 hover:shadow-xl"
			title="Report a Bug"
			aria-label="Report a Bug"
		>
			<i className="fas fa-bug text-sm" aria-hidden="true" />
			<span className="text-sm font-semibold">Report a Bug</span>
		</button>
	);
}

