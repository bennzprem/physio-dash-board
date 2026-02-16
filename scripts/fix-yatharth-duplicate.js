/**
 * One-time script: keep a single patient named "Yatharth" and remove duplicates.
 * For each duplicate (e.g. "yatharth" or "Yathrath"): deletes their appointments,
 * billing records, then the patient document.
 *
 * Usage: node scripts/fix-yatharth-duplicate.js
 *
 * Loads credentials from (in order):
 * 1. FIREBASE_SERVICE_ACCOUNT_KEY (JSON string in env)
 * 2. GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)
 * 3. firebase-service-account.json in project root
 * Loads .env.local and .env for project/database ID.
 */

const path = require('path');
const fs = require('fs');

// Load env from .env.local and .env so NEXT_PUBLIC_FIREBASE_* are set
try {
  const dotenv = require('dotenv');
  const cwd = process.cwd();
  dotenv.config({ path: path.join(cwd, '.env.local') });
  dotenv.config({ path: path.join(cwd, '.env') });
} catch (_) {}

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';
const DEFAULT_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'sixs-physio';

function getAdminEnv(key) {
  const stagingKey = `FIREBASE_ADMIN_STAGING_${key}`;
  const prodKey = `FIREBASE_ADMIN_${key}`;
  return isStaging
    ? (process.env[stagingKey] || process.env[prodKey])
    : (process.env[prodKey] || process.env[stagingKey]);
}

function buildServiceAccountFromFragments() {
  const projectId = getAdminEnv('PROJECT_ID');
  const clientEmail = getAdminEnv('CLIENT_EMAIL');
  const privateKey = getAdminEnv('PRIVATE_KEY');
  if (!projectId || !clientEmail || !privateKey) return null;
  const normalizedKey = (privateKey || '').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  return {
    type: 'service_account',
    project_id: projectId,
    private_key: normalizedKey,
    private_key_id: getAdminEnv('PRIVATE_KEY_ID') || 'auto-generated-key',
    client_email: clientEmail,
    client_id: getAdminEnv('CLIENT_ID'),
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(clientEmail)}`,
  };
}

function getServiceAccount() {
  const cwd = process.cwd();

  const fromFragments = buildServiceAccountFromFragments();
  if (fromFragments) {
    console.log('Using credentials from FIREBASE_ADMIN_* env vars');
    return fromFragments;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
      if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
        raw = raw.slice(1, -1);
      }
      const key = JSON.parse(raw);
      console.log('Using credentials from FIREBASE_SERVICE_ACCOUNT_KEY');
      return key;
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(cwd, 'firebase-service-account.json');
  if (fs.existsSync(credPath)) {
    try {
      const key = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      console.log('Using credentials from', path.basename(credPath));
      return key;
    } catch (e) {
      console.error('Failed to read credentials file:', e.message);
    }
  }

  return null;
}

function getProjectId(serviceAccount) {
  return (serviceAccount && serviceAccount.project_id) ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    DEFAULT_PROJECT_ID;
}

function getDatabaseId() {
  const id = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
    process.env.FIREBASE_DATABASE_ID;
  if (!id || id === '(default)' || id.toLowerCase() === 'default') return undefined;
  return id;
}

const serviceAccount = getServiceAccount();
if (!serviceAccount) {
  console.error('No Firebase credentials found. Set one of:');
  console.error('  - FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY (in .env.local)');
  console.error('  - FIREBASE_SERVICE_ACCOUNT_KEY (JSON string)');
  console.error('  - GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)');
  console.error('  - Or place firebase-service-account.json in the project root');
  process.exit(1);
}

const projectId = getProjectId(serviceAccount);
const databaseId = getDatabaseId();

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId,
  });
}

const db = databaseId ? getFirestore(getApps()[0], databaseId) : getFirestore(getApps()[0]);
console.log('Firebase: project', projectId, databaseId ? `, database ${databaseId}` : '', '\n');

const TARGET_NAME = 'Yatharth';
const NAME_VARIANTS = ['yatharth', 'yathrath']; // case-insensitive match

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

function isYatharthVariant(name) {
  const n = normalizeName(name);
  return NAME_VARIANTS.some(v => n === v);
}

/** Delete all appointments and billing for a patientId, then delete the patient doc. */
async function deletePatientAndRelated(patientDocId, patientId) {
  const batch = db.batch();

  const appointmentsSnap = await db.collection('appointments').where('patientId', '==', patientId).get();
  appointmentsSnap.docs.forEach((doc) => batch.delete(doc.ref));

  const billingSnap = await db.collection('billing').where('patientId', '==', patientId).get();
  billingSnap.docs.forEach((doc) => batch.delete(doc.ref));

  batch.delete(db.collection('patients').doc(patientDocId));
  await batch.commit();

  return { appointments: appointmentsSnap.size, billing: billingSnap.size };
}

async function fixYatharthDuplicate() {
  try {
    console.log('Finding patients named Yatharth / Yathrath (any case)...\n');

    const patientsRef = db.collection('patients');
    const snapshot = await patientsRef.get();

    const matches = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const name = (data.name || '').trim();
      if (isYatharthVariant(name)) {
        matches.push({
          id: doc.id,
          patientId: data.patientId || '',
          name,
          ...data,
        });
      }
    });

    console.log(`Found ${matches.length} patient(s) matching Yatharth/Yathrath.\n`);

    if (matches.length === 0) {
      console.log('No matching patients. Nothing to do.');
      return;
    }

    if (matches.length === 1) {
      const one = matches[0];
      if (one.name === TARGET_NAME) {
        console.log(`Single patient already named "${TARGET_NAME}". No change.`);
        return;
      }
      console.log(`Updating single patient name to "${TARGET_NAME}" (was "${one.name}").`);
      await patientsRef.doc(one.id).update({ name: TARGET_NAME });
      console.log('Done.');
      return;
    }

    // Multiple: keep one (prefer one already named "Yatharth"), delete the rest with appointments + billing
    const toKeep = matches.find(m => m.name === TARGET_NAME) || matches[0];
    const toDelete = matches.filter(m => m.id !== toKeep.id);

    console.log(`Keeping patient: doc id ${toKeep.id}, patientId ${toKeep.patientId}, name "${toKeep.name}"`);
    if (toKeep.name !== TARGET_NAME) {
      console.log(`  -> Updating name to "${TARGET_NAME}".`);
      await patientsRef.doc(toKeep.id).update({ name: TARGET_NAME });
    }

    console.log(`\nRemoving ${toDelete.length} duplicate(s) (appointments + billing + patient):`);
    for (const p of toDelete) {
      console.log(`  - ${p.id} (patientId: ${p.patientId}, name: "${p.name}")`);
      const counts = await deletePatientAndRelated(p.id, p.patientId);
      console.log(`    Deleted ${counts.appointments} appointment(s), ${counts.billing} billing record(s), and patient.`);
    }

    console.log('\nDone. One patient "Yatharth" remains.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixYatharthDuplicate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
