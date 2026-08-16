/**
 * User Reset Script
 * Usage: node scripts/reset-users.cjs
 *
 * This script will:
 * 1. Reset all existing users to 4 free reviews
 * 2. Set their subscription type to 'free'
 * 3. Clear any existing subscription expiry
 * 4. Reset monthly review counters
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { getFirestore } = require('firebase-admin/firestore');

// Try to find the service account key file
const possiblePaths = [
	path.resolve(__dirname, '../ats-system-729c8-firebase-adminsdk-fbsvc-845fc8685a.json'),
	path.resolve(__dirname, '../firebase-adminsdk.json'),
	path.resolve(__dirname, '../service-account.json'),
	path.resolve(process.cwd(), 'ats-system-729c8-firebase-adminsdk-fbsvc-845fc8685a.json'),
	path.resolve(process.cwd(), 'firebase-adminsdk.json'),
	path.resolve(process.cwd(), 'service-account.json'),
	process.env.GOOGLE_APPLICATION_CREDENTIALS
];

let serviceAccount = null;
let foundPath = null;

for (const possiblePath of possiblePaths) {
	if (!possiblePath) continue;
	if (fs.existsSync(possiblePath)) {
		try {
			serviceAccount = JSON.parse(fs.readFileSync(possiblePath, 'utf8'));
			foundPath = possiblePath;
			console.log(`✅ Found service account at: ${possiblePath}`);
			break;
		} catch (parseError) {
			console.log(`❌ Found file but couldn't parse JSON: ${possiblePath}`);
		}
	}
}

if (!serviceAccount) {
	console.error('❌ Firebase service account key not found.');
	console.log('💡 Please place your Firebase service account JSON file in the project root.');
	process.exit(1);
}

// Initialize Firebase Admin
let db;
try {
	const app = admin.initializeApp({
		credential: admin.cert(serviceAccount)
	});
	console.log('✅ Initialized Firebase Admin');
	db = getFirestore(app);
	console.log('✅ Got Firestore instance');
} catch (error) {
	console.error('❌ Failed to initialize Firebase Admin:', error.message);
	process.exit(1);
}

async function resetAllUsers() {
	console.log('🔄 Resetting all users to 4 free reviews...\n');

	try {
		// Get all users
		const usersSnap = await db.collection('users').get();

		if (usersSnap.empty) {
			console.log('❌ No users found. Nothing to reset.');
			return { updated: 0, total: 0 };
		}

		console.log(`📊 Found ${usersSnap.size} user(s)\n`);

		let updated = 0;

		for (const userDoc of usersSnap.docs) {
			const userId = userDoc.id;
			console.log(`📄 Resetting user: ${userId}`);

			try {
				// Reset billing state
				const billingRef = db.doc(`users/${userId}/billing/state`);
				await billingRef.set({
					freeUsed: false,
					credits: 4,
					subscriptionType: 'free',
					subscriptionExpiresAt: null,
					reviewsThisMonth: 0,
					updatedAt: new Date()
				});
				console.log(`   ✅ Reset user ${userId} to 4 free reviews`);
				updated++;
			} catch (error) {
				console.log(`   ❌ Failed to reset user ${userId}:`, error.message);
			}
		}

		return { updated, total: usersSnap.size };
	} catch (error) {
		console.error('❌ Error resetting users:', error.message);
		throw error;
	}
}

async function runReset() {
	console.log('🚀 Starting User Reset...\n');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	try {
		const results = await resetAllUsers();
		console.log(`\n📊 Summary: ${results.updated}/${results.total} users reset\n`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('✨ Reset completed successfully!');
		console.log('\n💡 All users now have 4 free reviews available.');
		console.log('💡 They will need to pay after using their 4 free reviews.');
	} catch (error) {
		console.error('❌ Reset failed:', error.message);
		console.error(error.stack);
		process.exit(1);
	}
}

runReset()
	.then(() => {
		console.log('\n✨ Script completed!');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
