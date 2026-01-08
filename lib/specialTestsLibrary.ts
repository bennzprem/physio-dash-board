export interface SpecialTest {
	id: string;
	name: string;
	category: string;
	description?: string;
	indication?: string;
}

export interface SpecialTestCategory {
	id: string;
	name: string;
	icon?: string;
	tests: SpecialTest[];
	subcategories?: {
		id: string;
		name: string;
		tests: SpecialTest[];
	}[];
}

export interface ConditionTestBundle {
	id: string;
	name: string;
	description: string;
	structures?: string[];
	primaryTests: SpecialTest[];
	secondaryTests?: SpecialTest[];
	diagnosticLogic?: string;
	warning?: string;
	testCluster?: {
		rule: string;
		minimumPositive?: number;
	};
}

// Master Special Tests Library by Joint
export const JOINT_WISE_SPECIAL_TESTS: SpecialTestCategory[] = [
	{
		id: 'cervical',
		name: 'Cervical Spine',
		tests: [
			{ id: 'cerv-compression', name: 'Cervical Compression Test', category: 'Mobility / Mechanical' },
			{ id: 'cerv-distraction', name: 'Cervical Distraction Test', category: 'Mobility / Mechanical' },
			{ id: 'spurlings', name: 'Spurling\'s Test', category: 'Mobility / Mechanical' },
			{ id: 'cerv-rotation', name: 'Cervical Rotation Test (C1–C2)', category: 'Mobility / Mechanical' },
			{ id: 'valsalva', name: 'Valsalva Maneuver', category: 'Neurological' },
			{ id: 'ultt', name: 'Upper Limb Tension Test (ULTT 1–4)', category: 'Neurological' },
			{ id: 'sharp-purser', name: 'Sharp-Purser Test (Atlantoaxial instability)', category: 'Neurological' },
			{ id: 'vertebral-artery', name: 'Vertebral Artery Test', category: 'Vascular / Red Flag' },
			{ id: 'alar-ligament', name: 'Alar Ligament Test', category: 'Vascular / Red Flag' },
		],
	},
	{
		id: 'thoracic',
		name: 'Thoracic Spine',
		tests: [
			{ id: 'thoracic-spring', name: 'Thoracic Spring Test', category: 'Mobility' },
			{ id: 'slump-thoracic', name: 'Slump Test (thoracic bias)', category: 'Mobility' },
			{ id: 'rib-compression', name: 'Rib Compression Test', category: 'Mobility' },
			{ id: 'costovertebral-spring', name: 'Costovertebral Joint Springing', category: 'Mobility' },
		],
	},
	{
		id: 'lumbar',
		name: 'Lumbar Spine',
		tests: [
			{ id: 'slr', name: 'Straight Leg Raise (SLR)', category: 'Disc / Neural' },
			{ id: 'crossed-slr', name: 'Crossed SLR', category: 'Disc / Neural' },
			{ id: 'slump', name: 'Slump Test', category: 'Disc / Neural' },
			{ id: 'femoral-nerve', name: 'Femoral Nerve Stretch Test', category: 'Disc / Neural' },
			{ id: 'prone-instability', name: 'Prone Instability Test', category: 'Stability' },
			{ id: 'passive-lumbar-ext', name: 'Passive Lumbar Extension Test', category: 'Stability' },
			{ id: 'faber', name: 'FABER Test', category: 'SI Joint' },
			{ id: 'gaenslens', name: 'Gaenslen\'s Test', category: 'SI Joint' },
			{ id: 'thigh-thrust', name: 'Thigh Thrust Test', category: 'SI Joint' },
			{ id: 'compression-distraction', name: 'Compression / Distraction Test', category: 'SI Joint' },
		],
	},
	{
		id: 'shoulder',
		name: 'Shoulder',
		tests: [
			{ id: 'neers', name: 'Neer\'s Test', category: 'Impingement' },
			{ id: 'hawkins-kennedy', name: 'Hawkins–Kennedy Test', category: 'Impingement' },
			{ id: 'painful-arc', name: 'Painful Arc', category: 'Impingement' },
			{ id: 'empty-can', name: 'Empty Can (Jobe\'s)', category: 'Rotator Cuff' },
			{ id: 'drop-arm', name: 'Drop Arm Test', category: 'Rotator Cuff' },
			{ id: 'er-lag', name: 'External Rotation Lag Sign', category: 'Rotator Cuff' },
			{ id: 'lift-off', name: 'Lift-Off Test', category: 'Rotator Cuff' },
			{ id: 'belly-press', name: 'Belly Press Test', category: 'Rotator Cuff' },
			{ id: 'apprehension', name: 'Apprehension Test', category: 'Instability' },
			{ id: 'relocation', name: 'Relocation Test', category: 'Instability' },
			{ id: 'sulcus', name: 'Sulcus Sign', category: 'Instability' },
			{ id: 'load-shift', name: 'Load and Shift Test', category: 'Instability' },
			{ id: 'obriens', name: 'O\'Brien\'s Test', category: 'Labrum' },
			{ id: 'crank', name: 'Crank Test', category: 'Labrum' },
			{ id: 'speeds', name: 'Speed\'s Test', category: 'Labrum' },
			{ id: 'yergason', name: 'Yergason\'s Test', category: 'Labrum' },
		],
	},
	{
		id: 'elbow',
		name: 'Elbow',
		tests: [
			{ id: 'cozens', name: 'Cozen\'s Test', category: 'Lateral / Medial Epicondylitis' },
			{ id: 'mills', name: 'Mill\'s Test', category: 'Lateral / Medial Epicondylitis' },
			{ id: 'golfers-elbow', name: 'Golfer\'s Elbow Test', category: 'Lateral / Medial Epicondylitis' },
			{ id: 'valgus-stress', name: 'Valgus Stress Test', category: 'Ligamentous' },
			{ id: 'varus-stress', name: 'Varus Stress Test', category: 'Ligamentous' },
			{ id: 'moving-valgus', name: 'Moving Valgus Stress Test', category: 'Ligamentous' },
			{ id: 'tinel-cubital', name: 'Tinel\'s Sign (Cubital Tunnel)', category: 'Nerve' },
		],
	},
	{
		id: 'wrist-hand',
		name: 'Wrist & Hand',
		tests: [
			{ id: 'phalens', name: 'Phalen\'s Test', category: 'Carpal Tunnel / Nerve' },
			{ id: 'reverse-phalens', name: 'Reverse Phalen\'s', category: 'Carpal Tunnel / Nerve' },
			{ id: 'tinel-median', name: 'Tinel\'s Sign (Median nerve)', category: 'Carpal Tunnel / Nerve' },
			{ id: 'finkelstein', name: 'Finkelstein\'s Test', category: 'Ligament / Joint' },
			{ id: 'watson', name: 'Watson\'s (Scaphoid shift)', category: 'Ligament / Joint' },
			{ id: 'grind-cmc', name: 'Grind Test (CMC joint)', category: 'Ligament / Joint' },
		],
	},
	{
		id: 'hip',
		name: 'Hip',
		tests: [
			{ id: 'fadir', name: 'FADIR Test', category: 'Labral / Intra-articular' },
			{ id: 'faber-hip', name: 'FABER Test', category: 'Labral / Intra-articular' },
			{ id: 'scour', name: 'Scour Test', category: 'Labral / Intra-articular' },
			{ id: 'thomas', name: 'Thomas Test', category: 'Muscle Length' },
			{ id: 'elys', name: 'Ely\'s Test', category: 'Muscle Length' },
			{ id: 'obers', name: 'Ober\'s Test', category: 'Muscle Length' },
			{ id: 'trendelenburg', name: 'Trendelenburg Test', category: 'Stability' },
		],
	},
	{
		id: 'knee',
		name: 'Knee',
		tests: [
			{ id: 'lachman', name: 'Lachman Test', category: 'Ligaments' },
			{ id: 'ant-drawer', name: 'Anterior Drawer Test', category: 'Ligaments' },
			{ id: 'post-drawer', name: 'Posterior Drawer Test', category: 'Ligaments' },
			{ id: 'valgus-stress-knee', name: 'Valgus Stress Test', category: 'Ligaments' },
			{ id: 'varus-stress-knee', name: 'Varus Stress Test', category: 'Ligaments' },
			{ id: 'pivot-shift', name: 'Pivot Shift Test', category: 'Ligaments' },
			{ id: 'mcmurray', name: 'McMurray\'s Test', category: 'Meniscus' },
			{ id: 'thessaly', name: 'Thessaly Test', category: 'Meniscus' },
			{ id: 'apley', name: 'Apley\'s Compression Test', category: 'Meniscus' },
			{ id: 'clarkes', name: 'Clarke\'s Test', category: 'Patellofemoral' },
			{ id: 'patellar-grind', name: 'Patellar Grind Test', category: 'Patellofemoral' },
			{ id: 'patellar-apprehension', name: 'Patellar Apprehension Test', category: 'Patellofemoral' },
		],
	},
	{
		id: 'ankle-foot',
		name: 'Ankle & Foot',
		tests: [
			{ id: 'ant-drawer-ankle', name: 'Anterior Drawer Test (Ankle)', category: 'Ligamentous' },
			{ id: 'talar-tilt', name: 'Talar Tilt Test', category: 'Ligamentous' },
			{ id: 'ext-rotation-stress', name: 'External Rotation Stress Test', category: 'Ligamentous' },
			{ id: 'thompson', name: 'Thompson Test (Achilles)', category: 'Tendon / Fascia' },
			{ id: 'windlass', name: 'Windlass Test (Plantar Fascia)', category: 'Tendon / Fascia' },
			{ id: 'navicular-drop', name: 'Navicular Drop Test', category: 'Foot Structure' },
			{ id: 'coleman-block', name: 'Coleman Block Test', category: 'Foot Structure' },
		],
	},
	{
		id: 'tmj',
		name: 'TMJ',
		tests: [
			{ id: 'tmj-compression', name: 'TMJ Compression Test', category: 'Mobility' },
			{ id: 'tmj-distraction', name: 'TMJ Distraction Test', category: 'Mobility' },
			{ id: 'deviation-opening', name: 'Deviation on Opening', category: 'Mobility' },
			{ id: 'auscultation', name: 'Auscultation / Crepitus Test', category: 'Mobility' },
		],
	},
	{
		id: 'neurodynamic',
		name: 'Neurodynamic Tests (Global)',
		tests: [
			{ id: 'slr-neural', name: 'Straight Leg Raise (Neural bias)', category: 'Neural Tension' },
			{ id: 'slump-neural', name: 'Slump Test', category: 'Neural Tension' },
			{ id: 'median-nerve', name: 'Median Nerve Tension Test', category: 'Neural Tension' },
			{ id: 'ulnar-nerve', name: 'Ulnar Nerve Tension Test', category: 'Neural Tension' },
			{ id: 'radial-nerve', name: 'Radial Nerve Tension Test', category: 'Neural Tension' },
		],
	},
];

// Condition-Specific Special Tests Bundles
export const CONDITION_TEST_BUNDLES: ConditionTestBundle[] = [
	{
		id: 'cervical-radiculopathy',
		name: 'Cervical Radiculopathy',
		description: 'Nerve root compression (C5–C8), intervertebral disc / foramina',
		structures: ['Nerve root (C5–C8)', 'Intervertebral disc / foramina'],
		primaryTests: [
			{ id: 'spurlings', name: 'Spurling\'s Test', category: 'Primary' },
			{ id: 'cerv-distraction', name: 'Cervical Distraction Test', category: 'Primary' },
			{ id: 'cerv-compression', name: 'Cervical Compression Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'ultt', name: 'Upper Limb Tension Test (ULTT)', category: 'Secondary' },
			{ id: 'cerv-rom', name: 'Cervical ROM (limited + painful)', category: 'Secondary' },
			{ id: 'shoulder-abd-relief', name: 'Shoulder abduction relief sign', category: 'Secondary' },
		],
		diagnosticLogic: 'Spurling + ULTT + dermatomal symptoms → High probability. Distraction reduces pain → Confirms neural compression',
	},
	{
		id: 'cervical-myelopathy',
		name: 'Cervical Myelopathy (RED FLAG)',
		description: '',
		warning: 'RED FLAG - Immediate referral',
		primaryTests: [
			{ id: 'hoffmanns', name: 'Hoffmann\'s Sign', category: 'Primary' },
			{ id: 'babinski', name: 'Babinski Sign', category: 'Primary' },
			{ id: 'clonus', name: 'Clonus', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'gait-disturbance', name: 'Gait disturbance', category: 'Supporting' },
			{ id: 'bilateral-symptoms', name: 'Bilateral symptoms', category: 'Supporting' },
			{ id: 'fine-motor-loss', name: 'Loss of fine motor control', category: 'Supporting' },
		],
		diagnosticLogic: '',
	},
	{
		id: 'rotator-cuff-tendinopathy',
		name: 'Rotator Cuff Tendinopathy / Tear',
		description: 'Supraspinatus, Infraspinatus, Subscapularis',
		structures: ['Supraspinatus', 'Infraspinatus', 'Subscapularis'],
		primaryTests: [
			{ id: 'empty-can', name: 'Empty Can (Jobe\'s)', category: 'Primary' },
			{ id: 'er-lag', name: 'External Rotation Lag Sign', category: 'Primary' },
			{ id: 'lift-off', name: 'Lift‑Off / Belly Press (Subscapularis)', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'drop-arm', name: 'Drop Arm Test', category: 'Secondary' },
			{ id: 'painful-arc', name: 'Painful Arc', category: 'Secondary' },
			{ id: 'resisted-er-ir', name: 'Resisted ER/IR weakness', category: 'Secondary' },
		],
		diagnosticLogic: 'Weakness + pain → tendinopathy. Lag sign / inability → tear',
	},
	{
		id: 'subacromial-impingement',
		name: 'Subacromial Impingement Syndrome',
		description: 'Impingement of subacromial structures',
		primaryTests: [
			{ id: 'neers', name: 'Neer\'s Test', category: 'Primary' },
			{ id: 'hawkins-kennedy', name: 'Hawkins–Kennedy Test', category: 'Primary' },
			{ id: 'painful-arc', name: 'Painful Arc (60–120°)', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'scap-dyskinesis', name: 'Scapular dyskinesis observation', category: 'Secondary' },
			{ id: 'rc-strength', name: 'RC strength tests', category: 'Secondary' },
		],
		diagnosticLogic: '≥2 impingement tests positive → probable impingement. Pain improves with scapular correction → functional cause',
	},
	{
		id: 'shoulder-instability-anterior',
		name: 'Shoulder Instability (Anterior)',
		description: 'Anterior labrum and capsule',
		structures: ['Labrum', 'Anterior capsule'],
		primaryTests: [
			{ id: 'apprehension', name: 'Apprehension Test', category: 'Primary' },
			{ id: 'relocation', name: 'Relocation Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'sulcus', name: 'Sulcus Sign', category: 'Secondary' },
			{ id: 'load-shift', name: 'Load & Shift Test', category: 'Secondary' },
		],
		diagnosticLogic: 'Apprehension relieved by relocation → true instability. Pain only (no fear) → likely RC / impingement',
	},
	{
		id: 'slap-labral',
		name: 'SLAP / Labral Lesion',
		description: 'Superior labrum anterior-posterior lesion',
		primaryTests: [
			{ id: 'obriens', name: 'O\'Brien\'s Test', category: 'Primary' },
			{ id: 'crank', name: 'Crank Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'speeds', name: 'Speed\'s Test', category: 'Secondary' },
			{ id: 'yergason', name: 'Yergason\'s Test', category: 'Secondary' },
		],
		diagnosticLogic: 'Deep joint pain + clicking + positive O\'Brien\'s → SLAP',
	},
	{
		id: 'lateral-epicondylitis',
		name: 'Lateral Epicondylitis (Tennis Elbow)',
		description: 'Lateral epicondyle tendinopathy',
		primaryTests: [
			{ id: 'cozens', name: 'Cozen\'s Test', category: 'Primary' },
			{ id: 'mills', name: 'Mill\'s Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'grip-pain', name: 'Grip strength pain', category: 'Secondary' },
			{ id: 'resisted-wrist-ext', name: 'Resisted wrist extension', category: 'Secondary' },
		],
		diagnosticLogic: 'Pain at lateral epicondyle with resisted wrist extension → positive',
	},
	{
		id: 'medial-epicondylitis',
		name: 'Medial Epicondylitis (Golfer\'s Elbow)',
		description: 'Medial epicondyle tendinopathy',
		primaryTests: [
			{ id: 'golfers-elbow', name: 'Golfer\'s Elbow Test', category: 'Primary' },
			{ id: 'resisted-wrist-flex', name: 'Resisted wrist flexion + pronation', category: 'Primary' },
		],
	},
	{
		id: 'carpal-tunnel',
		name: 'Carpal Tunnel Syndrome',
		description: 'Median nerve compression',
		structures: ['Median nerve'],
		primaryTests: [
			{ id: 'phalens', name: 'Phalen\'s Test', category: 'Primary' },
			{ id: 'tinel-median', name: 'Tinel\'s Sign', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'reverse-phalens', name: 'Reverse Phalen\'s', category: 'Secondary' },
			{ id: 'thenar-wasting', name: 'Thenar wasting', category: 'Secondary' },
		],
		diagnosticLogic: 'Night pain + tingling + Phalen\'s → CTS likely',
	},
	{
		id: 'de-quervains',
		name: 'De Quervain\'s Tenosynovitis',
		description: 'Radial styloid tenosynovitis',
		primaryTests: [
			{ id: 'finkelstein', name: 'Finkelstein\'s Test', category: 'Primary' },
		],
		diagnosticLogic: 'Sharp pain over radial styloid → positive',
	},
	{
		id: 'fai',
		name: 'Femoroacetabular Impingement (FAI)',
		description: 'Hip impingement syndrome',
		primaryTests: [
			{ id: 'fadir', name: 'FADIR Test', category: 'Primary' },
			{ id: 'scour', name: 'Scour Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'limited-hip-ir', name: 'Limited hip IR', category: 'Secondary' },
			{ id: 'deep-groin-pain', name: 'Deep groin pain', category: 'Secondary' },
		],
		diagnosticLogic: 'FADIR + deep pain → FAI suspected',
	},
	{
		id: 'hip-labral-tear',
		name: 'Hip Labral Tear',
		description: 'Acetabular labrum injury',
		primaryTests: [
			{ id: 'scour', name: 'Scour Test', category: 'Primary' },
			{ id: 'faber-hip', name: 'FABER Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'clicking-locking', name: 'Clicking / locking', category: 'Supporting' },
			{ id: 'pivot-pain', name: 'Pain with pivoting', category: 'Supporting' },
		],
	},
	{
		id: 'acl-injury',
		name: 'ACL Injury',
		description: 'Anterior cruciate ligament injury',
		primaryTests: [
			{ id: 'lachman', name: 'Lachman Test', category: 'Primary' },
			{ id: 'pivot-shift', name: 'Pivot Shift Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'ant-drawer', name: 'Anterior Drawer Test', category: 'Secondary' },
		],
		diagnosticLogic: 'Lachman positive = gold standard',
	},
	{
		id: 'pcl-injury',
		name: 'PCL Injury',
		description: 'Posterior cruciate ligament injury',
		primaryTests: [
			{ id: 'post-drawer', name: 'Posterior Drawer Test', category: 'Primary' },
			{ id: 'sag-sign', name: 'Sag Sign', category: 'Primary' },
		],
	},
	{
		id: 'meniscal-injury',
		name: 'Meniscal Injury',
		description: 'Meniscus tear',
		primaryTests: [
			{ id: 'thessaly', name: 'Thessaly Test', category: 'Primary' },
			{ id: 'mcmurray', name: 'McMurray\'s Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'apley', name: 'Apley\'s Compression Test', category: 'Secondary' },
		],
		diagnosticLogic: 'Joint line pain + clicking + Thessaly → meniscus',
	},
	{
		id: 'pfps',
		name: 'Patellofemoral Pain Syndrome',
		description: 'Patellofemoral dysfunction',
		primaryTests: [
			{ id: 'patellar-apprehension', name: 'Patellar Apprehension Test', category: 'Primary' },
			{ id: 'clarkes', name: 'Clarke\'s Test (use cautiously)', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'maltracking', name: 'Maltracking', category: 'Supporting' },
			{ id: 'vmo-weakness', name: 'VMO weakness', category: 'Supporting' },
		],
	},
	{
		id: 'lateral-ankle-sprain',
		name: 'Lateral Ankle Sprain (ATFL)',
		description: 'Anterior talofibular ligament injury',
		primaryTests: [
			{ id: 'ant-drawer-ankle', name: 'Anterior Drawer Test (Ankle)', category: 'Primary' },
			{ id: 'talar-tilt', name: 'Talar Tilt Test', category: 'Primary' },
		],
	},
	{
		id: 'achilles-rupture',
		name: 'Achilles Tendon Rupture',
		description: 'Achilles tendon complete tear',
		primaryTests: [
			{ id: 'thompson', name: 'Thompson Test', category: 'Primary' },
		],
	},
	{
		id: 'plantar-fasciitis',
		name: 'Plantar Fasciitis',
		description: 'Plantar fascia inflammation',
		primaryTests: [
			{ id: 'windlass', name: 'Windlass Test', category: 'Primary' },
		],
		secondaryTests: [
			{ id: 'morning-heel-pain', name: 'Morning heel pain', category: 'Supporting' },
			{ id: 'medial-calcaneal-tenderness', name: 'Medial calcaneal tenderness', category: 'Supporting' },
		],
	},
	{
		id: 'sij-dysfunction',
		name: 'Sacroiliac Joint Dysfunction',
		description: 'SI joint pain and dysfunction',
		primaryTests: [
			{ id: 'thigh-thrust', name: 'Thigh Thrust', category: 'Primary' },
			{ id: 'compression-test', name: 'Compression Test', category: 'Primary' },
			{ id: 'distraction-test', name: 'Distraction Test', category: 'Primary' },
			{ id: 'gaenslens', name: 'Gaenslen\'s Test', category: 'Primary' },
			{ id: 'faber', name: 'FABER Test', category: 'Primary' },
		],
		testCluster: {
			rule: '≥3 positive tests → SIJ pain likely',
			minimumPositive: 3,
		},
		diagnosticLogic: 'Test Cluster: ≥3 positive tests → SIJ pain likely',
	},
];

// Helper function to get tests by joint
export function getTestsByJoint(jointId: string): SpecialTest[] {
	const category = JOINT_WISE_SPECIAL_TESTS.find(cat => cat.id === jointId);
	return category?.tests || [];
}

// Helper function to get tests by condition
export function getTestsByCondition(conditionId: string): ConditionTestBundle | undefined {
	return CONDITION_TEST_BUNDLES.find(bundle => bundle.id === conditionId);
}

// Helper function to search tests
export function searchSpecialTests(query: string): SpecialTest[] {
	const queryLower = query.toLowerCase();
	const allTests: SpecialTest[] = [];
	
	JOINT_WISE_SPECIAL_TESTS.forEach(category => {
		allTests.push(...category.tests);
	});
	
	CONDITION_TEST_BUNDLES.forEach(bundle => {
		allTests.push(...bundle.primaryTests);
		if (bundle.secondaryTests) {
			allTests.push(...bundle.secondaryTests);
		}
	});
	
	return allTests.filter(test => 
		test.name.toLowerCase().includes(queryLower) ||
		test.category.toLowerCase().includes(queryLower)
	);
}

