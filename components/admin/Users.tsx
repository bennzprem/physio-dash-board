'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	updateDoc,
	Timestamp,
	addDoc,
	query,
	where,
	getDocs,
	getDoc,
	type QuerySnapshot,
} from 'firebase/firestore';

import { db, auth } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

type EmployeeRole = 'FrontDesk' | 'ClinicalTeam' | 'Physiotherapist' | 'StrengthAndConditioning' | 'Admin' | 'SuperAdmin';
type EmployeeStatus = 'Active' | 'Inactive';

interface Employee {
	id: string;
	userName: string;
	userEmail: string;
	role: EmployeeRole;
	status: EmployeeStatus;
	createdAt?: string | null;
	deleted?: boolean;
	deletedAt?: string | null;
	// Profile fields
	phone?: string;
	address?: string;
	dateOfBirth?: string;
	dateOfJoining?: string;
	gender?: string;
	bloodGroup?: string;
	emergencyContact?: string;
	emergencyPhone?: string;
	qualifications?: string;
	specialization?: string;
	experience?: string;
	professionalAim?: string;
	profileImage?: string;
}

type LimitedRoles = Extract<EmployeeRole, 'Admin' | 'SuperAdmin' | 'FrontDesk' | 'ClinicalTeam'>;
// SuperAdmin and Admin can create all roles, including SuperAdmin
const ALLOWED_ROLES: LimitedRoles[] = ['SuperAdmin', 'Admin', 'FrontDesk', 'ClinicalTeam'];

interface FormState {
	userName: string;
	userEmail: string;
	userRole: LimitedRoles;
	userStatus: EmployeeStatus;
	password: string;
}

const ROLE_LABELS: Record<EmployeeRole, string> = {
	SuperAdmin: 'Super Admin',
	Admin: 'Admin',
	FrontDesk: 'Front Desk',
	ClinicalTeam: 'Clinical Team',
	Physiotherapist: 'Physiotherapist',
	StrengthAndConditioning: 'Strength & Conditioning',
};

// Color mappings for roles - More vibrant and distinct colors
const ROLE_COLORS: Record<EmployeeRole, { bg: string; text: string }> = {
	SuperAdmin: { bg: 'bg-purple-100', text: 'text-purple-800' },
	Admin: { bg: 'bg-violet-100', text: 'text-violet-800' },
	FrontDesk: { bg: 'bg-cyan-100', text: 'text-cyan-800' },
	ClinicalTeam: { bg: 'bg-amber-100', text: 'text-amber-800' },
	Physiotherapist: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
	StrengthAndConditioning: { bg: 'bg-pink-100', text: 'text-pink-800' },
};

// Color mappings for status - More distinct colors
const STATUS_COLORS: Record<EmployeeStatus, { bg: string; text: string }> = {
	Active: { bg: 'bg-green-100', text: 'text-green-800' },
	Inactive: { bg: 'bg-red-100', text: 'text-red-800' },
};

const ROLE_OPTIONS: Array<{ value: FormState['userRole']; label: string }> = [
	{ value: 'SuperAdmin', label: 'Super Admin' },
	{ value: 'Admin', label: 'Admin' },
	{ value: 'FrontDesk', label: 'Front Desk' },
	{ value: 'ClinicalTeam', label: 'Clinical Team' },
];

const INITIAL_FORM: FormState = {
	userName: '',
	userEmail: '',
	userRole: 'FrontDesk',
	userStatus: 'Active',
	password: '',
};

function formatDate(iso?: string | null) {
	if (!iso) return '—';
	try {
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
			new Date(iso)
		);
	} catch {
		return '—';
	}
}

export default function Users() {
	const { user } = useAuth();
	const [employees, setEmployees] = useState<Employee[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [roleFilter, setRoleFilter] = useState<'all' | EmployeeRole>('all');
	
	// Check if current user is Admin (not SuperAdmin)
	const currentUserRole = user?.role?.trim();
	const isCurrentUserAdmin = currentUserRole === 'Admin' || currentUserRole?.toLowerCase() === 'admin';
	const isCurrentUserSuperAdmin = currentUserRole === 'SuperAdmin' || currentUserRole?.toLowerCase() === 'superadmin';
	
	// Helper function to check if an employee can be deleted by the current user
	const canDeleteEmployee = (employee: Employee): boolean => {
		// SuperAdmin can delete anyone
		if (isCurrentUserSuperAdmin) {
			return true;
		}
		// Admin cannot delete other Admins or SuperAdmins
		if (isCurrentUserAdmin) {
			const employeeRole = employee.role?.trim();
			const isEmployeeAdmin = employeeRole === 'Admin' || employeeRole?.toLowerCase() === 'admin';
			const isEmployeeSuperAdmin = employeeRole === 'SuperAdmin' || employeeRole?.toLowerCase() === 'superadmin';
			if (isEmployeeAdmin || isEmployeeSuperAdmin) {
				return false;
			}
		}
		return true;
	};

	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
	const [formState, setFormState] = useState<FormState>(INITIAL_FORM);
	const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
	const [feedbackDraft, setFeedbackDraft] = useState('');
	const [sendingFeedback, setSendingFeedback] = useState(false);
	const [employeeFeedback, setEmployeeFeedback] = useState<Array<{
		id: string;
		title: string;
		message: string;
		createdAt: string;
		messages?: Array<{
			id: string;
			senderId: string;
			senderName: string;
			message: string;
			createdAt: string;
		}>;
		threadId?: string;
		fromUserId?: string;
		fromUserName?: string;
	}>>([]);
	const [loadingFeedback, setLoadingFeedback] = useState(false);
	const [showEmployeeDetails, setShowEmployeeDetails] = useState(false);
	const [showDeletedEmployees, setShowDeletedEmployees] = useState(false);
	const [showActionsDropdown, setShowActionsDropdown] = useState(false);
	const [deleteConfirmation, setDeleteConfirmation] = useState<{ employee: Employee | null; nameInput: string }>({ employee: null, nameInput: '' });
	
	// Performance metrics data for ClinicalTeam
	const [clinicalAppointments, setClinicalAppointments] = useState<Array<{
		patientId: string;
		doctor: string;
		status: string;
	}>>([]);
	const [clinicalPatients, setClinicalPatients] = useState<Array<{
		patientId: string;
		assignedDoctor: string;
		patientType: string;
		status: string;
	}>>([]);
	const [clinicalBilling, setClinicalBilling] = useState<Array<{
		doctor: string;
		amount: number;
		status: string;
	}>>([]);
	const [clinicalActivities, setClinicalActivities] = useState<Array<{
		staffEmail: string;
		activityType: string;
	}>>([]);

	useEffect(() => {
		setLoading(true);

		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			snapshot => {
				const records: Employee[] = snapshot.docs
					.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
					const deleted = (data.deletedAt as { toDate?: () => Date } | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						userName: String(data.userName ?? ''),
						userEmail: String(data.userEmail ?? ''),
						role: (data.role as EmployeeRole) ?? 'FrontDesk',
						status: (data.status as EmployeeStatus) ?? 'Active',
						createdAt: created
							? created.toISOString()
							: typeof data.createdAt === 'string'
								? (data.createdAt as string)
								: null,
						deleted: data.deleted === true,
						deletedAt: deleted
							? deleted.toISOString()
							: typeof data.deletedAt === 'string'
								? (data.deletedAt as string)
								: null,
						// Profile fields
						phone: data.phone ? String(data.phone) : undefined,
						address: data.address ? String(data.address) : undefined,
						dateOfBirth: data.dateOfBirth ? String(data.dateOfBirth) : undefined,
						dateOfJoining: data.dateOfJoining ? String(data.dateOfJoining) : undefined,
						gender: data.gender ? String(data.gender) : undefined,
						bloodGroup: data.bloodGroup ? String(data.bloodGroup) : undefined,
						emergencyContact: data.emergencyContact ? String(data.emergencyContact) : undefined,
						emergencyPhone: data.emergencyPhone ? String(data.emergencyPhone) : undefined,
						qualifications: data.qualifications ? String(data.qualifications) : undefined,
						specialization: data.specialization ? String(data.specialization) : undefined,
						experience: data.experience ? String(data.experience) : undefined,
						professionalAim: data.professionalAim ? String(data.professionalAim) : (data.notes ? String(data.notes) : undefined), // Support both old and new field names
						profileImage: data.profileImage ? String(data.profileImage) : undefined,
					};
					})
					.filter(record => ALLOWED_ROLES.includes(record.role as LimitedRoles))
					.sort((a, b) => a.userName.localeCompare(b.userName));

				setEmployees(records);
				setLoading(false);
			},
			err => {
				console.error('Failed to load employees', err);
				setError('Unable to load employees. Please try again later.');
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	const filteredEmployees = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		return employees.filter(employee => {
			// Filter by deleted status
			const isDeleted = employee.deleted === true;
			if (showDeletedEmployees && !isDeleted) return false;
			if (!showDeletedEmployees && isDeleted) return false;

			const matchesSearch =
				!query ||
				employee.userName.toLowerCase().includes(query) ||
				employee.userEmail.toLowerCase().includes(query) ||
				ROLE_LABELS[employee.role].toLowerCase().includes(query);

			const matchesRole = roleFilter === 'all' || employee.role === roleFilter;

			return matchesSearch && matchesRole;
		});
	}, [employees, searchTerm, roleFilter, showDeletedEmployees]);

	const analytics = useMemo(() => {
		const activeEmployees = employees.filter(emp => !emp.deleted);
		const total = activeEmployees.length;
		const active = activeEmployees.filter(emp => emp.status === 'Active').length;
		const inactive = total - active;
		const frontDesk = activeEmployees.filter(emp => emp.role === 'FrontDesk').length;
		const clinical = activeEmployees.filter(emp => emp.role === 'ClinicalTeam').length;
		const adminCount = activeEmployees.filter(emp => emp.role === 'Admin').length;
		const superAdminCount = activeEmployees.filter(emp => emp.role === 'SuperAdmin').length;
		const deletedCount = employees.filter(emp => emp.deleted === true).length;

		return { total, active, inactive, frontDesk, clinical, adminCount, superAdminCount, deletedCount };
	}, [employees]);

	const openCreateDialog = () => {
		setEditingEmployee(null);
		setFormState(INITIAL_FORM);
		setIsDialogOpen(true);
		setError(null);
	};

	const openEditDialog = (employee: Employee | null) => {
		if (!employee) return;
		setEditingEmployee(employee);
		setFormState({
			userName: employee.userName,
			userEmail: employee.userEmail,
			userRole: ALLOWED_ROLES.includes(employee.role as LimitedRoles)
				? (employee.role as LimitedRoles)
				: 'FrontDesk',
			userStatus: employee.status,
			password: '',
		});
		setIsDialogOpen(true);
		setError(null);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		setEditingEmployee(null);
		setFormState(INITIAL_FORM);
		// Don't close the view profile when closing edit dialog
	};

	// Function to notify all admins (excluding the current admin)
	const notifyAllAdmins = async (title: string, message: string, category: string, metadata?: Record<string, any>) => {
		if (!user?.uid) {
			console.warn('Cannot send notifications: user not logged in');
			return;
		}

		try {
			// Get all active admins and super admins from staff collection
			// Note: We query for Admin/SuperAdmin role and Active status, then filter out deleted in code
			// This avoids needing a composite index for deleted field
			// We need to query separately for Admin and SuperAdmin roles
			const adminQuery = query(
				collection(db, 'staff'),
				where('role', '==', 'Admin'),
				where('status', '==', 'Active')
			);
			const superAdminQuery = query(
				collection(db, 'staff'),
				where('role', '==', 'SuperAdmin'),
				where('status', '==', 'Active')
			);
			const [adminSnapshot, superAdminSnapshot] = await Promise.all([
				getDocs(adminQuery),
				getDocs(superAdminQuery)
			]);
			const allAdmins = [...adminSnapshot.docs, ...superAdminSnapshot.docs];
			
			const adminIds: string[] = [];
			allAdmins.forEach((docSnap) => {
				const data = docSnap.data();
				// Exclude deleted admins and the current admin
				if (!data.deleted && docSnap.id !== user.uid) {
					adminIds.push(docSnap.id);
				}
			});

			if (adminIds.length === 0) {
				console.log('No other admins to notify');
				return;
			}

			// Create notifications for all other admins
			const notificationPromises = adminIds.map((adminId) =>
				addDoc(collection(db, 'notifications'), {
					userId: adminId,
					title,
					message,
					category,
					status: 'unread',
					createdAt: serverTimestamp(),
					channels: {
						inApp: true,
					},
					metadata: metadata || {},
				})
			);

			await Promise.all(notificationPromises);
			console.log(`✅ Notifications sent to ${adminIds.length} admin(s)`);
		} catch (error: any) {
			console.error('Failed to send admin notifications:', error);
			// Log more details for debugging
			if (error?.code === 'permission-denied') {
				console.error('Permission denied. Make sure Firestore rules allow notifications collection access.');
			} else if (error?.code === 'failed-precondition') {
				console.error('Firestore index required. The query may need a composite index.');
			}
			// Don't throw - notification failure shouldn't block the operation
		}
	};

	// Function to disable/enable Firebase Auth user
	const updateAuthUserStatus = async (uid: string, disabled: boolean) => {
		if (!user?.uid) {
			throw new Error('You must be logged in to update authentication status.');
		}

		const currentUser = auth.currentUser;
		if (!currentUser) {
			throw new Error('Your admin session expired. Please sign in again and retry.');
		}

		const token = await currentUser.getIdToken();
		const response = await fetch('/api/admin/users', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				uid,
				disabled,
			}),
		});

		const data = await response.json();
		if (!response.ok || data?.status !== 'ok') {
			throw new Error(data?.message || 'Failed to update authentication status.');
		}
		return data;
	};

	const handleDeleteClick = (employee: Employee) => {
		setError(null);
		setDeleteConfirmation({ employee, nameInput: '' });
	};

	const handleDeleteConfirm = async () => {
		if (!deleteConfirmation.employee) return;

		const employee = deleteConfirmation.employee;
		
		// Check if current user can delete this employee
		if (!canDeleteEmployee(employee)) {
			setError('You do not have permission to delete this employee. Only Super Admins can delete Admins and Super Admins.');
			setDeleteConfirmation({ employee: null, nameInput: '' });
			return;
		}
		
		const enteredName = deleteConfirmation.nameInput.trim();
		const correctName = employee.userName.trim();

		// Check if the entered name matches exactly (case-insensitive)
		if (enteredName.toLowerCase() !== correctName.toLowerCase()) {
			setError('The name you entered does not match. Please type the employee name exactly as shown.');
			return;
		}

		setSaving(true);
		setError(null);
		setDeleteConfirmation({ employee: null, nameInput: '' });

		try {
			// Soft delete the employee in Firestore
			await updateDoc(doc(db, 'staff', employee.id), {
				deleted: true,
				deletedAt: serverTimestamp(),
				status: 'Inactive', // Also set status to Inactive
			});

			// Disable Firebase Auth user if they have an authUid
			const employeeDoc = await getDoc(doc(db, 'staff', employee.id));
			const employeeData = employeeDoc.data();
			const authUid = employeeData?.authUid || employee.id; // Use authUid if available, otherwise use employee.id

			try {
				await updateAuthUserStatus(authUid, true); // Disable the user
				console.log(`✅ Firebase Auth user disabled for ${employee.userName}`);
			} catch (authError: any) {
				console.warn('Failed to disable Firebase Auth user:', authError);
				// Don't fail the entire operation if auth update fails
				// The employee is already soft-deleted in Firestore
			}

			// Notify all other admins
			const currentAdminName = user?.displayName || user?.email || 'An admin';
			const currentUserId = user?.uid || '';
			await notifyAllAdmins(
				'👤 Employee Removed',
				`${currentAdminName} has removed employee "${employee.userName}" (${employee.userEmail}) from the system.`,
				'employee-deleted',
				{
					employeeId: employee.id,
					employeeName: employee.userName,
					employeeEmail: employee.userEmail,
					employeeRole: employee.role,
					deletedBy: currentUserId,
					deletedByName: currentAdminName,
				}
			);

			// Create app notification
			await addDoc(collection(db, 'appNotifications'), {
				type: 'employee_deleted',
				title: '👤 Employee Deleted',
				message: `${employee.userName} has been deleted by ${currentAdminName}.`,
				createdAt: serverTimestamp(),
				read: false,
				metadata: {
					employeeId: employee.id,
					employeeName: employee.userName,
					deletedBy: currentUserId,
					deletedByName: currentAdminName,
				},
			});
		} catch (err) {
			console.error('Failed to delete employee', err);
			setError('Unable to remove employee. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const handleDeleteCancel = () => {
		setDeleteConfirmation({ employee: null, nameInput: '' });
		setError(null);
	};

	const createAuthAccount = async (params: {
		email: string;
		password: string;
		displayName: string;
		role: string;
	}) => {
		const currentUser = auth.currentUser;
		if (!currentUser) {
			throw new Error('Your admin session expired. Please sign in again and retry.');
		}
		
		// Verify user is admin or super admin (case-insensitive check)
		// Note: The API route will also verify admin access, so this is a client-side check
		const userRole = user?.role?.trim();
		const isAdmin = userRole === 'Admin' || userRole?.toLowerCase() === 'admin';
		const isSuperAdmin = userRole === 'SuperAdmin' || userRole?.toLowerCase() === 'superadmin';
		if (!userRole || (!isAdmin && !isSuperAdmin)) {
			console.warn('User role check failed:', { 
				userRole, 
				userId: user?.uid, 
				userEmail: user?.email,
				hasUser: !!user 
			});
			// Still allow the request to proceed - the API route will verify admin access
			// This provides a better UX by catching obvious issues early
			if (!userRole) {
				throw new Error('Unable to verify admin access. Your role information is missing. Please refresh the page and try again. If the problem persists, contact your administrator.');
			}
			throw new Error(`Only admins or super admins can create employee accounts. Your current role is: ${userRole}. Please contact an administrator if you believe this is an error.`);
		}
		
		let token: string;
		try {
			token = await currentUser.getIdToken();
		} catch (tokenError: any) {
			throw new Error('Failed to get authentication token. Please sign in again and retry.');
		}
		
		let response: Response;
		try {
			response = await fetch('/api/admin/users', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					...params,
					requestingUserRole: user?.role ?? undefined,
				}),
			});
		} catch (fetchError: any) {
			// Network error (fetch failed)
			if (fetchError?.message?.includes('fetch') || fetchError?.message?.includes('network') || fetchError?.code === 'auth/network-request-failed') {
				throw new Error('Network error: Unable to connect to the server. Please check your internet connection and try again. If the problem persists, the server may be down or Firebase Admin SDK may not be configured.');
			}
			throw fetchError;
		}
		
		let data: any;
		try {
			data = await response.json();
		} catch (jsonError) {
			throw new Error(`Server returned invalid response (status: ${response.status}). Please try again or contact support.`);
		}
		
		if (!response.ok || data?.status !== 'ok') {
			const errorMsg = data?.message || 'Failed to create authentication user.';
			// Provide more helpful error messages
			if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('connect')) {
				throw new Error('Network error: Unable to connect to Firebase servers. This may be due to:\n' +
					'• Network connectivity issues\n' +
					'• Firebase Admin SDK not configured (see FIREBASE_ADMIN_SETUP.md)\n' +
					'• Server firewall blocking connections\n\n' +
					'Please check your internet connection and ensure Firebase Admin credentials are properly configured.');
			}
			throw new Error(errorMsg);
		}
		return data.user as { uid: string; email: string; displayName: string; role: string };
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);

		const trimmedName = formState.userName.trim();
		const trimmedEmail = formState.userEmail.trim().toLowerCase();
		const trimmedPassword = formState.password.trim();

		if (!trimmedName || !trimmedEmail) {
			setError('Name and email are required.');
			return;
		}

		if (!editingEmployee) {
			if (!trimmedPassword) {
				setError('Password is required when creating a new employee login.');
				return;
			}
			if (trimmedPassword.length < 6) {
				setError('Password must be at least 6 characters long.');
				return;
			}
		}

		setSaving(true);
		try {
			if (editingEmployee) {
				// Track what changed
				const previousStatus = editingEmployee.status;
				const previousRole = editingEmployee.role;
				const previousName = editingEmployee.userName;
				const newStatus = formState.userStatus;
				const newRole = formState.userRole;
				const statusChanged = previousStatus !== newStatus;
				const roleChanged = previousRole !== newRole;
				const nameChanged = previousName !== trimmedName;
				const hasChanges = statusChanged || roleChanged || nameChanged;

				// Update existing employee
				await updateDoc(doc(db, 'staff', editingEmployee.id), {
					userName: trimmedName,
					role: formState.userRole,
					status: formState.userStatus,
				});

				// Update Firebase Auth user status if status changed
				if (statusChanged) {
					// Get the authUid from the document (use employee.id as fallback)
					const employeeDoc = await getDoc(doc(db, 'staff', editingEmployee.id));
					const employeeData = employeeDoc.data();
					const authUid = employeeData?.authUid || editingEmployee.id;
					
					try {
						// Disable if status changed to Inactive, enable if changed to Active
						const shouldDisable = newStatus === 'Inactive';
						await updateAuthUserStatus(authUid, shouldDisable);
						console.log(`✅ Firebase Auth user ${shouldDisable ? 'disabled' : 'enabled'} for ${trimmedName}`);
					} catch (authError: any) {
						console.warn('Failed to update Firebase Auth user status:', authError);
						// Don't fail the entire operation if auth update fails
						// The employee status is already updated in Firestore
					}
				}

				// Notify all other admins about the employee update
				if (hasChanges) {
					const currentAdminName = user?.displayName || user?.email || 'An admin';
					const changes: string[] = [];
					
					if (nameChanged) {
						changes.push(`name from "${previousName}" to "${trimmedName}"`);
					}
					if (roleChanged) {
						changes.push(`role from "${previousRole}" to "${newRole}"`);
					}
					if (statusChanged) {
						changes.push(`status from "${previousStatus}" to "${newStatus}"`);
					}
					
					const changeMessage = changes.length > 0 
						? `Updated ${changes.join(', ')}`
						: 'Updated employee details';
					
					await notifyAllAdmins(
						'📝 Employee Updated',
						`${currentAdminName} has updated employee "${trimmedName}" (${editingEmployee.userEmail}): ${changeMessage}.`,
						'employee-updated',
						{
							employeeId: editingEmployee.id,
							employeeName: trimmedName,
							employeeEmail: editingEmployee.userEmail,
							previousRole,
							newRole,
							previousStatus,
							newStatus,
							previousName,
							newName: trimmedName,
							updatedBy: user?.uid,
							updatedByName: currentAdminName,
							changes: {
								name: nameChanged,
								role: roleChanged,
								status: statusChanged,
							},
						}
					);
				}
			} else {
				try {
					const authUser = await createAuthAccount({
						email: trimmedEmail,
						password: trimmedPassword,
						displayName: trimmedName,
						role: formState.userRole,
					});

					await setDoc(doc(db, 'staff', authUser.uid), {
						authUid: authUser.uid,
						userName: trimmedName,
						userEmail: trimmedEmail,
						role: formState.userRole,
						status: formState.userStatus,
						createdAt: serverTimestamp(),
					});

					// Notify all other admins about the new employee
					const currentAdminName = user?.displayName || user?.email || 'An admin';
					await notifyAllAdmins(
						'✅ New Employee Added',
						`${currentAdminName} has added a new employee: "${trimmedName}" (${trimmedEmail}) as ${formState.userRole}.`,
						'employee-added',
						{
							employeeId: authUser.uid,
							employeeName: trimmedName,
							employeeEmail: trimmedEmail,
							employeeRole: formState.userRole,
							addedBy: user?.uid,
							addedByName: currentAdminName,
						}
					);
				} catch (err: any) {
					console.error('Failed to create employee login:', err);
					const errorMsg = err?.message || err?.toString() || 'Unknown error';
					setError(
						'❌ Failed to create employee login.\n\n' +
						errorMsg +
						'\n\nPlease ensure:\n' +
						'• You are signed in as an admin\n' +
						'• Firebase Admin credentials are configured (see FIREBASE_ADMIN_SETUP.md)\n' +
						'• Firestore rules allow writes\n'
					);
					setSaving(false);
					return;
				}
			}
			closeDialog();
		} catch (err: any) {
			console.error('Failed to save employee', err);
			const errorMsg = err?.message || err?.toString() || 'Unknown error';
			setError(
				'❌ Error: ' + errorMsg + '\n\n' +
				'Please check the browser console (F12) for details.'
			);
		} finally {
			setSaving(false);
		}
	};

	// Accept nullable since we call these with selectedEmployee which can be null
	const handleResetPassword = async (employee: Employee | null) => {
		if (!employee) return;
		// Create a temp password and show to admin — replace with API call to update in Auth if needed
		const tempPassword = Math.random().toString(36).slice(-8);
		alert(`Temporary password for ${employee.userEmail}: ${tempPassword}\n\n(Show this to the user and/or update the Auth account through your admin API.)`);
	};

	const handleSendResetEmail = async (employee: Employee | null) => {
		if (!employee) return;
		// Placeholder behavior: show an alert. Replace with real sendPasswordResetEmail(auth, email) call if you want.
		alert(`A password reset email would be sent to ${employee.userEmail} (placeholder).`);
	};

	const handleToggleStatus = async (employee: Employee) => {
		const nextStatus: EmployeeStatus = employee.status === 'Active' ? 'Inactive' : 'Active';
		try {
			await updateDoc(doc(db, 'staff', employee.id), { status: nextStatus });
			alert(`${employee.userName} is now ${nextStatus}.`);
		} catch (err) {
			console.error('Failed to toggle status', err);
			alert('Unable to update status. Please try again.');
		}
	};

	const handleExportCSV = () => {
		// Prepare CSV headers
		const headers = ['Name', 'Email', 'Role', 'Status', 'Created Date'];
		
		// Prepare CSV rows from filtered employees
		const rows = filteredEmployees.map(employee => [
			employee.userName,
			employee.userEmail,
			ROLE_LABELS[employee.role],
			employee.status,
			formatDate(employee.createdAt),
		]);

		// Combine headers and rows
		const csvContent = [
			headers.join(','),
			...rows.map(row => 
				row.map(cell => {
					// Escape commas and quotes in cell values
					const cellValue = String(cell || '');
					if (cellValue.includes(',') || cellValue.includes('"') || cellValue.includes('\n')) {
						return `"${cellValue.replace(/"/g, '""')}"`;
					}
					return cellValue;
				}).join(',')
			),
		].join('\n');

		// Create blob and download
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const link = document.createElement('a');
		const url = URL.createObjectURL(blob);
		link.setAttribute('href', url);
		link.setAttribute('download', `employees_export_${new Date().toISOString().split('T')[0]}.csv`);
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	const handleExportEmployeeDetailsCSV = () => {
		// Prepare CSV headers with all profile fields
		const headers = [
			'Name',
			'Email',
			'Role',
			'Status',
			'Phone',
			'Address',
			'Date of Birth',
			'Date of Joining',
			'Gender',
			'Blood Group',
			'Emergency Contact',
			'Emergency Phone',
			'Qualifications',
			'Specialization',
			'Experience',
			'Professional Aim',
			'Created Date',
			'Deleted',
			'Deleted Date',
		];
		
		// Prepare CSV rows from all employees (not just filtered)
		const rows = employees.map(employee => [
			employee.userName || '',
			employee.userEmail || '',
			ROLE_LABELS[employee.role] || '',
			employee.status || '',
			employee.phone || '',
			employee.address || '',
			employee.dateOfBirth || '',
			employee.dateOfJoining || '',
			employee.gender || '',
			employee.bloodGroup || '',
			employee.emergencyContact || '',
			employee.emergencyPhone || '',
			employee.qualifications || '',
			employee.specialization || '',
			employee.experience || '',
			employee.professionalAim || '',
			formatDate(employee.createdAt),
			employee.deleted ? 'Yes' : 'No',
			employee.deletedAt ? formatDate(employee.deletedAt) : '',
		]);

		// Combine headers and rows
		const csvContent = [
			headers.join(','),
			...rows.map(row => 
				row.map(cell => {
					// Escape commas and quotes in cell values
					const cellValue = String(cell || '');
					if (cellValue.includes(',') || cellValue.includes('"') || cellValue.includes('\n')) {
						return `"${cellValue.replace(/"/g, '""')}"`;
					}
					return cellValue;
				}).join(',')
			),
		].join('\n');

		// Create blob and download
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const link = document.createElement('a');
		const url = URL.createObjectURL(blob);
		link.setAttribute('href', url);
		link.setAttribute('download', `employee_details_export_${new Date().toISOString().split('T')[0]}.csv`);
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	const handleSendFeedback = async () => {
		if (!selectedEmployee || !feedbackDraft.trim() || !user?.uid) return;

		setSendingFeedback(true);
		try {
			// Verify employee document exists
			const employeeDoc = await getDoc(doc(db, 'staff', selectedEmployee.id));
			
			if (!employeeDoc.exists()) {
				throw new Error('Employee document not found. Please refresh and try again.');
			}

			const employeeData = employeeDoc.data();
			let employeeUserId = employeeData?.authUid;

			// If no authUid in staff document, try to find it in users collection by email
			if (!employeeUserId && selectedEmployee.userEmail) {
				try {
					const usersQuery = query(
						collection(db, 'users'),
						where('email', '==', selectedEmployee.userEmail.toLowerCase())
					);
					const usersSnapshot = await getDocs(usersQuery);
					if (!usersSnapshot.empty) {
						// The document ID in users collection is the Firebase Auth UID
						employeeUserId = usersSnapshot.docs[0].id;
					}
				} catch (queryError: any) {
					console.warn('Failed to query users collection for userId:', queryError);
					// Continue with fallback
				}
			}

			// Final fallback: use staff document ID (though this may not work for notifications)
			if (!employeeUserId) {
				employeeUserId = selectedEmployee.id;
				console.warn(`Using staff document ID as userId fallback for employee ${selectedEmployee.userName}. This may not work if employee hasn't logged in.`);
			}

			// Create a thread ID for this conversation
			const threadId = `feedback-${selectedEmployee.id}-${user.uid}`;

			// Generate message ID
			const messageId = typeof crypto !== 'undefined' && (crypto as any).randomUUID 
				? (crypto as any).randomUUID() 
				: `${Date.now()}-${Math.random().toString(36).slice(2)}`;

			// Create notification with message thread
			await addDoc(collection(db, 'notifications'), {
				userId: employeeUserId,
				title: 'Remarks and Feedback',
				message: feedbackDraft.trim(),
				category: 'feedback',
				status: 'unread',
				createdAt: serverTimestamp(),
				threadId: threadId,
				messages: [
					{
						id: messageId,
						senderId: user.uid,
						senderName: user.displayName || user.email || 'Admin',
						message: feedbackDraft.trim(),
						createdAt: new Date().toISOString(),
					},
				],
				fromUserId: user.uid,
				fromUserName: user.displayName || user.email || 'Admin',
				metadata: {
					employeeId: selectedEmployee.id,
					employeeName: selectedEmployee.userName,
					employeeEmail: selectedEmployee.userEmail,
				},
				channels: {
					inApp: true,
				},
			});

			setFeedbackDraft('');
			// The feedback list will automatically update via the onSnapshot listener
			alert('Feedback sent successfully!');
		} catch (error: any) {
			console.error('Failed to send feedback:', error);
			const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
			alert(`Failed to send feedback: ${errorMessage}\n\nPlease check the browser console for more details.`);
		} finally {
			setSendingFeedback(false);
		}
	};

	// Helper function to normalize names for comparison
	const normalize = (value?: string | null): string => {
		if (!value) return '';
		return value.trim().toLowerCase().replace(/\s+/g, ' ');
	};

	// Load appointments for ClinicalTeam metrics
	useEffect(() => {
		if (!selectedEmployee || selectedEmployee.role !== 'ClinicalTeam') {
			setClinicalAppointments([]);
			return;
		}

		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const appointments = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						patientId: data.patientId ? String(data.patientId) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						status: data.status ? String(data.status) : 'pending',
					};
				});
				setClinicalAppointments(appointments);
			},
			error => {
				console.error('Failed to load appointments:', error);
				setClinicalAppointments([]);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee]);

	// Load patients for ClinicalTeam metrics
	useEffect(() => {
		if (!selectedEmployee || selectedEmployee.role !== 'ClinicalTeam') {
			setClinicalPatients([]);
			return;
		}

		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const patients = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						patientId: data.patientId ? String(data.patientId) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : '',
						patientType: data.patientType ? String(data.patientType).toUpperCase() : '',
						status: data.status ? String(data.status) : 'pending',
					};
				});
				setClinicalPatients(patients);
			},
			error => {
				console.error('Failed to load patients:', error);
				setClinicalPatients([]);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee]);

	// Load billing for ClinicalTeam metrics
	useEffect(() => {
		if (!selectedEmployee || selectedEmployee.role !== 'ClinicalTeam') {
			setClinicalBilling([]);
			return;
		}

		const unsubscribe = onSnapshot(
			collection(db, 'billing'),
			(snapshot: QuerySnapshot) => {
				const billing = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						doctor: data.doctor ? String(data.doctor) : '',
						amount: data.amount ? Number(data.amount) : 0,
						status: data.status ? String(data.status) : 'pending',
					};
				});
				setClinicalBilling(billing);
			},
			error => {
				console.error('Failed to load billing:', error);
				setClinicalBilling([]);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee]);

	// Load activities for ClinicalTeam metrics
	useEffect(() => {
		if (!selectedEmployee || selectedEmployee.role !== 'ClinicalTeam') {
			setClinicalActivities([]);
			return;
		}

		const unsubscribe = onSnapshot(
			collection(db, 'activities'),
			(snapshot: QuerySnapshot) => {
				const activities = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						staffEmail: data.staffEmail ? String(data.staffEmail) : '',
						activityType: data.activityType ? String(data.activityType) : '',
					};
				});
				setClinicalActivities(activities);
			},
			error => {
				console.error('Failed to load activities:', error);
				setClinicalActivities([]);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee]);

	// Load feedback for selected employee
	useEffect(() => {
		if (!selectedEmployee) {
			setEmployeeFeedback([]);
			return;
		}

		setLoadingFeedback(true);
		const unsubscribe = onSnapshot(
			query(
				collection(db, 'notifications'),
				where('category', '==', 'feedback')
			),
			(snapshot: QuerySnapshot) => {
				const feedback = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data();
						const createdAt = data.createdAt?.toDate?.()?.toISOString() || data.createdAt || '';
						return {
							id: docSnap.id,
							title: data.title || 'Remarks and Feedback',
							message: data.message || '',
							createdAt,
							messages: data.messages || [],
							threadId: data.threadId,
							fromUserId: data.fromUserId,
							fromUserName: data.fromUserName,
							metadata: data.metadata || {},
						};
					})
					.filter(notif => {
						// Filter by employeeId in metadata
						const metadata = notif.metadata as any;
						return metadata.employeeId === selectedEmployee.id;
					})
					.sort((a, b) => {
						// Sort by creation date, newest first
						return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
					});
				setEmployeeFeedback(feedback);
				setLoadingFeedback(false);
			},
			error => {
				console.error('Failed to load feedback:', error);
				setEmployeeFeedback([]);
				setLoadingFeedback(false);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee]);

	// Calculate performance metrics
	const clinicalMetrics = useMemo(() => {
		if (!selectedEmployee || selectedEmployee.role !== 'ClinicalTeam') {
			return {
				activePatients: 0,
				revenue: 0,
				totalSessions: 0,
				patientsByType: { DYES: 0, PAID: 0, VIP: 0, GETHNA: 0 },
				activitiesByType: {} as Record<string, number>,
				loading: false,
			};
		}

		const employeeName = normalize(selectedEmployee.userName);
		const employeeEmail = selectedEmployee.userEmail;

		// Filter appointments for this employee
		const employeeAppointments = clinicalAppointments.filter(apt => 
			normalize(apt.doctor) === employeeName && apt.status === 'completed'
		);

		// Active patients (ongoing status, assigned to this employee)
		const activePatients = clinicalPatients.filter(p => 
			normalize(p.assignedDoctor) === employeeName && p.status === 'ongoing'
		).length;

		// Get unique patient IDs from appointments
		const uniquePatientIds = new Set(
			employeeAppointments.map(apt => apt.patientId).filter(Boolean)
		);

		// Patients by type
		const patientsByType = { DYES: 0, PAID: 0, VIP: 0, GETHNA: 0 };
		uniquePatientIds.forEach(patientId => {
			const patient = clinicalPatients.find(p => p.patientId === patientId);
			if (patient) {
				const type = patient.patientType;
				if (type === 'DYES') patientsByType.DYES++;
				else if (type === 'PAID') patientsByType.PAID++;
				else if (type === 'VIP') patientsByType.VIP++;
				else if (type === 'GETHNA') patientsByType.GETHNA++;
			}
		});

		// Calculate revenue (completed billing for this employee)
		const revenue = clinicalBilling
			.filter(bill => normalize(bill.doctor) === employeeName && bill.status === 'completed')
			.reduce((sum, bill) => sum + bill.amount, 0);

		// Activities by type for this employee
		const activitiesByType: Record<string, number> = {};
		clinicalActivities
			.filter(act => act.staffEmail === employeeEmail)
			.forEach(act => {
				const type = act.activityType || 'Other';
				activitiesByType[type] = (activitiesByType[type] || 0) + 1;
			});

		return {
			activePatients,
			revenue,
			totalSessions: employeeAppointments.length,
			patientsByType,
			activitiesByType,
			loading: false,
		};
	}, [selectedEmployee, clinicalAppointments, clinicalPatients, clinicalBilling, clinicalActivities]);

	const rolePresets: Record<
		EmployeeRole,
		Array<{ title: string; description: string; allowed: boolean }>
	> = {
		SuperAdmin: [
			{ title: 'Full system access', description: 'Complete control over all features and settings', allowed: true },
			{ title: 'User management', description: 'Create and manage all employee roles including SuperAdmin', allowed: true },
			{ title: 'Global settings', description: 'Manage platform-level configuration and teams', allowed: true },
			{ title: 'Billing dashboards', description: 'Approve billing cycles and refunds', allowed: true },
			{ title: 'Clinical data', description: 'Read/write all reports and assessments', allowed: true },
		],
		Admin: [
			{ title: 'Global settings', description: 'Manage platform-level configuration and teams', allowed: true },
			{ title: 'Billing dashboards', description: 'Approve billing cycles and refunds', allowed: true },
			{ title: 'Clinical data', description: 'Read/write all reports and assessments', allowed: true },
		],
		FrontDesk: [
			{ title: 'Patient check-in', description: 'Register new patients and create appointments', allowed: true },
			{ title: 'Billing dashboards', description: 'Create invoices and mark payments', allowed: true },
			{ title: 'Clinical data', description: 'Read-only access to assigned patients', allowed: false },
		],
		ClinicalTeam: [
			{ title: 'Clinical data', description: 'Create and edit treatment notes and reports', allowed: true },
			{ title: 'Availability management', description: 'Update consultation slots and coverage', allowed: true },
			{ title: 'Billing dashboards', description: 'Cannot edit billing entries', allowed: false },
		],
		Physiotherapist: [
			{ title: 'Clinical data', description: 'Create and edit physio treatment notes and reports', allowed: true },
			{ title: 'Availability management', description: 'Update consultation slots and coverage', allowed: true },
			{ title: 'Billing dashboards', description: 'Cannot edit billing entries', allowed: false },
		],
		StrengthAndConditioning: [
			{ title: 'Training plans', description: 'Create and edit S&C programs and notes', allowed: true },
			{ title: 'Availability management', description: 'Update session availability', allowed: true },
			{ title: 'Clinical data', description: 'Read-only access to assigned patients', allowed: false },
		],
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Employee Management"
				/>

				<div className="border-t border-slate-200" />

				<section className="rounded-2xl border-2 border-sky-600 bg-white px-6 py-6 shadow-[0_10px_35px_rgba(20,90,150,0.12)] space-y-4">
					<div className="sm:flex sm:items-center sm:justify-between sm:space-x-6">
						<div>
							<h2 className="text-xl font-semibold text-blue-900">All Employees</h2>
						</div>
						<div className="mt-4 flex flex-col items-center justify-end gap-3 sm:mt-0 sm:flex-row">
							<input
								type="search"
								value={searchTerm}
								onChange={event => setSearchTerm(event.target.value)}
								placeholder="Search employees…"
								className="w-full min-w-[220px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-auto"
							/>
							{/* Actions Dropdown */}
							<div className="relative actions-dropdown-container">
								<button
									type="button"
									onClick={() => setShowActionsDropdown(!showActionsDropdown)}
									className="inline-flex items-center rounded-lg bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-800 hover:via-blue-700 hover:to-blue-600 hover:shadow-xl hover:shadow-blue-900/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
								>
									<i className="fas fa-ellipsis-v mr-2 text-sm" aria-hidden="true" />
									Actions
									<i className={`fas fa-chevron-${showActionsDropdown ? 'up' : 'down'} ml-2 text-xs`} aria-hidden="true" />
								</button>
								
								{showActionsDropdown && (
									<>
										<div 
											className="fixed inset-0 z-10" 
											onClick={() => setShowActionsDropdown(false)}
											aria-hidden="true"
										/>
										<div className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-black ring-opacity-5 border border-blue-200">
											<div className="py-1" role="menu" aria-orientation="vertical">
												{!showDeletedEmployees && (
													<button
														type="button"
														onClick={() => {
															openCreateDialog();
															setShowActionsDropdown(false);
														}}
														className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
														role="menuitem"
													>
														<i className="fas fa-user-plus text-emerald-600" aria-hidden="true" />
														<span className="font-medium">Add New Employee</span>
													</button>
												)}
												<button
													type="button"
													onClick={() => {
														setShowDeletedEmployees(!showDeletedEmployees);
														setShowActionsDropdown(false);
													}}
													className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
														showDeletedEmployees
															? 'bg-amber-50 text-amber-700'
															: 'text-slate-700 hover:bg-amber-50 hover:text-amber-700'
													}`}
													role="menuitem"
												>
													<i className={`fas ${showDeletedEmployees ? 'fa-eye-slash' : 'fa-history'} text-amber-600`} aria-hidden="true" />
													<span className="font-medium">
														{showDeletedEmployees ? 'Show Active Employees' : `Past Employees (${analytics.deletedCount})`}
													</span>
												</button>
												<button
													type="button"
													onClick={() => {
														setShowEmployeeDetails(true);
														setShowActionsDropdown(false);
													}}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
													role="menuitem"
												>
													<i className="fas fa-id-card text-indigo-600" aria-hidden="true" />
													<span className="font-medium">Employee Details</span>
												</button>
												<button
													type="button"
													onClick={() => {
														handleExportCSV();
														setShowActionsDropdown(false);
													}}
													disabled={filteredEmployees.length === 0}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
													role="menuitem"
												>
													<i className="fas fa-file-csv text-blue-600" aria-hidden="true" />
													<span className="font-medium">Export CSV</span>
												</button>
											</div>
										</div>
									</>
								)}
							</div>
						</div>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<div className="relative">
							<div className="relative">
								<select
									value={roleFilter}
									onChange={event => setRoleFilter(event.target.value as 'all' | EmployeeRole)}
									className="w-full appearance-none rounded-xl border-2 border-blue-200 bg-white px-4 py-3 pl-10 pr-10 text-sm font-medium text-blue-900 shadow-md transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 hover:border-blue-300 hover:shadow-lg"
								>
									<option value="all">All Roles</option>
									<option value="SuperAdmin">Super Admin</option>
									<option value="Admin">Admin</option>
									<option value="FrontDesk">Front Desk</option>
									<option value="ClinicalTeam">Clinical Team</option>
								</select>
								<div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
									<i className="fas fa-chevron-down text-blue-600 text-xs" aria-hidden="true" />
								</div>
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
									<i className="fas fa-user-tag text-blue-500 text-sm" aria-hidden="true" />
								</div>
							</div>
						</div>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<p className="text-xs uppercase tracking-wide text-slate-500">Total staff</p>
							<p className="mt-2 text-2xl font-semibold text-slate-900">{analytics.total}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-emerald-50 p-4">
							<p className="text-xs uppercase tracking-wide text-emerald-700">Active</p>
							<p className="mt-2 text-2xl font-semibold text-emerald-800">{analytics.active}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
							<p className="text-xs uppercase tracking-wide text-slate-600">Inactive</p>
							<p className="mt-2 text-2xl font-semibold text-slate-800">{analytics.inactive}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-purple-50 p-4">
							<p className="text-xs uppercase tracking-wide text-purple-700">Super Admin</p>
							<p className="mt-2 text-2xl font-semibold text-purple-900">{analytics.superAdminCount || 0}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-violet-50 p-4">
							<p className="text-xs uppercase tracking-wide text-violet-700">Admin</p>
							<p className="mt-2 text-2xl font-semibold text-violet-900">{analytics.adminCount}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-sky-50 p-4">
							<p className="text-xs uppercase tracking-wide text-sky-700">Front desk</p>
							<p className="mt-2 text-2xl font-semibold text-sky-900">{analytics.frontDesk}</p>
						</div>
						<div className="rounded-xl border border-slate-200 bg-indigo-50 p-4">
							<p className="text-xs uppercase tracking-wide text-indigo-700">Clinical team</p>
							<p className="mt-2 text-2xl font-semibold text-indigo-900">{analytics.clinical}</p>
						</div>
					</div>
				</section>

			{error && (
				<div className="mx-auto mt-6 max-w-5xl rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
					{error}
				</div>
			)}

			<section className="mx-auto mt-8 max-w-6xl rounded-2xl bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
				{loading ? (
					<div className="py-10 text-center text-sm text-slate-500">Loading employees…</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
							<thead className="bg-sky-50 text-xs uppercase tracking-wide text-sky-700">
								<tr>
									<th className="px-4 py-3 font-semibold">Profile</th>
									<th className="px-4 py-3 font-semibold">Name</th>
									<th className="px-4 py-3 font-semibold">Email/Login</th>
									<th className="px-4 py-3 font-semibold">Role</th>
									<th className="px-4 py-3 font-semibold">Status</th>
									<th className="px-4 py-3 font-semibold">Created</th>
									<th className="px-4 py-3 font-semibold text-center">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{filteredEmployees.length === 0 ? (
									<tr>
										<td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
											{showDeletedEmployees 
												? 'No past employees found.' 
												: 'No employees found. Adjust your search or add someone new.'}
										</td>
									</tr>
								) : (
									filteredEmployees.map((employee, index) => (
										<tr key={employee.id} className={employee.deleted ? 'bg-slate-50 opacity-75' : ''}>
											<td className="px-4 py-4">
												{employee.profileImage ? (
													<img
														src={employee.profileImage}
														alt={employee.userName || 'Employee'}
														className="h-10 w-10 rounded-full object-cover border-2 border-blue-200"
													/>
												) : (
													<div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 border-2 border-blue-200">
														<i className="fas fa-user text-blue-600 text-sm" aria-hidden="true" />
													</div>
												)}
											</td>
											<td className="px-4 py-4 font-medium text-slate-800">
												{employee.userName}
												{employee.deleted && (
													<span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
														Past Employee
													</span>
												)}
											</td>
											<td className="px-4 py-4 text-slate-600">{employee.userEmail}</td>
											<td className="px-4 py-4">
												<span className={`inline-flex items-center rounded-full ${ROLE_COLORS[employee.role]?.bg || 'bg-sky-100'} px-3 py-1 text-xs font-semibold ${ROLE_COLORS[employee.role]?.text || 'text-sky-700'}`}>
													<i className="fas fa-user-shield mr-1 text-[11px]" aria-hidden="true" />
													{ROLE_LABELS[employee.role]}
												</span>
											</td>
											<td className="px-4 py-4">
												<span
													className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[employee.status]?.bg || 'bg-slate-200'} ${STATUS_COLORS[employee.status]?.text || 'text-slate-600'}`}
												>
													{employee.status}
												</span>
											</td>
											<td className="px-4 py-4 text-sm text-slate-500">
												{showDeletedEmployees && employee.deletedAt 
													? `Removed: ${formatDate(employee.deletedAt)}`
													: formatDate(employee.createdAt)}
											</td>
											<td className="px-4 py-4 text-center text-sm">
												<div className="flex flex-wrap justify-center gap-2">
													{/* VIEW PROFILE */}
													<button
														type="button"
														onClick={() => setSelectedEmployee(employee)}
														className="inline-flex items-center rounded-full border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-800 focus-visible:border-sky-400 focus-visible:text-sky-800 focus-visible:outline-none"
													>
														<i className="fas fa-id-badge mr-1 text-[11px]" aria-hidden="true" />
														View profile
													</button>

													{/* DELETE - Only show for active employees and if user has permission */}
													{!showDeletedEmployees && !employee.deleted && canDeleteEmployee(employee) && (
														<button
															type="button"
															onClick={() => handleDeleteClick(employee)}
															className="inline-flex items-center justify-center rounded-full border border-rose-200 px-2.5 py-1.5 text-rose-600 transition hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:border-rose-400 focus-visible:text-rose-700 focus-visible:outline-none"
															disabled={saving}
															title="Delete employee"
														>
															<i className="fas fa-trash text-xs" aria-hidden="true" />
														</button>
													)}
												</div>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{selectedEmployee && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={() => setSelectedEmployee(null)}
					role="dialog"
					aria-modal="true"
				>
					<div
						className="w-full max-w-3xl max-h-[95vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl"
						onClick={event => event.stopPropagation()}
					>
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
							<div className="flex items-center gap-4">
								{selectedEmployee.profileImage ? (
									<img
										src={selectedEmployee.profileImage}
										alt={selectedEmployee.userName || 'Employee'}
										className="h-16 w-16 rounded-full object-cover border-2 border-sky-200"
									/>
								) : (
									<div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 border-2 border-sky-200">
										<i className="fas fa-user text-sky-600 text-xl" aria-hidden="true" />
									</div>
								)}
							<div>
								<div className="flex items-center gap-2">
									<h3 className="text-lg font-semibold text-slate-900">{selectedEmployee.userName}</h3>
									{selectedEmployee.deleted && (
										<span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
											Past Employee
										</span>
									)}
								</div>
								<p className="text-xs text-slate-500">{selectedEmployee.userEmail}</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setSelectedEmployee(null)}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
								aria-label="Close profile"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>

						<div className="grid flex-1 gap-4 overflow-y-auto px-6 py-6 min-h-0 lg:grid-cols-[1.2fr,0.8fr]">
							<section className="space-y-4">
								<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
									<h4 className="text-sm font-semibold text-slate-800">Profile overview</h4>
									<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
										<div>
											<dt className="font-semibold text-slate-500">Role</dt>
											<dd>{ROLE_LABELS[selectedEmployee.role]}</dd>
										</div>
										<div>
											<dt className="font-semibold text-slate-500">Status</dt>
											<dd>{selectedEmployee.status}</dd>
										</div>
										<div>
											<dt className="font-semibold text-slate-500">Joined</dt>
											<dd>{formatDate(selectedEmployee.createdAt)}</dd>
										</div>
										<div>
											<dt className="font-semibold text-slate-500">Permissions</dt>
											<dd>Preset: {ROLE_LABELS[selectedEmployee.role]} defaults</dd>
										</div>
									</dl>
								</div>

								{/* Personal Information */}
								{(selectedEmployee.phone || selectedEmployee.address || selectedEmployee.dateOfBirth || selectedEmployee.gender) && (
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h4 className="text-sm font-semibold text-slate-800">Personal Information</h4>
										<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
											{selectedEmployee.phone && (
												<div>
													<dt className="font-semibold text-slate-500">Phone</dt>
													<dd>{selectedEmployee.phone}</dd>
												</div>
											)}
											{selectedEmployee.dateOfBirth && (
												<div>
													<dt className="font-semibold text-slate-500">Date of Birth</dt>
													<dd>{selectedEmployee.dateOfBirth}</dd>
												</div>
											)}
											{selectedEmployee.dateOfJoining && (
												<div>
													<dt className="font-semibold text-slate-500">Date of Joining</dt>
													<dd>{selectedEmployee.dateOfJoining}</dd>
												</div>
											)}
											{selectedEmployee.gender && (
												<div>
													<dt className="font-semibold text-slate-500">Gender</dt>
													<dd>{selectedEmployee.gender}</dd>
												</div>
											)}
											{selectedEmployee.bloodGroup && (
												<div>
													<dt className="font-semibold text-slate-500">Blood Group</dt>
													<dd>{selectedEmployee.bloodGroup}</dd>
												</div>
											)}
											{selectedEmployee.address && (
												<div className="sm:col-span-2">
													<dt className="font-semibold text-slate-500">Address</dt>
													<dd className="whitespace-pre-wrap">{selectedEmployee.address}</dd>
												</div>
											)}
										</dl>
									</div>
								)}

								{/* Emergency Contact */}
								{(selectedEmployee.emergencyContact || selectedEmployee.emergencyPhone) && (
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h4 className="text-sm font-semibold text-slate-800">Emergency Contact</h4>
										<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
											{selectedEmployee.emergencyContact && (
												<div>
													<dt className="font-semibold text-slate-500">Contact Name</dt>
													<dd>{selectedEmployee.emergencyContact}</dd>
												</div>
											)}
											{selectedEmployee.emergencyPhone && (
												<div>
													<dt className="font-semibold text-slate-500">Contact Phone</dt>
													<dd>{selectedEmployee.emergencyPhone}</dd>
												</div>
											)}
										</dl>
									</div>
								)}

								{/* Professional Information */}
								{(selectedEmployee.qualifications || selectedEmployee.specialization || selectedEmployee.experience) && (
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h4 className="text-sm font-semibold text-slate-800">Professional Information</h4>
										<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
											{selectedEmployee.qualifications && (
												<div>
													<dt className="font-semibold text-slate-500">Qualifications</dt>
													<dd>{selectedEmployee.qualifications}</dd>
												</div>
											)}
											{selectedEmployee.specialization && (
												<div>
													<dt className="font-semibold text-slate-500">Specialization</dt>
													<dd>{selectedEmployee.specialization}</dd>
												</div>
											)}
											{selectedEmployee.experience && (
												<div>
													<dt className="font-semibold text-slate-500">Experience</dt>
													<dd>{selectedEmployee.experience}</dd>
												</div>
											)}
										</dl>
									</div>
								)}

								{/* Professional Aim */}
								{selectedEmployee.professionalAim && (
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h4 className="text-sm font-semibold text-slate-800">Professional Aim</h4>
										<p className="mt-3 whitespace-pre-wrap text-xs text-slate-600">{selectedEmployee.professionalAim}</p>
									</div>
								)}

								<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
									<h4 className="text-sm font-semibold text-slate-800">Role permissions</h4>
									<ul className="mt-3 space-y-2 text-xs">
										{(rolePresets[selectedEmployee.role] ?? []).map(permission => (
											<li
												key={permission.title}
												className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
											>
												<span
													className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
														permission.allowed
															? 'bg-emerald-100 text-emerald-700'
															: 'bg-slate-200 text-slate-500'
													}`}
												>
													{permission.allowed ? <i className="fas fa-check" /> : <i className="fas fa-minus" />}
												</span>
												<div>
													<p className="font-semibold text-slate-700">{permission.title}</p>
													<p className="text-slate-500">{permission.description}</p>
												</div>
											</li>
										))}
									</ul>
								</div>

								{/* Performance Metrics - Only for ClinicalTeam */}
								{selectedEmployee.role === 'ClinicalTeam' && (
								<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h4 className="text-sm font-semibold text-slate-800 mb-4">Performance Metrics</h4>
										{clinicalAppointments.length === 0 && clinicalPatients.length === 0 && clinicalBilling.length === 0 && clinicalActivities.length === 0 ? (
											<div className="py-4 text-center text-xs text-slate-500">
												<i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
												Loading metrics...
											</div>
										) : (
											<div className="space-y-4">
												{/* Key Metrics */}
												<div className="grid grid-cols-2 gap-3">
													<div className="rounded-lg border border-slate-200 bg-sky-50 p-3">
														<p className="text-xs font-medium text-slate-600">Active Patients</p>
														<p className="mt-1 text-xl font-bold text-sky-900">{clinicalMetrics.activePatients}</p>
													</div>
													<div className="rounded-lg border border-slate-200 bg-emerald-50 p-3">
														<p className="text-xs font-medium text-slate-600">Revenue Generated</p>
														<p className="mt-1 text-xl font-bold text-emerald-900">
															₹{clinicalMetrics.revenue.toLocaleString('en-IN')}
														</p>
													</div>
													<div className="rounded-lg border border-slate-200 bg-indigo-50 p-3">
														<p className="text-xs font-medium text-slate-600">Total Sessions</p>
														<p className="mt-1 text-xl font-bold text-indigo-900">{clinicalMetrics.totalSessions}</p>
													</div>
													<div className="rounded-lg border border-slate-200 bg-purple-50 p-3">
														<p className="text-xs font-medium text-slate-600">Total Activities</p>
														<p className="mt-1 text-xl font-bold text-purple-900">
															{Object.values(clinicalMetrics.activitiesByType).reduce((sum: number, count: number) => sum + count, 0)}
														</p>
													</div>
												</div>

												{/* Patients by Type */}
												<div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
													<p className="text-xs font-semibold text-slate-700 mb-2">Patients by Type</p>
													<div className="grid grid-cols-2 gap-2 text-xs">
														<div className="flex items-center justify-between">
															<span className="text-slate-600">DYES:</span>
															<span className="font-semibold text-slate-900">{clinicalMetrics.patientsByType.DYES}</span>
														</div>
														<div className="flex items-center justify-between">
															<span className="text-slate-600">PAID:</span>
															<span className="font-semibold text-slate-900">{clinicalMetrics.patientsByType.PAID}</span>
														</div>
														<div className="flex items-center justify-between">
															<span className="text-slate-600">VIP:</span>
															<span className="font-semibold text-slate-900">{clinicalMetrics.patientsByType.VIP}</span>
														</div>
														<div className="flex items-center justify-between">
															<span className="text-slate-600">GETHNA:</span>
															<span className="font-semibold text-slate-900">{clinicalMetrics.patientsByType.GETHNA}</span>
														</div>
													</div>
												</div>

												{/* Activities Chart */}
												{Object.keys(clinicalMetrics.activitiesByType).length > 0 && (
													<div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
														<p className="text-xs font-semibold text-slate-700 mb-3">Activities Done</p>
														<div className="space-y-2">
															{Object.entries(clinicalMetrics.activitiesByType)
																.sort(([, a], [, b]) => (b as number) - (a as number))
																.map(([type, count]) => {
																	const total = Object.values(clinicalMetrics.activitiesByType).reduce((sum: number, c: number) => sum + c, 0);
																	const percentage = total > 0 ? ((count as number) / total) * 100 : 0;
																	return (
																		<div key={type} className="space-y-1">
																			<div className="flex items-center justify-between text-xs">
																				<span className="text-slate-600">{type || 'Other'}</span>
																				<span className="font-semibold text-slate-900">{count as number}</span>
																			</div>
																			<div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
																				<div
																					className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all duration-500"
																					style={{ width: `${percentage}%` }}
																				/>
																			</div>
																		</div>
																	);
																})}
														</div>
													</div>
												)}
											</div>
										)}
									</div>
								)}

								<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
									<h4 className="text-sm font-semibold text-slate-800">Remarks and Feedback</h4>
									<p className="mt-2 text-xs text-slate-500">
										Send feedback to this employee. They will receive a notification and can reply back.
									</p>
									
									{/* Feedback History */}
									{loadingFeedback ? (
										<div className="mt-4 py-4 text-center text-xs text-slate-500">
											<i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
											Loading feedback history...
										</div>
									) : employeeFeedback.length > 0 ? (
										<div className="mt-4 space-y-3 max-h-64 overflow-y-auto">
											{employeeFeedback.map(feedback => (
												<div key={feedback.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
													<div className="flex items-center justify-between mb-2">
														<span className="text-xs font-semibold text-slate-700">
															{feedback.fromUserName || 'Admin'}
														</span>
														<span className="text-[10px] text-slate-400">
															{formatDate(feedback.createdAt)}
														</span>
													</div>
													<p className="text-xs text-slate-600 whitespace-pre-wrap mb-2">
														{feedback.message}
													</p>
													{/* Show message thread if available */}
													{feedback.messages && feedback.messages.length > 1 && (
														<div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
															{feedback.messages.slice(1).map((msg, idx) => (
																<div
																	key={msg.id || idx}
																	className={`rounded p-2 text-xs ${
																		msg.senderId === user?.uid
																			? 'ml-4 bg-sky-100 border border-sky-200'
																			: 'mr-4 bg-white border border-slate-200'
																	}`}
																>
																	<div className="flex items-center justify-between mb-1">
																		<span className="font-semibold text-slate-700">{msg.senderName}</span>
																		<span className="text-[10px] text-slate-400">
																			{formatDate(msg.createdAt)}
																		</span>
																	</div>
																	<p className="text-slate-600 whitespace-pre-wrap">{msg.message}</p>
																</div>
															))}
														</div>
													)}
												</div>
											))}
										</div>
									) : (
										<div className="mt-4 py-4 text-center text-xs text-slate-400">
											No feedback history yet.
										</div>
									)}

									{/* Send New Feedback */}
									<div className="mt-4 space-y-2">
										<textarea
											value={feedbackDraft}
											onChange={event => setFeedbackDraft(event.target.value)}
											placeholder="Enter your remarks or feedback..."
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											rows={4}
											disabled={sendingFeedback}
										/>
										<div className="flex justify-end">
											<button 
												type="button" 
												onClick={handleSendFeedback} 
												disabled={!feedbackDraft.trim() || sendingFeedback}
												className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
											>
												{sendingFeedback ? (
													<>
														<i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
														Sending...
													</>
												) : (
													<>
														<i className="fas fa-paper-plane mr-2" aria-hidden="true" />
														Send Feedback
													</>
												)}
											</button>
										</div>
									</div>
								</div>
							</section>

							<aside className="space-y-4">
								<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
									<h4 className="text-sm font-semibold text-slate-800">Quick actions</h4>
									<div className="mt-3 space-y-2 text-xs">
										{/* Send reset email (placeholder) */}
										<button
											type="button"
											onClick={() => handleSendResetEmail(selectedEmployee)}
											className="btn-tertiary w-full justify-start"
										>
											<i className="fas fa-envelope text-xs" aria-hidden="true" />
											Send reset email
										</button>

										{/* Reset password (temporary password generator / placeholder) */}
										<button
											type="button"
											onClick={() => handleResetPassword(selectedEmployee)}
											className="btn-tertiary w-full justify-start"
										>
											<i className="fas fa-key text-xs" aria-hidden="true" />
											Reset password
										</button>

										{/* Toggle status & edit remain available in modal */}
										<button
											type="button"
											onClick={() => handleToggleStatus(selectedEmployee)}
											className="btn-tertiary w-full justify-start"
										>
											<i className="fas fa-power-off text-xs" aria-hidden="true" />
											{selectedEmployee.status === 'Active' ? 'Deactivate user' : 'Activate user'}
										</button>
										<button
											type="button"
											onClick={() => {
												openEditDialog(selectedEmployee);
											}}
											className="btn-tertiary w-full justify-start"
										>
											<i className="fas fa-edit text-xs" aria-hidden="true" />
											Edit details
										</button>
									</div>
								</div>
								<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
									<h4 className="text-sm font-semibold text-slate-800">Summary</h4>
									<ul className="mt-3 space-y-1 text-xs text-slate-600">
										<li className="flex items-center justify-between">
											<span>Role</span>
											<span className="font-semibold">{ROLE_LABELS[selectedEmployee.role]}</span>
										</li>
										<li className="flex items-center justify-between">
											<span>Status</span>
											<span className="font-semibold">{selectedEmployee.status}</span>
										</li>
										<li className="flex items-center justify-between">
											<span>Created</span>
											<span className="font-semibold">{formatDate(selectedEmployee.createdAt)}</span>
										</li>
										{selectedEmployee.deleted && selectedEmployee.deletedAt && (
											<li className="flex items-center justify-between">
												<span>Removed</span>
												<span className="font-semibold text-amber-700">{formatDate(selectedEmployee.deletedAt)}</span>
											</li>
										)}
									</ul>
								</div>
							</aside>
						</div>
					</div>
				</div>
			)}

			{isDialogOpen && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={closeDialog}
				>
					<div 
						className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
						onClick={event => event.stopPropagation()}
					>
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">
								{editingEmployee ? 'Edit Employee' : 'Add Employee'}
							</h2>
							<button
								type="button"
								onClick={closeDialog}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
							{error && (
								<div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 whitespace-pre-line">
									{error}
								</div>
							)}
							<div>
								<label className="block text-sm font-medium text-slate-700">Full Name</label>
								<input
									type="text"
									value={formState.userName}
									onChange={event => setFormState(current => ({ ...current, userName: event.target.value }))}
									className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									required
								/>
							</div>
							<div>
								<label className="block text-sm font-medium text-slate-700">Email (Login)</label>
								<input
									type="email"
									value={formState.userEmail}
									onChange={event => setFormState(current => ({ ...current, userEmail: event.target.value }))}
									disabled={Boolean(editingEmployee)}
									className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100"
									required
								/>
							</div>
							{!editingEmployee && (
								<div>
									<label className="block text-sm font-medium text-slate-700">Password (Optional)</label>
									<input
										type="password"
										value={formState.password}
										onChange={event => setFormState(current => ({ ...current, password: event.target.value }))}
										className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										minLength={6}
										placeholder="Leave empty if not creating auth account"
									/>
									<p className="mt-1 text-xs text-slate-500">
										Optional. Only needed if creating Firebase Authentication account. Must be at least 6 characters if provided.
									</p>
								</div>
							)}
							<div>
								<label className="block text-sm font-medium text-slate-700">Role</label>
								<select
									value={formState.userRole}
									onChange={event =>
										setFormState(current => ({
											...current,
											userRole: event.target.value as FormState['userRole'],
										}))
									}
									className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									required
								>
									{ROLE_OPTIONS.map(option => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-slate-700">Status</label>
								<select
									value={formState.userStatus}
									onChange={event =>
										setFormState(current => ({
											...current,
											userStatus: event.target.value as EmployeeStatus,
										}))
									}
									className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									required
								>
									<option value="Active">Active</option>
									<option value="Inactive">Inactive</option>
								</select>
							</div>
							<footer className="flex items-center justify-end gap-3 pt-2">
								<button
									type="button"
									onClick={closeDialog}
									disabled={saving}
									className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={saving}
									className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-70"
								>
									{saving ? 'Saving…' : 'Save Employee'}
								</button>
							</footer>
						</form>
					</div>
				</div>
			)}

			{/* Employee Details Modal */}
			{showEmployeeDetails && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={() => setShowEmployeeDetails(false)}
				>
					<div 
						className="w-full max-w-7xl max-h-[90vh] rounded-2xl bg-white shadow-2xl overflow-hidden"
						onClick={event => event.stopPropagation()}
					>
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Employee Details</h2>
								<p className="text-xs text-slate-500 mt-1">
									All profile information filled by employees
								</p>
							</div>
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={handleExportEmployeeDetailsCSV}
									className="inline-flex items-center rounded-lg border border-sky-600 bg-white px-4 py-2 text-sm font-semibold text-sky-600 shadow-md transition hover:bg-sky-50 focus-visible:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
								>
									<i className="fas fa-file-csv mr-2 text-sm" aria-hidden="true" />
									Export CSV
								</button>
								<button
									type="button"
									onClick={() => setShowEmployeeDetails(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close dialog"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</div>
						</header>

						<div className="overflow-y-auto max-h-[calc(90vh-80px)]">
							<div className="p-6">
								{loading ? (
									<div className="py-10 text-center text-sm text-slate-500">Loading employee details…</div>
								) : employees.length === 0 ? (
									<div className="py-10 text-center text-sm text-slate-500">
										No employees found.
									</div>
								) : (
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
											<thead className="bg-sky-50 text-xs uppercase tracking-wide text-sky-700 sticky top-0">
												<tr>
													<th className="px-4 py-3 font-semibold">Image</th>
													<th className="px-4 py-3 font-semibold">Name</th>
													<th className="px-4 py-3 font-semibold">Email</th>
													<th className="px-4 py-3 font-semibold">Role</th>
													<th className="px-4 py-3 font-semibold">Phone</th>
													<th className="px-4 py-3 font-semibold">Date of Birth</th>
													<th className="px-4 py-3 font-semibold">Date of Joining</th>
													<th className="px-4 py-3 font-semibold">Gender</th>
													<th className="px-4 py-3 font-semibold">Blood Group</th>
													<th className="px-4 py-3 font-semibold">Address</th>
													<th className="px-4 py-3 font-semibold">Emergency Contact</th>
													<th className="px-4 py-3 font-semibold">Emergency Phone</th>
													<th className="px-4 py-3 font-semibold">Qualifications</th>
													<th className="px-4 py-3 font-semibold">Specialization</th>
													<th className="px-4 py-3 font-semibold">Experience</th>
													<th className="px-4 py-3 font-semibold">Professional Aim</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100 bg-white">
												{employees.filter(emp => !emp.deleted).map((employee) => (
													<tr key={employee.id} className="hover:bg-slate-50">
														<td className="px-4 py-3">
															{employee.profileImage ? (
																<img
																	src={employee.profileImage}
																	alt={employee.userName || 'Employee'}
																	className="h-10 w-10 rounded-full object-cover border-2 border-slate-200"
																/>
															) : (
																<div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 border-2 border-slate-200">
																	<i className="fas fa-user text-slate-400 text-sm" aria-hidden="true" />
																</div>
															)}
														</td>
														<td className="px-4 py-3 font-medium text-slate-800">{employee.userName || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.userEmail || '—'}</td>
														<td className="px-4 py-3">
															<span className={`inline-flex items-center rounded-full ${ROLE_COLORS[employee.role]?.bg || 'bg-sky-100'} px-2 py-1 text-xs font-semibold ${ROLE_COLORS[employee.role]?.text || 'text-sky-700'}`}>
																{ROLE_LABELS[employee.role]}
															</span>
														</td>
														<td className="px-4 py-3 text-slate-600">{employee.phone || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.dateOfBirth || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.dateOfJoining || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.gender || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.bloodGroup || '—'}</td>
														<td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={employee.address || ''}>
															{employee.address || '—'}
														</td>
														<td className="px-4 py-3 text-slate-600">{employee.emergencyContact || '—'}</td>
														<td className="px-4 py-3 text-slate-600">{employee.emergencyPhone || '—'}</td>
														<td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={employee.qualifications || ''}>
															{employee.qualifications || '—'}
														</td>
														<td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={employee.specialization || ''}>
															{employee.specialization || '—'}
														</td>
														<td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={employee.experience || ''}>
															{employee.experience || '—'}
														</td>
														<td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={employee.professionalAim || ''}>
															{employee.professionalAim || '—'}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
			</div>

			{/* Delete Confirmation Modal */}
			{deleteConfirmation.employee && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={handleDeleteCancel}
				>
					<div
						className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
						onClick={event => event.stopPropagation()}
					>
						<div className="px-6 py-5 border-b border-slate-200">
							<div className="flex items-center gap-3">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
									<i className="fas fa-exclamation-triangle text-rose-600 text-xl" aria-hidden="true" />
								</div>
								<div>
									<h3 className="text-lg font-semibold text-slate-900">Delete Employee</h3>
									<p className="text-sm text-slate-600">This action cannot be undone</p>
								</div>
							</div>
						</div>

						<div className="px-6 py-5 space-y-4">
							<div className="rounded-lg bg-rose-50 border border-rose-200 p-4">
								<p className="text-sm font-medium text-rose-900 mb-2">
									You are about to delete:
								</p>
								<p className="text-base font-semibold text-slate-900">
									{deleteConfirmation.employee.userName}
								</p>
								<p className="text-sm text-slate-600 mt-1">
									{deleteConfirmation.employee.userEmail}
								</p>
							</div>

							<div>
								<label className="block text-sm font-semibold text-slate-700 mb-2">
									To confirm, please type the employee's name:
									<span className="font-mono text-blue-600 ml-2">
										{deleteConfirmation.employee.userName}
									</span>
								</label>
								<input
									type="text"
									value={deleteConfirmation.nameInput}
									onChange={event => setDeleteConfirmation(prev => ({ ...prev, nameInput: event.target.value }))}
									placeholder="Enter employee name"
									className="w-full rounded-lg border-2 border-slate-300 px-4 py-3 text-sm text-slate-900 transition focus:border-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-100"
									autoFocus
									onKeyDown={event => {
										if (event.key === 'Enter' && deleteConfirmation.nameInput.trim().toLowerCase() === deleteConfirmation.employee?.userName.trim().toLowerCase()) {
											handleDeleteConfirm();
										}
									}}
								/>
								{error && deleteConfirmation.employee && (
									<p className="mt-2 text-sm text-rose-600 flex items-center gap-2">
										<i className="fas fa-exclamation-circle" aria-hidden="true" />
										{error}
									</p>
								)}
							</div>
						</div>

						<div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
							<button
								type="button"
								onClick={handleDeleteCancel}
								className="px-4 py-2 text-sm font-semibold text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-slate-300"
								disabled={saving}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleDeleteConfirm}
								disabled={
									saving ||
									deleteConfirmation.nameInput.trim().toLowerCase() !== deleteConfirmation.employee?.userName.trim().toLowerCase()
								}
								className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 transition focus:outline-none focus:ring-4 focus:ring-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{saving ? (
									<span className="flex items-center gap-2">
										<i className="fas fa-spinner fa-spin" aria-hidden="true" />
										Deleting...
									</span>
								) : (
									<span className="flex items-center gap-2">
										<i className="fas fa-trash" aria-hidden="true" />
										Delete Employee
									</span>
								)}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
