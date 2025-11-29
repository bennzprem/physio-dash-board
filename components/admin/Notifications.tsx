'use client';

import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import NotificationCenter from '@/components/notifications/NotificationCenter';

export default function Notifications() {
	const { user } = useAuth();

	return (
		<div className="p-6">
			<PageHeader
				title="Notifications"
				description="Stay updated with all employee management changes, system alerts, and important updates."
			/>

			<div className="mt-6">
				<NotificationCenter
					userId={user?.uid || null}
					className=""
					emptyStateHint="You're all caught up! No notifications at the moment."
				/>
			</div>
		</div>
	);
}

