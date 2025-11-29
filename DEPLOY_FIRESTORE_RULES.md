# How to Deploy Firestore Rules

## Quick Fix: Deploy Rules via Firebase Console

### Step 1: Open Firebase Console
1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Select your project: **centerforsportsandscience** (or your project name)
3. Click **"Build"** → **"Firestore Database"** in the left sidebar

### Step 2: Go to Rules Tab
1. Click on the **"Rules"** tab at the top of the Firestore Database page

### Step 3: Copy and Paste Rules
1. **Delete all existing rules** in the editor
2. Copy the entire contents of the `firestore.rules` file from your project
3. Paste it into the Rules editor in Firebase Console

### Step 4: Publish Rules
1. Click the **"Publish"** button (top right)
2. Wait for "Rules published successfully" message
3. Rules will be active immediately (no restart needed)

## Alternative: Deploy via Firebase CLI

If you have Firebase CLI installed and configured:

```bash
firebase deploy --only firestore:rules
```

## Verify Rules Are Active

After deploying, try adding or deleting an employee again. The permission errors should be resolved.

## Current Rules Include:

✅ **Notifications Collection** - Admins can create notifications for any user
✅ **Staff Collection** - Updated to check staff collection first
✅ **Role Lookup** - Checks both staff and users collections

## Troubleshooting

If you still see permission errors after deploying:

1. **Check you're logged in** - Make sure you're authenticated as an admin
2. **Hard refresh browser** - Press `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
3. **Check browser console** - Look for specific error messages
4. **Verify rules deployed** - Go back to Firebase Console → Rules tab and verify your rules are there

