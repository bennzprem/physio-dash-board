'use client';

import PageHeader from '@/components/PageHeader';

export default function InventoryManagement() {
	return (
		<div className="min-h-svh bg-purple-50 px-6 py-10">
			<div className="mx-auto max-w-7xl">
				<PageHeader
					title="Inventory Management"
				/>

				<div className="mt-8 flex items-center justify-center min-h-[60vh]">
					<div className="text-center bg-white rounded-2xl shadow-lg p-12 max-w-2xl">
						<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-6">
							<i className="fas fa-boxes text-4xl text-indigo-500" aria-hidden="true" />
						</div>
						<h2 className="text-2xl font-bold text-slate-900 mb-4">Inventory Management</h2>
						<p className="text-lg text-slate-600 font-medium mb-2">This feature is pending</p>
						<p className="text-base text-slate-500">Need to be added</p>
					</div>
				</div>
			</div>
		</div>
	);
}

