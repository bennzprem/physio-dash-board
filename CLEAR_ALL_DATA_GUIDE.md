# Clear All Data Guide

⚠️ **WARNING: This will DELETE ALL DATA permanently!**

This guide explains how to delete all Firestore collections and Firebase Authentication users to start fresh.

## What Will Be Deleted

1. **All Firestore Collections** - All documents in all collections will be deleted
2. **All Firebase Auth Users** - All authentication accounts will be deleted

⚠️ **THIS CANNOT BE UNDONE!** Make sure you have backups if you need to restore any data.

## Prerequisites

1. **Firebase Admin SDK configured**
   - Set `FIREBASE_SERVICE_ACCOUNT_KEY` in your `.env.local` file, OR
   - Set `GOOGLE_APPLICATION_CREDENTIALS` pointing to your service account JSON file

2. **Project ID configured**
   - Set `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in your `.env.local` file

3. **Node.js installed**
   - Make sure you can run Node.js scripts

## Method 1: Using the Script (Recommended)

### Step 1: Run the Script

```bash
node scripts/clear-all-data.js
```

### Step 2: Confirm Deletion

The script will ask you to type `DELETE ALL` to confirm. This is a safety measure.

```
⚠️  DANGER: DATA DELETION SCRIPT ⚠️

This script will DELETE:
  1. ALL documents from ALL Firestore collections
  2. ALL Firebase Authentication users

⚠️  THIS CANNOT BE UNDONE! ⚠️

Type "DELETE ALL" to confirm:
```

### Step 3: Wait for Completion

The script will:
1. List all collections found
2. Delete all documents from each collection
3. List all Firebase Auth users
4. Delete all Firebase Auth users
5. Show a success message

## Method 2: Manual Deletion via Firebase Console

### Delete Firestore Collections

1. **Open Firebase Console**
   - Go to [https://console.firebase.google.com](https://console.firebase.google.com)
   - Select your project
   - Click **"Build"** → **"Firestore Database"**

2. **Delete Each Collection**
   - Click on each collection name
   - Select all documents (Ctrl+A or Cmd+A)
   - Click the delete icon (trash can)
   - Confirm deletion
   - Repeat for all collections

### Delete Firebase Auth Users

1. **Open Authentication**
   - In Firebase Console, click **"Build"** → **"Authentication"**
   - Click **"Users"** tab

2. **Delete All Users**
   - Select all users (check the box at the top)
   - Click **"Delete selected users"**
   - Confirm deletion

## Method 3: Using Firebase CLI

### Delete Firestore Collections

```bash
# Install Firebase CLI if not installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Delete all documents (requires Firestore rules to allow deletion)
# Note: This requires custom scripts or manual deletion
```

## After Clearing Data

### 1. Create Your First Admin User

After clearing all data, create a new admin user:

```bash
node scripts/create-admin-user.js
```

This will create:
- A Firebase Auth user with email: `admincss@test.com`
- Password: `admin123`
- A Firestore document in the `users` collection with Admin role

### 2. Update Firestore Rules

Make sure your Firestore rules are set correctly (see `DEPLOY_FIRESTORE_RULES.md`)

### 3. Start Adding Data

- Add employees via Admin Dashboard
- Add patients via Front Desk Dashboard
- Create appointments
- Set up billing records

## Troubleshooting

### Error: "Firebase Admin SDK credentials not found"

**Solution**: Make sure you have set up Firebase Admin SDK credentials:
- Set `FIREBASE_SERVICE_ACCOUNT_KEY` in `.env.local`, OR
- Set `GOOGLE_APPLICATION_CREDENTIALS` to point to your service account JSON file

### Error: "Permission denied"

**Solution**: Make sure your Firestore rules allow deletion temporarily:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // Temporary for deletion
    }
  }
}
```

### Error: "Database not found"

**Solution**: 
- Check that `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is set correctly
- Verify the project ID matches your Firebase Console project

## Safety Tips

1. **Backup First**: Export important data before clearing
2. **Test Environment**: Consider using a staging/test project first
3. **Double Check**: Verify you're working with the correct Firebase project
4. **Document**: Note down any important data you might need later

## Collections That Will Be Deleted

The script will delete all documents from these collections (if they exist):
- `users`
- `staff`
- `patients`
- `appointments`
- `billing`
- `notifications`
- `activities`
- `transferRequests`
- `transferHistory`
- `sessionTransfers`
- `reportVersions`
- `strengthConditioningReports`
- `headerConfigs`
- `notificationPreferences`
- `availabilityTemplates`
- `appointmentTemplates`
- And any other collections in your database

## Next Steps

After clearing all data:
1. ✅ Create your first admin user
2. ✅ Add employees via Admin Dashboard
3. ✅ Add patients via Front Desk Dashboard
4. ✅ Set up appointments
5. ✅ Configure billing settings

Good luck with your fresh start! 🚀



