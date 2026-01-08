export interface Exercise {
	id: string;
	name: string;
	category: string;
	subcategory?: string;
	description?: string;
	phase?: string;
	notes?: string;
}

export interface ExerciseCategory {
	id: string;
	name: string;
	icon?: string;
	exercises: Exercise[];
	subcategories?: {
		id: string;
		name: string;
		exercises: Exercise[];
	}[];
}

export interface ConditionBundle {
	id: string;
	name: string;
	description: string;
	phases: {
		phase: string;
		goals: string[];
		exercises: Exercise[];
		progressCriteria?: string;
	}[];
}

// Master Exercise Library by Joint
export const JOINT_WISE_EXERCISES: ExerciseCategory[] = [
	{
		id: 'cervical',
		name: 'Cervical Spine (Neck)',
		exercises: [
			{ id: 'cerv-flex-ext-arom', name: 'Cervical flexion / extension AROM', category: 'Mobility / ROM' },
			{ id: 'cerv-rotation-arom', name: 'Cervical rotation AROM', category: 'Mobility / ROM' },
			{ id: 'cerv-side-flex-arom', name: 'Cervical side flexion AROM', category: 'Mobility / ROM' },
			{ id: 'cerv-retraction', name: 'Cervical retraction (chin tuck)', category: 'Mobility / ROM' },
			{ id: 'upper-cerv-nods', name: 'Upper cervical nods', category: 'Mobility / ROM' },
			{ id: 'snags', name: 'Sustained natural apophyseal glides (SNAGs – assisted)', category: 'Mobility / ROM' },
			{ id: 'cerv-flex-iso', name: 'Cervical flexion isometric', category: 'Isometrics' },
			{ id: 'cerv-ext-iso', name: 'Cervical extension isometric', category: 'Isometrics' },
			{ id: 'cerv-rot-iso', name: 'Cervical rotation isometric', category: 'Isometrics' },
			{ id: 'cerv-side-iso', name: 'Cervical side-flexion isometric', category: 'Isometrics' },
			{ id: 'deep-neck-flexor', name: 'Deep neck flexor activation (supine chin tuck)', category: 'Strengthening' },
			{ id: 'prone-cerv-ext', name: 'Prone cervical extension', category: 'Strengthening' },
			{ id: 'band-cervical', name: 'Resistance band cervical movements', category: 'Strengthening' },
			{ id: 'quad-cerv-control', name: 'Quadruped cervical control drills', category: 'Strengthening' },
			{ id: 'scap-setting', name: 'Scapular setting', category: 'Scapulo-cervical Control' },
			{ id: 'shoulder-shrugs', name: 'Shoulder shrugs (controlled)', category: 'Scapulo-cervical Control' },
			{ id: 'lower-trap', name: 'Lower trapezius activation', category: 'Scapulo-cervical Control' },
			{ id: 'serratus-punches', name: 'Serratus anterior punches', category: 'Scapulo-cervical Control' },
			{ id: 'postural-endurance', name: 'Postural endurance holds', category: 'Functional / Endurance' },
			{ id: 'workstation-posture', name: 'Work-station posture drills', category: 'Functional / Endurance' },
			{ id: 'sport-neck-loading', name: 'Sport-specific neck loading (later phase)', category: 'Functional / Endurance' },
		],
	},
	{
		id: 'thoracic',
		name: 'Thoracic Spine',
		exercises: [
			{ id: 'thor-flex-ext-arom', name: 'Thoracic flexion/extension AROM', category: 'Mobility' },
			{ id: 'thor-rotation-sit', name: 'Thoracic rotation (sitting / quadruped)', category: 'Mobility' },
			{ id: 'cat-camel', name: 'Cat-camel', category: 'Mobility' },
			{ id: 'foam-roller-ext', name: 'Foam roller thoracic extension', category: 'Mobility' },
			{ id: 'open-book', name: 'Open book stretch', category: 'Mobility' },
			{ id: 'prone-y-t-w', name: 'Prone Y / T / W', category: 'Strength & Control' },
			{ id: 'thor-ext-holds', name: 'Thoracic extension holds', category: 'Strength & Control' },
			{ id: 'quad-thor-control', name: 'Quadruped thoracic control', category: 'Strength & Control' },
			{ id: 'seated-resisted-rot', name: 'Seated resisted rotations', category: 'Strength & Control' },
		],
	},
	{
		id: 'lumbar',
		name: 'Lumbar Spine',
		exercises: [
			{ id: 'pelvic-tilts', name: 'Pelvic tilts', category: 'Mobility' },
			{ id: 'knee-to-chest', name: 'Knee-to-chest', category: 'Mobility' },
			{ id: 'lumbar-rotations', name: 'Lumbar rotations (hooklying)', category: 'Mobility' },
			{ id: 'cat-camel-lumbar', name: 'Cat-camel', category: 'Mobility' },
			{ id: 'abdominal-bracing', name: 'Abdominal bracing', category: 'Core Activation' },
			{ id: 'drawing-in', name: 'Drawing-in maneuver', category: 'Core Activation' },
			{ id: 'pelvic-floor', name: 'Pelvic floor activation', category: 'Core Activation' },
			{ id: 'bridging', name: 'Bridging', category: 'Strength & Stability' },
			{ id: 'dead-bug', name: 'Dead bug', category: 'Strength & Stability' },
			{ id: 'bird-dog', name: 'Bird dog', category: 'Strength & Stability' },
			{ id: 'planks', name: 'Planks (front / side)', category: 'Strength & Stability' },
			{ id: 'pallof-press', name: 'Pallof press', category: 'Strength & Stability' },
			{ id: 'sit-to-stand', name: 'Sit-to-stand mechanics', category: 'Functional' },
			{ id: 'hip-hinge', name: 'Hip hinge drills', category: 'Functional' },
			{ id: 'lifting-pattern', name: 'Lifting pattern retraining', category: 'Functional' },
		],
	},
	{
		id: 'shoulder',
		name: 'Shoulder Complex',
		exercises: [
			{ id: 'pendulum', name: 'Pendulum exercises', category: 'Mobility / ROM' },
			{ id: 'shoulder-flex-arom', name: 'Shoulder flexion AROM', category: 'Mobility / ROM' },
			{ id: 'shoulder-abd-arom', name: 'Shoulder abduction AROM', category: 'Mobility / ROM' },
			{ id: 'er-ir-arom', name: 'External / internal rotation AROM', category: 'Mobility / ROM' },
			{ id: 'wand-exercises', name: 'Wand exercises', category: 'Mobility / ROM' },
			{ id: 'pulley-exercises', name: 'Pulley exercises', category: 'Mobility / ROM' },
			{ id: 'shoulder-flex-iso', name: 'Shoulder flexion isometric', category: 'Isometrics' },
			{ id: 'shoulder-ext-iso', name: 'Shoulder extension isometric', category: 'Isometrics' },
			{ id: 'er-ir-iso', name: 'ER / IR isometric', category: 'Isometrics' },
			{ id: 'scap-iso', name: 'Scapular isometrics', category: 'Isometrics' },
			{ id: 'theraband-er-ir', name: 'Theraband ER/IR (neutral & 90°)', category: 'Rotator Cuff Strength' },
			{ id: 'side-lying-er', name: 'Side-lying ER', category: 'Rotator Cuff Strength' },
			{ id: 'prone-er', name: 'Prone ER', category: 'Rotator Cuff Strength' },
			{ id: 'cable-er-ir', name: 'Cable ER/IR', category: 'Rotator Cuff Strength' },
			{ id: 'serratus-punches-sh', name: 'Serratus punches', category: 'Scapular Strength' },
			{ id: 'scap-retraction', name: 'Scapular retraction', category: 'Scapular Strength' },
			{ id: 'rows', name: 'Rows', category: 'Scapular Strength' },
			{ id: 'push-up-plus', name: 'Push-up plus', category: 'Scapular Strength' },
			{ id: 'wall-slides', name: 'Wall slides', category: 'Scapular Strength' },
			{ id: 'overhead-carries', name: 'Overhead carries', category: 'Functional / Advanced' },
			{ id: 'plyometric-throws', name: 'Plyometric throws', category: 'Functional / Advanced' },
			{ id: 'closed-chain-stability', name: 'Closed-chain stability drills', category: 'Functional / Advanced' },
		],
	},
	{
		id: 'elbow',
		name: 'Elbow',
		exercises: [
			{ id: 'elbow-flex-ext-arom', name: 'Elbow flexion / extension AROM', category: 'ROM' },
			{ id: 'forearm-pro-sup', name: 'Forearm pronation / supination', category: 'ROM' },
			{ id: 'biceps-curls', name: 'Biceps curls', category: 'Strengthening' },
			{ id: 'triceps-ext', name: 'Triceps extensions', category: 'Strengthening' },
			{ id: 'elbow-iso', name: 'Isometric elbow flex/ext', category: 'Strengthening' },
			{ id: 'eccentric-loading', name: 'Eccentric loading (tennis / golfer\'s elbow)', category: 'Strengthening' },
			{ id: 'weight-bearing', name: 'Weight-bearing drills', category: 'Functional' },
			{ id: 'grip-integration', name: 'Grip integration', category: 'Functional' },
		],
	},
	{
		id: 'wrist-hand',
		name: 'Wrist & Hand',
		exercises: [
			{ id: 'wrist-flex-ext', name: 'Wrist flexion / extension', category: 'ROM' },
			{ id: 'radial-ulnar-dev', name: 'Radial / ulnar deviation', category: 'ROM' },
			{ id: 'finger-flex-ext', name: 'Finger flexion / extension', category: 'ROM' },
			{ id: 'thumb-opposition', name: 'Thumb opposition', category: 'ROM' },
			{ id: 'wrist-curls', name: 'Wrist curls (flex/ext)', category: 'Strength' },
			{ id: 'putty-exercises', name: 'Putty exercises', category: 'Strength' },
			{ id: 'grip-strength', name: 'Grip strengthening', category: 'Strength' },
			{ id: 'pinch-strength', name: 'Pinch strengthening', category: 'Strength' },
			{ id: 'rubber-band-fingers', name: 'Rubber band finger extension', category: 'Strength' },
			{ id: 'fine-motor', name: 'Fine motor tasks', category: 'Functional' },
			{ id: 'weight-bearing-wrist', name: 'Weight-bearing tolerance drills', category: 'Functional' },
		],
	},
	{
		id: 'hip',
		name: 'Hip',
		exercises: [
			{ id: 'hip-flex-ext-arom', name: 'Hip flexion / extension AROM', category: 'Mobility' },
			{ id: 'hip-abd-add-arom', name: 'Hip abduction / adduction AROM', category: 'Mobility' },
			{ id: 'hip-ir-er-arom', name: 'Hip internal / external rotation', category: 'Mobility' },
			{ id: 'thomas-stretch', name: 'Thomas stretch', category: 'Mobility' },
			{ id: 'piriformis-stretch', name: 'Piriformis stretch', category: 'Mobility' },
			{ id: 'glute-bridges', name: 'Glute bridges', category: 'Strength' },
			{ id: 'clamshells', name: 'Clamshells', category: 'Strength' },
			{ id: 'hip-abd-band', name: 'Hip abduction (band)', category: 'Strength' },
			{ id: 'hip-ext-band', name: 'Hip extension (band / cable)', category: 'Strength' },
			{ id: 'adductor-strength', name: 'Adductor strengthening', category: 'Strength' },
			{ id: 'squats', name: 'Squats', category: 'Functional' },
			{ id: 'lunges', name: 'Lunges', category: 'Functional' },
			{ id: 'step-ups', name: 'Step-ups', category: 'Functional' },
			{ id: 'hip-hinge-hip', name: 'Hip hinge', category: 'Functional' },
			{ id: 'single-leg-stance', name: 'Single-leg stance drills', category: 'Functional' },
		],
	},
	{
		id: 'knee',
		name: 'Knee',
		exercises: [
			{ id: 'heel-slides', name: 'Heel slides', category: 'ROM' },
			{ id: 'passive-knee-ext', name: 'Passive knee extension', category: 'ROM' },
			{ id: 'active-knee-flex', name: 'Active knee flexion', category: 'ROM' },
			{ id: 'wall-slides-knee', name: 'Wall slides', category: 'ROM' },
			{ id: 'quad-sets', name: 'Quadriceps sets', category: 'Strength' },
			{ id: 'slr', name: 'Straight leg raises', category: 'Strength' },
			{ id: 'short-arc-quads', name: 'Short arc quads', category: 'Strength' },
			{ id: 'hamstring-curls', name: 'Hamstring curls', category: 'Strength' },
			{ id: 'tke', name: 'Terminal knee extension (TKE)', category: 'Strength' },
			{ id: 'weight-shifts', name: 'Weight shifts', category: 'Neuromuscular Control' },
			{ id: 'mini-squats', name: 'Mini squats', category: 'Neuromuscular Control' },
			{ id: 'step-downs', name: 'Step-downs', category: 'Neuromuscular Control' },
			{ id: 'balance-board', name: 'Balance board drills', category: 'Neuromuscular Control' },
			{ id: 'jump-landing', name: 'Jump-landing drills', category: 'Advanced' },
			{ id: 'change-direction', name: 'Change of direction drills', category: 'Advanced' },
			{ id: 'sport-specific-knee', name: 'Sport-specific loading', category: 'Advanced' },
		],
	},
	{
		id: 'ankle-foot',
		name: 'Ankle & Foot',
		exercises: [
			{ id: 'ankle-dorsi-plantar', name: 'Ankle dorsiflexion / plantarflexion', category: 'ROM' },
			{ id: 'inversion-eversion', name: 'Inversion / eversion', category: 'ROM' },
			{ id: 'toe-flex-ext', name: 'Toe flexion / extension', category: 'ROM' },
			{ id: 'theraband-ankle', name: 'Theraband ankle exercises', category: 'Strength' },
			{ id: 'heel-raises', name: 'Heel raises (double → single leg)', category: 'Strength' },
			{ id: 'toe-raises', name: 'Toe raises', category: 'Strength' },
			{ id: 'intrinsic-foot', name: 'Intrinsic foot strengthening (short foot)', category: 'Strength' },
			{ id: 'single-leg-stance-ankle', name: 'Single-leg stance', category: 'Balance / Proprioception' },
			{ id: 'balance-board-ankle', name: 'Balance board', category: 'Balance / Proprioception' },
			{ id: 'star-excursion', name: 'Star excursion', category: 'Balance / Proprioception' },
			{ id: 'hopping-drills', name: 'Hopping drills', category: 'Balance / Proprioception' },
		],
	},
	{
		id: 'tmj',
		name: 'Temporomandibular Joint (TMJ)',
		exercises: [
			{ id: 'mouth-opening', name: 'Controlled mouth opening', category: 'Mobility' },
			{ id: 'lateral-deviation', name: 'Lateral deviation AROM', category: 'Mobility' },
			{ id: 'protrusion-retraction', name: 'Protrusion / retraction', category: 'Mobility' },
			{ id: 'tongue-palate', name: 'Tongue-to-palate exercises', category: 'Control' },
			{ id: 'jaw-isometric', name: 'Isometric jaw resistance', category: 'Control' },
			{ id: 'tmj-postural', name: 'Postural correction drills', category: 'Control' },
		],
	},
	{
		id: 'general',
		name: 'General / Whole-Body',
		exercises: [
			{ id: 'diaphragmatic-breathing', name: 'Diaphragmatic breathing', category: 'Cardiopulmonary' },
			{ id: 'breathing-exercises', name: 'Breathing exercises', category: 'Cardiopulmonary' },
			{ id: 'aerobic-conditioning', name: 'Aerobic conditioning', category: 'Cardiopulmonary' },
			{ id: 'sciatic-nerve-glides', name: 'Sciatic nerve glides', category: 'Neural Mobility' },
			{ id: 'median-nerve-glides', name: 'Median / ulnar / radial nerve glides', category: 'Neural Mobility' },
			{ id: 'gait-training', name: 'Gait training', category: 'Functional Rehab' },
			{ id: 'running-mechanics', name: 'Running mechanics', category: 'Functional Rehab' },
			{ id: 'agility-ladder', name: 'Agility ladder drills', category: 'Functional Rehab' },
		],
	},
];

// Condition-Specific Exercise Bundles
export const CONDITION_BUNDLES: ConditionBundle[] = [
	{
		id: 'rotator-cuff-tendinopathy',
		name: 'Rotator Cuff Tendinopathy / Partial Tear',
		description: 'Pain reduction, restore ROM, improve RC + scapular control, return to overhead function',
		phases: [
			{
				phase: 'Phase 1 – Pain & Activation',
				goals: ['Pain reduction', 'Restore ROM', 'Activation'],
				exercises: [
					{ id: 'pendulum', name: 'Pendulum exercises', category: 'Mobility' },
					{ id: 'shoulder-flex-arom', name: 'Shoulder flexion/abduction AROM (pain-free)', category: 'Mobility' },
					{ id: 'er-ir-iso', name: 'Isometric ER / IR', category: 'Isometrics' },
					{ id: 'scap-setting', name: 'Scapular setting', category: 'Control' },
				],
				progressCriteria: 'Pain <3/10, full AROM, good scapular control',
			},
			{
				phase: 'Phase 2 – Strength',
				goals: ['Strengthen RC', 'Scapular control'],
				exercises: [
					{ id: 'theraband-er-ir', name: 'Theraband ER / IR (neutral)', category: 'Strength' },
					{ id: 'side-lying-er', name: 'Side-lying ER', category: 'Strength' },
					{ id: 'serratus-punches-sh', name: 'Serratus punches', category: 'Strength' },
					{ id: 'prone-y-t-w', name: 'Prone Y / T', category: 'Strength' },
					{ id: 'wall-push-ups', name: 'Closed-chain wall push-ups', category: 'Strength' },
				],
			},
			{
				phase: 'Phase 3 – Functional',
				goals: ['Return to function', 'Sport-specific'],
				exercises: [
					{ id: 'er-ir-90', name: 'ER/IR at 90°', category: 'Advanced' },
					{ id: 'overhead-carries', name: 'Overhead carries', category: 'Functional' },
					{ id: 'plyometric-throws', name: 'Plyometric wall throws', category: 'Functional' },
				],
			},
		],
	},
	{
		id: 'frozen-shoulder',
		name: 'Frozen Shoulder (Adhesive Capsulitis)',
		description: 'Restore capsular mobility, gradual strengthening',
		phases: [
			{
				phase: 'Phase 1 – Pain Relief',
				goals: ['Pain relief', 'Gentle mobility'],
				exercises: [
					{ id: 'pendulum', name: 'Pendulum', category: 'Mobility' },
					{ id: 'gentle-passive-rom', name: 'Gentle passive ROM', category: 'Mobility' },
					{ id: 'scap-mobility', name: 'Scapular mobility', category: 'Mobility' },
				],
			},
			{
				phase: 'Phase 2 – Mobility',
				goals: ['Restore ROM', 'Capsular stretching'],
				exercises: [
					{ id: 'wand-exercises', name: 'Wand exercises', category: 'Mobility' },
					{ id: 'pulley-exercises', name: 'Pulley exercises', category: 'Mobility' },
					{ id: 'posterior-capsule', name: 'Posterior capsule stretch', category: 'Mobility' },
					{ id: 'inferior-capsule', name: 'Inferior capsule stretch', category: 'Mobility' },
				],
			},
			{
				phase: 'Phase 3 – Strength',
				goals: ['Gradual strengthening'],
				exercises: [
					{ id: 'rc-strengthening', name: 'Isometric → isotonic RC strengthening', category: 'Strength' },
					{ id: 'scap-strengthening', name: 'Scapular strengthening', category: 'Strength' },
				],
				progressCriteria: 'Progress slowly – pain-guided',
			},
		],
	},
	{
		id: 'acl-reconstruction',
		name: 'ACL Reconstruction (Post-Op)',
		description: 'Criteria-based progression mandatory',
		phases: [
			{
				phase: 'Phase 1 (0–2 weeks)',
				goals: ['ROM', 'Quad activation', 'Swelling control'],
				exercises: [
					{ id: 'quad-sets', name: 'Quad sets', category: 'Activation' },
					{ id: 'heel-slides', name: 'Heel slides', category: 'ROM' },
					{ id: 'slr', name: 'SLR', category: 'Strength' },
					{ id: 'ankle-pumps', name: 'Ankle pumps', category: 'Circulation' },
					{ id: 'weight-shifts', name: 'Weight shift drills', category: 'Control' },
				],
			},
			{
				phase: 'Phase 2 (2–6 weeks)',
				goals: ['Progressive strengthening', 'Balance'],
				exercises: [
					{ id: 'mini-squats', name: 'Mini squats', category: 'Strength' },
					{ id: 'tke', name: 'TKE', category: 'Strength' },
					{ id: 'step-ups', name: 'Step-ups', category: 'Functional' },
					{ id: 'hamstring-curls', name: 'Hamstring curls', category: 'Strength' },
					{ id: 'balance-board', name: 'Balance drills', category: 'Control' },
				],
			},
			{
				phase: 'Phase 3 (6–12 weeks)',
				goals: ['Advanced strengthening', 'Perturbation'],
				exercises: [
					{ id: 'lunges', name: 'Lunges', category: 'Strength' },
					{ id: 'rdl', name: 'RDLs', category: 'Strength' },
					{ id: 'single-leg-squats', name: 'Single-leg squats', category: 'Strength' },
					{ id: 'perturbation', name: 'Perturbation training', category: 'Control' },
				],
			},
			{
				phase: 'Phase 4 (3–6 months)',
				goals: ['Return to sport', 'Plyometrics'],
				exercises: [
					{ id: 'plyometrics', name: 'Plyometrics', category: 'Advanced' },
					{ id: 'cutting-drills', name: 'Cutting drills', category: 'Advanced' },
					{ id: 'sprint-mechanics', name: 'Sprint mechanics', category: 'Advanced' },
					{ id: 'sport-simulation', name: 'Sport simulation', category: 'Advanced' },
				],
			},
		],
	},
	{
		id: 'meniscal-injury',
		name: 'Meniscal Injury (Conservative / Post-Op)',
		description: 'Avoid deep squats early',
		phases: [
			{
				phase: 'Phase 1',
				goals: ['ROM (0–90°)', 'Quad activation'],
				exercises: [
					{ id: 'heel-slides', name: 'ROM (0–90°)', category: 'ROM' },
					{ id: 'quad-sets', name: 'Quad activation', category: 'Activation' },
					{ id: 'heel-raises', name: 'Heel raises', category: 'Strength' },
				],
			},
			{
				phase: 'Phase 2',
				goals: ['Closed-chain strengthening', 'Balance'],
				exercises: [
					{ id: 'mini-squats', name: 'Closed-chain strengthening', category: 'Strength' },
					{ id: 'step-downs', name: 'Step-downs', category: 'Functional' },
					{ id: 'balance-board', name: 'Balance drills', category: 'Control' },
				],
			},
			{
				phase: 'Phase 3',
				goals: ['Agility', 'Sport-specific'],
				exercises: [
					{ id: 'agility-ladder', name: 'Agility drills', category: 'Functional' },
					{ id: 'change-direction', name: 'Deceleration training', category: 'Advanced' },
					{ id: 'sport-specific-knee', name: 'Sport-specific drills', category: 'Advanced' },
				],
				progressCriteria: 'Avoid deep squats early',
			},
		],
	},
	{
		id: 'pfps',
		name: 'Patellofemoral Pain Syndrome (PFPS)',
		description: 'Focus on quad + hip control, patellar tracking',
		phases: [
			{
				phase: 'Rehabilitation',
				goals: ['Quad + hip control', 'Patellar tracking'],
				exercises: [
					{ id: 'quad-sets', name: 'Quad sets', category: 'Activation' },
					{ id: 'slr', name: 'SLR', category: 'Strength' },
					{ id: 'hip-abd-band', name: 'Hip abduction', category: 'Strength' },
					{ id: 'glute-bridges', name: 'Glute bridges', category: 'Strength' },
					{ id: 'step-downs', name: 'Step-downs', category: 'Functional' },
					{ id: 'squats', name: 'Squat re-education', category: 'Functional' },
				],
				progressCriteria: 'Progress load before depth',
			},
		],
	},
	{
		id: 'lumbar-disc',
		name: 'Lumbar Disc Bulge / Prolapse',
		description: 'McKenzie extension if indicated',
		phases: [
			{
				phase: 'Phase 1 – Pain Control',
				goals: ['Pain control', 'Centralization'],
				exercises: [
					{ id: 'prone-lying', name: 'Prone lying', category: 'Pain Control' },
					{ id: 'mckenzie-ext', name: 'McKenzie extension (if indicated)', category: 'Pain Control' },
					{ id: 'pelvic-tilts', name: 'Pelvic tilts', category: 'Mobility' },
					{ id: 'diaphragmatic-breathing', name: 'Diaphragmatic breathing', category: 'Pain Control' },
				],
			},
			{
				phase: 'Phase 2 – Core Stability',
				goals: ['Core stability', 'Control'],
				exercises: [
					{ id: 'dead-bug', name: 'Dead bug', category: 'Core' },
					{ id: 'bird-dog', name: 'Bird dog', category: 'Core' },
					{ id: 'planks', name: 'Side planks', category: 'Core' },
					{ id: 'pallof-press', name: 'Pallof press', category: 'Core' },
				],
			},
			{
				phase: 'Phase 3 – Functional',
				goals: ['Functional retraining', 'Return to work'],
				exercises: [
					{ id: 'hip-hinge', name: 'Hip hinge', category: 'Functional' },
					{ id: 'lifting-pattern', name: 'Lifting drills', category: 'Functional' },
					{ id: 'return-to-work', name: 'Return-to-work conditioning', category: 'Functional' },
				],
			},
		],
	},
	{
		id: 'mechanical-lbp',
		name: 'Mechanical Low Back Pain',
		description: 'Core bracing, glute strengthening, thoracic mobility',
		phases: [
			{
				phase: 'Rehabilitation',
				goals: ['Core stability', 'Glute strength', 'Thoracic mobility'],
				exercises: [
					{ id: 'abdominal-bracing', name: 'Core bracing', category: 'Core' },
					{ id: 'glute-bridges', name: 'Glute strengthening', category: 'Strength' },
					{ id: 'thor-flex-ext-arom', name: 'Thoracic mobility', category: 'Mobility' },
					{ id: 'planks', name: 'Endurance planks', category: 'Core' },
					{ id: 'lifting-pattern', name: 'Functional retraining', category: 'Functional' },
				],
			},
		],
	},
	{
		id: 'scoliosis',
		name: 'Scoliosis (Adolescent / Adult)',
		description: 'Curve-specific control, postural endurance, pain reduction',
		phases: [
			{
				phase: 'Rehabilitation',
				goals: ['Curve-specific control', 'Postural endurance', 'Pain reduction'],
				exercises: [
					{ id: 'diaphragmatic-breathing', name: 'Breathing correction', category: 'Control' },
					{ id: 'side-shift', name: 'Side-shift exercises', category: 'Control' },
					{ id: 'curve-elongation', name: 'Curve-specific elongation', category: 'Mobility' },
					{ id: 'asymmetrical-core', name: 'Core asymmetrical strengthening', category: 'Strength' },
					{ id: 'scap-setting', name: 'Scapular stabilization', category: 'Strength' },
				],
				progressCriteria: 'Avoid generic symmetrical loading only',
			},
		],
	},
	{
		id: 'ankle-sprain',
		name: 'Ankle Sprain (Grade I–III)',
		description: 'Progressive loading and balance training',
		phases: [
			{
				phase: 'Phase 1',
				goals: ['ROM', 'Isometrics', 'Swelling control'],
				exercises: [
					{ id: 'ankle-dorsi-plantar', name: 'ROM', category: 'ROM' },
					{ id: 'ankle-isometrics', name: 'Isometrics', category: 'Isometrics' },
					{ id: 'swelling-control', name: 'Swelling control', category: 'Management' },
				],
			},
			{
				phase: 'Phase 2',
				goals: ['Strengthening', 'Balance'],
				exercises: [
					{ id: 'theraband-ankle', name: 'Theraband strengthening', category: 'Strength' },
					{ id: 'heel-raises', name: 'Heel raises', category: 'Strength' },
					{ id: 'single-leg-stance-ankle', name: 'Balance drills', category: 'Balance' },
				],
			},
			{
				phase: 'Phase 3',
				goals: ['Hopping', 'Change of direction', 'Sport-specific'],
				exercises: [
					{ id: 'hopping-drills', name: 'Hopping', category: 'Advanced' },
					{ id: 'change-direction', name: 'Change of direction', category: 'Advanced' },
					{ id: 'sport-specific-ankle', name: 'Sport-specific drills', category: 'Advanced' },
				],
			},
		],
	},
	{
		id: 'plantar-fasciitis',
		name: 'Plantar Fasciitis',
		description: 'Plantar fascia stretch, calf stretching, intrinsic foot strengthening',
		phases: [
			{
				phase: 'Rehabilitation',
				goals: ['Stretching', 'Strengthening', 'Load management'],
				exercises: [
					{ id: 'plantar-fascia-stretch', name: 'Plantar fascia stretch', category: 'Mobility' },
					{ id: 'calf-stretching', name: 'Calf stretching', category: 'Mobility' },
					{ id: 'intrinsic-foot', name: 'Intrinsic foot strengthening', category: 'Strength' },
					{ id: 'heel-raises-eccentric', name: 'Heel raises (slow eccentrics)', category: 'Strength' },
					{ id: 'load-management', name: 'Load management drills', category: 'Functional' },
				],
			},
		],
	},
	{
		id: 'tennis-golfers-elbow',
		name: 'Tennis / Golfer\'s Elbow',
		description: 'Eccentric wrist loading, grip strengthening',
		phases: [
			{
				phase: 'Phase 1',
				goals: ['Pain control', 'Isometrics'],
				exercises: [
					{ id: 'elbow-iso', name: 'Isometrics', category: 'Isometrics' },
					{ id: 'elbow-flex-ext-arom', name: 'Pain-free ROM', category: 'ROM' },
				],
			},
			{
				phase: 'Phase 2',
				goals: ['Eccentric loading', 'Grip strength'],
				exercises: [
					{ id: 'eccentric-loading', name: 'Eccentric wrist loading', category: 'Strength' },
					{ id: 'grip-strength', name: 'Grip strengthening', category: 'Strength' },
				],
			},
			{
				phase: 'Phase 3',
				goals: ['Functional gripping', 'Sport-specific'],
				exercises: [
					{ id: 'grip-integration', name: 'Functional gripping', category: 'Functional' },
					{ id: 'sport-specific-elbow', name: 'Sport-specific loading', category: 'Functional' },
				],
			},
		],
	},
	{
		id: 'hip-oa',
		name: 'Hip OA / Hip Pain',
		description: 'Hip mobility, glute strengthening, gait retraining',
		phases: [
			{
				phase: 'Rehabilitation',
				goals: ['Mobility', 'Strength', 'Gait', 'Endurance'],
				exercises: [
					{ id: 'hip-flex-ext-arom', name: 'Hip mobility drills', category: 'Mobility' },
					{ id: 'glute-bridges', name: 'Glute strengthening', category: 'Strength' },
					{ id: 'sit-to-stand', name: 'Sit-to-stand', category: 'Functional' },
					{ id: 'gait-training', name: 'Gait retraining', category: 'Functional' },
					{ id: 'endurance-conditioning', name: 'Endurance conditioning', category: 'Endurance' },
				],
			},
		],
	},
];

// Helper function to get exercises by joint
export function getExercisesByJoint(jointId: string): Exercise[] {
	const category = JOINT_WISE_EXERCISES.find(cat => cat.id === jointId);
	return category?.exercises || [];
}

// Helper function to get exercises by condition
export function getExercisesByCondition(conditionId: string): ConditionBundle | undefined {
	return CONDITION_BUNDLES.find(bundle => bundle.id === conditionId);
}

// Helper function to search exercises
export function searchExercises(query: string): Exercise[] {
	const queryLower = query.toLowerCase();
	const allExercises: Exercise[] = [];
	
	JOINT_WISE_EXERCISES.forEach(category => {
		allExercises.push(...category.exercises);
	});
	
	return allExercises.filter(ex => 
		ex.name.toLowerCase().includes(queryLower) ||
		ex.category.toLowerCase().includes(queryLower)
	);
}

