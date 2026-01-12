'use client';

export default function SOPViewer() {
	const handleDownloadPDF = () => {
		const link = document.createElement('a');
		link.href = '/SOP.pdf';
		link.download = 'SOP.pdf';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6">
				{/* Header Section */}
				<div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-2xl font-bold text-slate-900 mb-2">
								Standard Operating Procedures (SOP)
							</h1>
							<p className="text-sm text-slate-600">
								Company Standard Operating Procedures document
							</p>
						</div>
						<button
							type="button"
							onClick={handleDownloadPDF}
							className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
						>
							<i className="fas fa-download" aria-hidden="true" />
							Download PDF
						</button>
					</div>
				</div>

				{/* PDF Viewer Section */}
				<div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
					<iframe
						src="/SOP.pdf"
						className="w-full h-[calc(100vh-250px)] min-h-[600px] border-0"
						title="Standard Operating Procedures (SOP)"
					/>
				</div>
			</div>
		</div>
	);
}

