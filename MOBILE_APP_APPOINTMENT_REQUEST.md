# How to Create Appointment Requests from the Patient Mobile App

This guide shows how to add a document to Firestore so an **appointment request** appears on the dashboard **Requests** page.

**Where this code runs:** In the **patient Flutter mobile app** (not in the dashboard). The dashboard only reads and displays requests; the Flutter app writes them.

---

## Flutter (Dart) — use this in your patient app

Add this in your Flutter project (e.g. a service or screen where the user taps “Request appointment”):

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

Future<String?> requestAppointment({
  required String patientName,
  String? patientId,
  String? preferredDate,   // 'YYYY-MM-DD'
  String? preferredTime,   // 'HH:mm' e.g. '10:00'
  String? notes,
}) async {
  try {
    final docRef = await FirebaseFirestore.instance.collection('appointments').add({
      'status': 'requested',
      'patient': patientName,
      'patientId': patientId,
      'preferredDate': preferredDate,
      'preferredTime': preferredTime,
      'notes': notes,
      'source': 'mobile_app',
      'createdAt': FieldValue.serverTimestamp(),
    });
    return docRef.id;
  } catch (e) {
    debugPrint('Failed to submit appointment request: $e');
    rethrow;
  }
}
```

**Dependencies** (in your Flutter app’s `pubspec.yaml`):

```yaml
dependencies:
  firebase_core: ^2.24.0
  cloud_firestore: ^4.13.0
  firebase_auth: ^4.15.0
```

**Important:** The patient must be **signed in** (Firebase Auth) before calling this; otherwise Firestore rules will deny the write.

---

## Prerequisites

1. **Same Firebase project** as the dashboard (use the same `projectId` and config).
2. **Patient must be signed in** with Firebase Auth (email/password, phone, or anonymous). The Firestore rules only allow creating `requested` appointments when the user is logged in.

---

## 1. Firebase setup in the mobile app

Install the Firebase SDK and initialise it with your project config (same as the dashboard).

- **React Native**: `@react-native-firebase/app`, `@react-native-firebase/firestore`, `@react-native-firebase/auth`
- **Flutter**: `firebase_core`, `cloud_firestore`, `firebase_auth`
- **Expo**: Use a compatible Firebase JS SDK or Expo’s config plugins for native Firebase.

Use the **same API key, project ID, etc.** as in the dashboard’s Firebase config.

---

## 2. Create the appointment request document

When the patient taps “Request appointment” (or similar), call Firestore to add a document to the `appointments` collection with `status: 'requested'`.

### React Native (JavaScript/TypeScript) with React Native Firebase

```javascript
import firestore from '@react-native-firebase/firestore';

async function requestAppointment({
  patientName,
  patientId = null,
  preferredDate = null,
  preferredTime = null,
  notes = null,
}) {
  try {
    const docRef = await firestore().collection('appointments').add({
      status: 'requested',
      patient: patientName,
      patientId: patientId ?? null,
      preferredDate: preferredDate ?? null,  // 'YYYY-MM-DD'
      preferredTime: preferredTime ?? null,  // 'HH:mm' e.g. '10:00'
      notes: notes ?? null,
      source: 'mobile_app',
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error('Failed to submit appointment request', error);
    throw error;
  }
}

// Example: user tapped "Request appointment"
await requestAppointment({
  patientName: 'John Doe',
  patientId: 'P12345',           // optional, from your patients collection
  preferredDate: '2025-02-15',
  preferredTime: '10:00',
  notes: 'Would prefer morning slot',
});
```

### Web / Expo (modular Firebase JS SDK v9+)

```javascript
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

const db = getFirestore();

async function requestAppointment({
  patientName,
  patientId = null,
  preferredDate = null,
  preferredTime = null,
  notes = null,
}) {
  const docRef = await addDoc(collection(db, 'appointments'), {
    status: 'requested',
    patient: patientName,
    patientId: patientId ?? null,
    preferredDate: preferredDate ?? null,
    preferredTime: preferredTime ?? null,
    notes: notes ?? null,
    source: 'mobile_app',
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}
```

### Flutter (Dart)

```dart
import 'package:cloud_firestore/cloud_firestore.dart';

Future<String?> requestAppointment({
  required String patientName,
  String? patientId,
  String? preferredDate,
  String? preferredTime,
  String? notes,
}) async {
  try {
    final docRef = await FirebaseFirestore.instance.collection('appointments').add({
      'status': 'requested',
      'patient': patientName,
      'patientId': patientId,
      'preferredDate': preferredDate,
      'preferredTime': preferredTime,
      'notes': notes,
      'source': 'mobile_app',
      'createdAt': FieldValue.serverTimestamp(),
    });
    return docRef.id;
  } catch (e) {
    debugPrint('Failed to submit appointment request: $e');
    rethrow;
  }
}
```

---

## 3. Required and optional fields

| Field           | Required | Type     | Example / notes                          |
|----------------|----------|----------|------------------------------------------|
| `status`       | Yes      | string   | Must be `'requested'`                    |
| `patient`      | Yes      | string   | Patient full name                        |
| `patientId`    | No       | string   | Your patient ID if you have one         |
| `preferredDate`| No       | string   | `'YYYY-MM-DD'` e.g. `'2025-02-15'`      |
| `preferredTime`| No       | string   | `'HH:mm'` e.g. `'10:00'` or `'14:30'`   |
| `notes`        | No       | string   | Message from the patient                 |
| `source`       | No       | string   | e.g. `'mobile_app'`                      |
| `createdAt`    | No       | Timestamp| `serverTimestamp()` (recommended)         |

---

## 4. Authentication

The dashboard’s Firestore rules allow **create** only when:

- The user is **signed in** (`isLoggedIn()`), and  
- The new document has `status == 'requested'` and a `patient` field.

So before calling the code above:

1. Sign the user in (e.g. `signInWithEmailAndPassword`, phone auth, or `signInAnonymously`).
2. Then call `requestAppointment(...)`.

If you don’t want to use Auth in the app, you would need a backend (e.g. Cloud Function) that uses the Admin SDK to write to `appointments` with `status: 'requested'` instead.

---

## 5. After submitting

- The new document appears under **Requests** on the dashboard.
- Staff can **Confirm & schedule** (set doctor, date, time → becomes a normal appointment) or **Reject** (status set to cancelled).

If you tell me your stack (React Native, Flutter, Expo, etc.), I can adapt this to your exact project structure and file names.
