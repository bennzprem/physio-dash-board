'use client';

import { type ReactNode } from 'react';

interface StatusCardProps {
	label: string;
	value: string | ReactNode;
	subtitle?: string | ReactNode;
}

interface PageHeaderProps {
	badge?: string;
	title: string;
	description?: string;
	statusCard?: StatusCardProps;
	actions?: ReactNode;
	className?: string;
}

export default function PageHeader({
	badge,
	title,
	description,
	statusCard,
	actions,
	className = '',
}: PageHeaderProps) {
	return (
		<header className={`flex flex-col gap-3 md:flex-row md:items-start md:justify-between ${className}`}>
			<div className="flex-1">
				{badge ? (
					<p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{badge}</p>
				) : (
					<div className="h-5" aria-hidden="true" />
				)}
				<h1 className="mt-1 text-3xl font-semibold text-blue-900">{title}</h1>
				{description && (
					<p className="mt-2 text-sm text-blue-700 md:max-w-2xl">{description}</p>
				)}
			</div>
			{(statusCard || actions) && (
				<div className="flex flex-col items-end gap-2">
					{actions && <div className="flex items-center gap-2">{actions}</div>}
					{statusCard && (
						<div className="rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-lg">
							<p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
								{statusCard.label}
							</p>
							{typeof statusCard.value === 'string' ? (
								<p className="mt-1 text-sm font-medium text-blue-900">{statusCard.value}</p>
							) : (
								<div className="mt-1 text-sm font-medium text-blue-900">{statusCard.value}</div>
							)}
							{statusCard.subtitle && (
								typeof statusCard.subtitle === 'string' ? (
									<p className="text-xs text-blue-700">{statusCard.subtitle}</p>
								) : (
									<div className="text-xs text-blue-700">{statusCard.subtitle}</div>
								)
							)}
						</div>
					)}
				</div>
			)}
		</header>
	);
}

