'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, setDoc, query, where, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { reauthenticateWithCredential, updatePassword, EmailAuthProvider } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface ProfileData {
	userName: string;
	userEmail: string;
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

export default function Profile() {
	const { user } = useAuth();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [profileData, setProfileData] = useState<ProfileData>({
		userName: '',
		userEmail: '',
		phone: '',
		address: '',
		dateOfBirth: '',
		dateOfJoining: '',
		gender: '',
		bloodGroup: '',
		emergencyContact: '',
		emergencyPhone: '',
		qualifications: '',
		specialization: '',
		experience: '',
		professionalAim: '',
		profileImage: '',
	});
	const [imagePreview, setImagePreview] = useState<string>('');
	const [uploadingImage, setUploadingImage] = useState(false);
	
	// Password change state
	const [showPasswordChange, setShowPasswordChange] = useState(false);
	const [passwordData, setPasswordData] = useState({
		currentPassword: '',
		newPassword: '',
		confirmPassword: '',
	});
	const [changingPassword, setChangingPassword] = useState(false);
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [passwordSuccess, setPasswordSuccess] = useState(false);

	// Load user profile from staff collection (use uid-first so same identity as Auth/assignments)
	useEffect(() => {
		const loadProfile = async () => {
			if (!user?.uid) {
				setLoading(false);
				return;
			}

			try {
				// Prefer staff document keyed by current user's uid (canonical identity)
				const staffByUidRef = doc(db, 'staff', user.uid);
				const staffByUidSnap = await getDoc(staffByUidRef);

				if (staffByUidSnap.exists()) {
					const data = staffByUidSnap.data();
					setProfileData({
						userName: data.userName || '',
						userEmail: data.userEmail || user.email || '',
						phone: data.phone || '',
						address: data.address || '',
						dateOfBirth: data.dateOfBirth || '',
						dateOfJoining: data.dateOfJoining || '',
						gender: data.gender || '',
						bloodGroup: data.bloodGroup || '',
						emergencyContact: data.emergencyContact || '',
						emergencyPhone: data.emergencyPhone || '',
						qualifications: data.qualifications || '',
						specialization: data.specialization || '',
						experience: data.experience || '',
						professionalAim: data.professionalAim || data.notes || '',
						profileImage: data.profileImage || '',
					});
					setImagePreview(data.profileImage || '');
					setLoading(false);
					return;
				}

				// Fallback: find staff by email (e.g. legacy records)
				if (!user?.email) {
					setProfileData(prev => ({ ...prev, userName: user.displayName || '', userEmail: user.email || '' }));
					setLoading(false);
					return;
				}
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email));
				const querySnapshot = await getDocs(staffQuery);

				if (!querySnapshot.empty) {
					const staffDoc = querySnapshot.docs[0];
					const data = staffDoc.data();
					setProfileData({
						userName: data.userName || '',
						userEmail: data.userEmail || user.email || '',
						phone: data.phone || '',
						address: data.address || '',
						dateOfBirth: data.dateOfBirth || '',
						dateOfJoining: data.dateOfJoining || '',
						gender: data.gender || '',
						bloodGroup: data.bloodGroup || '',
						emergencyContact: data.emergencyContact || '',
						emergencyPhone: data.emergencyPhone || '',
						qualifications: data.qualifications || '',
						specialization: data.specialization || '',
						experience: data.experience || '',
						professionalAim: data.professionalAim || data.notes || '',
						profileImage: data.profileImage || '',
					});
					setImagePreview(data.profileImage || '');
				} else {
					setProfileData(prev => ({
						...prev,
						userName: user.displayName || '',
						userEmail: user.email || '',
					}));
				}
			} catch (error) {
				console.error('Failed to load profile:', error);
			} finally {
				setLoading(false);
			}
		};

		loadProfile();
	}, [user]);

	const handleFieldChange = (field: keyof ProfileData) => (
		e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
	) => {
		setProfileData(prev => ({
			...prev,
			[field]: e.target.value,
		}));
	};

	const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/')) {
			alert('Please select an image file');
			return;
		}

		// Validate file size (max 2MB)
		if (file.size > 2 * 1024 * 1024) {
			alert('Image size should be less than 2MB');
			return;
		}

		setUploadingImage(true);
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			setProfileData(prev => ({ ...prev, profileImage: result }));
			setImagePreview(result);
			setUploadingImage(false);
		};
		reader.onerror = () => {
			alert('Failed to read image file');
			setUploadingImage(false);
		};
		reader.readAsDataURL(file);
	};

	const handleRemoveImage = () => {
		setProfileData(prev => ({ ...prev, profileImage: '' }));
		setImagePreview('');
	};

	const handleSave = async () => {
		if (!user?.uid) {
			alert('User not authenticated');
			return;
		}

		setSaving(true);
		setSavedMessage(false);

		try {
			// Build update object (profile fields only; do not overwrite role/status/admin fields)
			const updateData: Record<string, any> = {
				updatedAt: serverTimestamp(),
			};

			if (profileData.userName.trim()) {
				updateData.userName = profileData.userName.trim();
			}
			if (profileData.phone?.trim()) {
				updateData.phone = profileData.phone.trim();
			}
			if (profileData.address?.trim()) {
				updateData.address = profileData.address.trim();
			}
			if (profileData.dateOfBirth?.trim()) {
				updateData.dateOfBirth = profileData.dateOfBirth.trim();
			}
			if (profileData.dateOfJoining?.trim()) {
				updateData.dateOfJoining = profileData.dateOfJoining.trim();
			}
			if (profileData.gender?.trim()) {
				updateData.gender = profileData.gender.trim();
			}
			if (profileData.bloodGroup?.trim()) {
				updateData.bloodGroup = profileData.bloodGroup.trim();
			}
			if (profileData.emergencyContact?.trim()) {
				updateData.emergencyContact = profileData.emergencyContact.trim();
			}
			if (profileData.emergencyPhone?.trim()) {
				updateData.emergencyPhone = profileData.emergencyPhone.trim();
			}
			if (profileData.qualifications?.trim()) {
				updateData.qualifications = profileData.qualifications.trim();
			}
			if (profileData.specialization?.trim()) {
				updateData.specialization = profileData.specialization.trim();
			}
			if (profileData.experience?.trim()) {
				updateData.experience = profileData.experience.trim();
			}
			if (profileData.professionalAim?.trim()) {
				updateData.professionalAim = profileData.professionalAim.trim();
			}
			if (profileData.profileImage?.trim()) {
				updateData.profileImage = profileData.profileImage.trim();
			}

			// Always write to staff/{uid} so the same user identity is preserved (assignments, auth, etc.)
			const staffByUidRef = doc(db, 'staff', user.uid);
			const staffByUidSnap = await getDoc(staffByUidRef);

			if (staffByUidSnap.exists()) {
				// Update existing canonical record (same user, not a new user)
				await updateDoc(staffByUidRef, updateData);
				setSavedMessage(true);
				setTimeout(() => setSavedMessage(false), 3000);
				return;
			}

			// Legacy: no staff/uid yet; find by email and update that doc, then ensure staff/uid exists (merge)
			if (!user?.email) {
				alert('Staff record not found. Please contact administrator.');
				setSaving(false);
				return;
			}
			const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email));
			const querySnapshot = await getDocs(staffQuery);

			if (!querySnapshot.empty) {
				const staffDoc = querySnapshot.docs[0];
				const existingData = staffDoc.data();
				// Update the existing doc (e.g. legacy by-email doc)
				await updateDoc(doc(db, 'staff', staffDoc.id), updateData);
				// Ensure canonical staff/uid exists so Auth and assignments use same identity (merge, preserve role/status)
				await setDoc(staffByUidRef, {
					authUid: user.uid,
					userEmail: user.email,
					userName: existingData.userName || profileData.userName.trim(),
					role: existingData.role,
					status: existingData.status,
					...updateData,
				}, { merge: true });
				setSavedMessage(true);
				setTimeout(() => setSavedMessage(false), 3000);
			} else {
				alert('Staff record not found. Please contact administrator.');
			}
		} catch (error) {
			console.error('Failed to save profile:', error);
			alert('Failed to save profile. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const handlePasswordChange = (field: 'currentPassword' | 'newPassword' | 'confirmPassword') => (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		setPasswordData(prev => ({
			...prev,
			[field]: e.target.value,
		}));
		setPasswordError(null);
		setPasswordSuccess(false);
	};

	const handleChangePassword = async () => {
		if (!user?.email) {
			setPasswordError('User not authenticated');
			return;
		}

		// Validation
		if (!passwordData.currentPassword.trim()) {
			setPasswordError('Current password is required');
			return;
		}

		if (!passwordData.newPassword.trim()) {
			setPasswordError('New password is required');
			return;
		}

		if (passwordData.newPassword.length < 6) {
			setPasswordError('New password must be at least 6 characters long');
			return;
		}

		if (passwordData.newPassword !== passwordData.confirmPassword) {
			setPasswordError('New passwords do not match');
			return;
		}

		if (passwordData.currentPassword === passwordData.newPassword) {
			setPasswordError('New password must be different from current password');
			return;
		}

		setChangingPassword(true);
		setPasswordError(null);
		setPasswordSuccess(false);

		try {
			const currentUser = auth.currentUser;
			if (!currentUser) {
				setPasswordError('User not authenticated. Please log in again.');
				return;
			}

			// Get the email - prefer currentUser.email, fallback to user.email from context
			// Normalize to lowercase as Firebase Auth stores emails in lowercase
			const userEmail = (currentUser.email || user?.email)?.toLowerCase().trim();
			if (!userEmail) {
				setPasswordError('User email not found. Please log in again.');
				return;
			}

			// Reauthenticate user with current password
			// Ensure password is trimmed
			const trimmedCurrentPassword = passwordData.currentPassword.trim();
			if (!trimmedCurrentPassword) {
				setPasswordError('Current password cannot be empty.');
				return;
			}

			const credential = EmailAuthProvider.credential(
				userEmail,
				trimmedCurrentPassword
			);
			
			await reauthenticateWithCredential(currentUser, credential);

			// Update password
			await updatePassword(currentUser, passwordData.newPassword);

			// Success
			setPasswordSuccess(true);
			setPasswordData({
				currentPassword: '',
				newPassword: '',
				confirmPassword: '',
			});
			setTimeout(() => {
				setPasswordSuccess(false);
				setShowPasswordChange(false);
			}, 3000);
		} catch (error: any) {
			console.error('Password change error:', error);
			const code = error?.code || '';
			if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
				setPasswordError('Current password is incorrect. Please verify your current password and try again.');
			} else if (code === 'auth/weak-password') {
				setPasswordError('New password is too weak. Please choose a stronger password.');
			} else if (code === 'auth/requires-recent-login') {
				setPasswordError('For security, please log out and log in again before changing your password.');
			} else if (code === 'auth/user-mismatch') {
				setPasswordError('The credential provided does not match the user. Please try again.');
			} else if (code === 'auth/user-not-found') {
				setPasswordError('User account not found. Please log in again.');
			} else {
				setPasswordError(error?.message || 'Failed to change password. Please try again.');
			}
		} finally {
			setChangingPassword(false);
		}
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-4xl">
					<div className="flex items-center justify-center py-20">
						<div className="text-center">
							<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
							<p className="text-sm text-slate-600">Loading profile...</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-4xl space-y-6">
				<PageHeader
					badge="Profile"
					title="My Profile"
				/>

				{savedMessage && (
					<div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
						<i className="fas fa-check-circle mr-2" aria-hidden="true" />
						Profile updated successfully!
					</div>
				)}

				<div className="section-card">
					<h2 className="mb-6 text-lg font-semibold text-slate-900">Profile Image</h2>
					<div className="mb-6 flex items-center gap-6">
						<div className="flex-shrink-0">
							{imagePreview ? (
								<div className="relative">
									<img
										src={imagePreview}
										alt="Profile"
										className="h-32 w-32 rounded-full object-cover border-4 border-sky-200"
									/>
									<button
										type="button"
										onClick={handleRemoveImage}
										className="absolute -top-2 -right-2 rounded-full bg-red-500 p-1.5 text-white hover:bg-red-600 transition"
										title="Remove image"
									>
										<i className="fas fa-times text-xs" aria-hidden="true" />
									</button>
								</div>
							) : (
								<div className="flex h-32 w-32 items-center justify-center rounded-full bg-slate-200 border-4 border-slate-300">
									<i className="fas fa-user text-4xl text-slate-400" aria-hidden="true" />
								</div>
							)}
						</div>
						<div className="flex-1">
							<label className="mb-2 block text-sm font-medium text-slate-700">
								Upload Profile Image
							</label>
							<input
								type="file"
								accept="image/*"
								onChange={handleImageUpload}
								disabled={uploadingImage}
								className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-sky-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-sky-700 disabled:opacity-50"
							/>
							<p className="mt-2 text-xs text-slate-500">
								Recommended: Square image, max 2MB. JPG, PNG, or GIF format.
							</p>
							{uploadingImage && (
								<p className="mt-2 text-xs text-sky-600">
									<i className="fas fa-spinner fa-spin mr-1" aria-hidden="true" />
									Uploading image...
								</p>
							)}
						</div>
					</div>
				</div>

				<div className="section-card">
					<h2 className="mb-6 text-lg font-semibold text-slate-900">Personal Information</h2>

					<div className="space-y-6">
						{/* Basic Information */}
						<div className="grid gap-6 sm:grid-cols-2">
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Full Name <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={profileData.userName}
									onChange={handleFieldChange('userName')}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									required
								/>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
								<input
									type="email"
									value={profileData.userEmail}
									disabled
									className="w-full rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-600 cursor-not-allowed"
								/>
								<p className="mt-1 text-xs text-slate-500">Email cannot be changed</p>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Phone Number</label>
								<input
									type="tel"
									value={profileData.phone}
									onChange={handleFieldChange('phone')}
									placeholder="+91 1234567890"
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Date of Birth</label>
								<input
									type="date"
									value={profileData.dateOfBirth}
									onChange={handleFieldChange('dateOfBirth')}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Date of Joining</label>
								<input
									type="date"
									value={profileData.dateOfJoining}
									onChange={handleFieldChange('dateOfJoining')}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Gender</label>
								<select
									value={profileData.gender}
									onChange={handleFieldChange('gender')}
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								>
									<option value="">Select Gender</option>
									<option value="Male">Male</option>
									<option value="Female">Female</option>
									<option value="Other">Other</option>
									<option value="Prefer not to say">Prefer not to say</option>
								</select>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Blood Group</label>
								<div className="grid grid-cols-4 gap-3 mt-2">
									{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(group => (
										<label
											key={group}
											className={`flex items-center justify-center rounded-lg border-2 px-3 py-2 text-sm font-medium cursor-pointer transition ${
												profileData.bloodGroup === group
													? 'border-sky-600 bg-sky-50 text-sky-700'
													: 'border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
											}`}
										>
											<input
												type="radio"
												name="bloodGroup"
												value={group}
												checked={profileData.bloodGroup === group}
												onChange={handleFieldChange('bloodGroup')}
												className="sr-only"
											/>
											{group}
										</label>
									))}
								</div>
							</div>
						</div>

						{/* Address */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Address</label>
							<textarea
								value={profileData.address}
								onChange={handleFieldChange('address')}
								rows={3}
								placeholder="Enter your full address"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
					</div>
				</div>

				<div className="section-card">
					<h2 className="mb-6 text-lg font-semibold text-slate-900">Emergency Contact</h2>

					<div className="grid gap-6 sm:grid-cols-2">
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Emergency Contact Name</label>
							<input
								type="text"
								value={profileData.emergencyContact}
								onChange={handleFieldChange('emergencyContact')}
								placeholder="Full name"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Emergency Contact Phone</label>
							<input
								type="tel"
								value={profileData.emergencyPhone}
								onChange={handleFieldChange('emergencyPhone')}
								placeholder="+91 1234567890"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
					</div>
				</div>

				<div className="section-card">
					<h2 className="mb-6 text-lg font-semibold text-slate-900">Professional Information</h2>

					<div className="space-y-6">
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Qualifications</label>
							<input
								type="text"
								value={profileData.qualifications}
								onChange={handleFieldChange('qualifications')}
								placeholder="e.g., BPT, MPT, DPT"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Specialization</label>
							<input
								type="text"
								value={profileData.specialization}
								onChange={handleFieldChange('specialization')}
								placeholder="e.g., Sports Medicine, Orthopedics"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Years of Experience</label>
							<input
								type="text"
								value={profileData.experience}
								onChange={handleFieldChange('experience')}
								placeholder="e.g., 5 years"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Professional Aim</label>
							<textarea
								value={profileData.professionalAim}
								onChange={handleFieldChange('professionalAim')}
								rows={4}
								placeholder="Describe your professional goals and aspirations"
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
					</div>
				</div>

				<div className="section-card">
					<div className="mb-6 flex items-center justify-between">
						<h2 className="text-lg font-semibold text-slate-900">Change Password</h2>
						<button
							type="button"
							onClick={() => {
								setShowPasswordChange(!showPasswordChange);
								setPasswordError(null);
								setPasswordSuccess(false);
								if (!showPasswordChange) {
									setPasswordData({
										currentPassword: '',
										newPassword: '',
										confirmPassword: '',
									});
								}
							}}
							className="text-sm font-medium text-sky-600 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 rounded px-3 py-1.5"
						>
							{showPasswordChange ? (
								<>
									<i className="fas fa-times mr-1" aria-hidden="true" />
									Cancel
								</>
							) : (
								<>
									<i className="fas fa-key mr-1" aria-hidden="true" />
									Change Password
								</>
							)}
						</button>
					</div>

					{showPasswordChange && (
						<div className="space-y-6">
							{passwordSuccess && (
								<div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
									<i className="fas fa-check-circle mr-2" aria-hidden="true" />
									Password changed successfully!
								</div>
							)}

							{passwordError && (
								<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
									<i className="fas fa-exclamation-circle mr-2" aria-hidden="true" />
									{passwordError}
								</div>
							)}

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Current Password <span className="text-red-500">*</span>
								</label>
								<input
									type="password"
									value={passwordData.currentPassword}
									onChange={handlePasswordChange('currentPassword')}
									placeholder="Enter your current password"
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									autoComplete="current-password"
								/>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									New Password <span className="text-red-500">*</span>
								</label>
								<input
									type="password"
									value={passwordData.newPassword}
									onChange={handlePasswordChange('newPassword')}
									placeholder="Enter your new password (min. 6 characters)"
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									autoComplete="new-password"
								/>
								<p className="mt-1 text-xs text-slate-500">
									Password must be at least 6 characters long
								</p>
							</div>

							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Confirm New Password <span className="text-red-500">*</span>
								</label>
								<input
									type="password"
									value={passwordData.confirmPassword}
									onChange={handlePasswordChange('confirmPassword')}
									placeholder="Confirm your new password"
									className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									autoComplete="new-password"
								/>
							</div>

							<div className="flex justify-end">
								<button
									type="button"
									onClick={handleChangePassword}
									disabled={changingPassword || !passwordData.currentPassword.trim() || !passwordData.newPassword.trim() || !passwordData.confirmPassword.trim()}
									className="inline-flex items-center rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{changingPassword ? (
										<>
											<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
											Changing...
										</>
									) : (
										<>
											<i className="fas fa-save mr-2" aria-hidden="true" />
											Change Password
										</>
									)}
								</button>
							</div>
						</div>
					)}
				</div>

				{/* Save Button */}
				<div className="flex justify-end gap-4 border-t border-slate-200 pt-6">
					<button
						type="button"
						onClick={handleSave}
						disabled={saving || !profileData.userName.trim()}
						className="inline-flex items-center rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? (
							<>
								<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
								Saving...
							</>
						) : (
							<>
								<i className="fas fa-save mr-2" aria-hidden="true" />
								Save Profile
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	);
}

