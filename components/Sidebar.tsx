'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

export type SidebarLink = { href: string; label: string; icon: string };

interface SidebarProps {
	title: string;
	links: SidebarLink[];
	onLinkClick?: (href: string) => void;
	activeHref?: string;
	onProfileClick?: () => void;
}

interface UserProfile {
	userName?: string;
	profileImage?: string;
}

export default function Sidebar({ title, links, onLinkClick, activeHref, onProfileClick }: SidebarProps) {
	const pathname = usePathname();
	const router = useRouter();
	const { user } = useAuth();
	const [userProfile, setUserProfile] = useState<UserProfile>({});

	// Load user profile data
	useEffect(() => {
		const loadProfile = async () => {
			if (!user?.email) return;

			try {
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email));
				const querySnapshot = await getDocs(staffQuery);

				if (!querySnapshot.empty) {
					const data = querySnapshot.docs[0].data();
					setUserProfile({
						userName: data.userName || user.displayName || '',
						profileImage: data.profileImage || '',
					});
				} else {
					setUserProfile({
						userName: user.displayName || user.email?.split('@')[0] || '',
						profileImage: '',
					});
				}
			} catch (error) {
				console.error('Failed to load user profile:', error);
				setUserProfile({
					userName: user.displayName || user.email?.split('@')[0] || '',
					profileImage: '',
				});
			}
		};

		loadProfile();
	}, [user]);

	const handleLogout = useCallback(async () => {
		try {
			// Prefer Firebase signOut when available
			if (auth) {
				await signOut(auth);
			}
		} catch {
			// ignore Firebase errors; still proceed to local cleanup
		} finally {
			try {
				localStorage.removeItem('currentUser');
			} catch {
				// ignore storage errors
			}
			router.replace('/login');
		}
	}, [router]);

	return (
		<nav
			className="fixed left-0 top-0 z-40 flex h-svh w-64 flex-col overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-blue-600 text-white shadow-2xl"
			aria-label="Sidebar Navigation"
			suppressHydrationWarning
		>
			{/* Animated gradient overlays */}
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,_rgba(23,37,84,0.15),_transparent_50%)]" />
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,_rgba(30,64,175,0.1),_transparent_50%)]" />
				<div className="absolute top-0 left-0 w-[400px] h-[400px] bg-blue-800 rounded-full blur-[100px] opacity-15" />
				<div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-blue-600 rounded-full blur-[80px] opacity-10" />
			</div>
			<div className="relative flex flex-col h-full">
			<div className="px-5 py-4 border-b border-white/20">
				<h4 className="flex items-center text-lg font-semibold mb-3 text-white">
					<i className="fas fa-house-medical mr-2" aria-hidden="true" />
					{title}
				</h4>
				{/* Profile Section */}
				{onProfileClick ? (
					<button
						type="button"
						onClick={onProfileClick}
						className="flex w-full items-center gap-3 mt-4 pt-4 border-t border-white/20 hover:bg-white/10 rounded-lg px-2 py-2 transition"
					>
						<div className="flex-shrink-0">
							{userProfile.profileImage ? (
								<img
									src={userProfile.profileImage}
									alt={userProfile.userName || 'User'}
									className="h-12 w-12 rounded-full object-cover border-2 border-purple-200/50"
								/>
							) : (
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/30 border-2 border-purple-200/50">
									<i className="fas fa-user text-white text-lg" aria-hidden="true" />
								</div>
							)}
						</div>
						<div className="flex-1 min-w-0 text-left">
							<p className="text-xs text-purple-200 font-medium">Hi, Welcome</p>
							<p className="text-sm font-semibold text-white truncate">
								{userProfile.userName || user?.displayName || user?.email?.split('@')[0] || 'User'}
							</p>
						</div>
						<i className="fas fa-chevron-right text-purple-200/50 text-xs" aria-hidden="true" />
					</button>
				) : (
					<div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/20">
						<div className="flex-shrink-0">
							{userProfile.profileImage ? (
								<img
									src={userProfile.profileImage}
									alt={userProfile.userName || 'User'}
									className="h-12 w-12 rounded-full object-cover border-2 border-purple-200/50"
								/>
							) : (
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/30 border-2 border-purple-200/50">
									<i className="fas fa-user text-white text-lg" aria-hidden="true" />
								</div>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-xs text-purple-200 font-medium">Hi, Welcome</p>
							<p className="text-sm font-semibold text-white truncate">
								{userProfile.userName || user?.displayName || user?.email?.split('@')[0] || 'User'}
							</p>
						</div>
					</div>
				)}
			</div>

			<ul className="flex-1 space-y-1 px-2 py-3 overflow-y-auto" role="menu">
				{links.map(link => {
					const isActive = activeHref
						? activeHref === link.href
						: pathname === link.href ||
						  (pathname?.startsWith(link.href) && link.href !== '/');
					
					if (onLinkClick) {
						return (
							<li key={link.href} role="none">
								<button
									type="button"
									onClick={() => onLinkClick(link.href)}
									role="menuitem"
									className={[
										'flex w-full items-center rounded-xl px-3 py-2.5 text-sm transition text-left font-medium',
										isActive
											? 'bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white shadow-lg shadow-blue-900/40'
											: 'text-blue-100 hover:bg-blue-800/50 hover:text-white',
									].join(' ')}
									aria-current={isActive ? 'page' : undefined}
								>
									<i className={`${link.icon} mr-2 text-sm`} aria-hidden="true" />
									<span>{link.label}</span>
								</button>
							</li>
						);
					}
					
					return (
						<li key={link.href} role="none">
							<Link
								href={link.href}
								role="menuitem"
								className={[
									'flex items-center rounded-xl px-3 py-2.5 text-sm transition font-medium',
									isActive
										? 'bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white shadow-lg shadow-blue-900/40'
										: 'text-blue-100 hover:bg-blue-800/50 hover:text-white',
								].join(' ')}
								aria-current={isActive ? 'page' : undefined}
							>
								<i className={`${link.icon} mr-2 text-sm`} aria-hidden="true" />
								<span>{link.label}</span>
							</Link>
						</li>
					);
				})}
			</ul>

			<div className="mt-auto border-t border-white/20 px-2 py-3">
				<button
					type="button"
					onClick={handleLogout}
					className="flex w-full items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm px-3 py-2.5 text-sm font-medium text-red-100 hover:bg-red-500/20 hover:text-red-50 transition border border-white/10"
				>
					<i className="fas fa-sign-out-alt mr-2" aria-hidden="true" />
					Logout
				</button>
			</div>
			</div>
		</nav>
	);
}