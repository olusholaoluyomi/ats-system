/**
 * Firestore Migration Script
 * Usage: node scripts/migrate-firestore.cjs
 * 
 * This script will:
 * 1. Check all payment documents and ensure they have required fields
 * 2. Check all billing documents and ensure they have required fields
 * 3. Add missing fields with appropriate default values
 * 4. Ensure data consistency across the database
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
	db = getFirestore(app, 'ats-system-729c8-firebase-adminsdk-fbsvc-845fc8685a');
	console.log('✅ Got Firestore instance with database ID');
} catch (error) {
	console.error('❌ Failed to initialize Firebase Admin:', error.message);
	process.exit(1);
}

const SCANS_PER_PAYMENT = 4;

async function migratePayments() {
	console.log('🔍 Migrating payments collection...\n');

	try {
		const paymentsSnap = await db.collection('payments').get();
		
		if (paymentsSnap.empty) {
			console.log('❌ No payments found. Nothing to migrate.');
			return { updated: 0, total: 0 };
		}

		console.log(`📊 Found ${paymentsSnap.size} payment(s)\n`);

		let updated = 0;

		for (const doc of paymentsSnap.docs) {
			const data = doc.data();
			const updates = [];
			const docId = doc.id;

			console.log(`📄 Checking payment: ${docId}`);

			// Check required fields
			if (!data.scansAllowed && data.status === 'success') {
				updates.push({ field: 'scansAllowed', value: SCANS_PER_PAYMENT });
				console.log(`   ➕ Adding scansAllowed: ${SCANS_PER_PAYMENT}`);
			}

			if (!data.updatedAt && data.createdAt) {
				updates.push({ field: 'updatedAt', value: data.createdAt });
				console.log(`   ➕ Adding updatedAt: ${data.createdAt.toDate?.toISOString() || data.createdAt}`);
			}

			if (data.status === 'success' && typeof data.amountMinor !== 'number') {
				// Try to infer amountMinor from existing fields
				if (typeof data.amountKobo === 'number') {
					updates.push({ field: 'amountMinor', value: data.amountKobo });
					console.log(`   ➕ Migrating amountKobo to amountMinor: ${data.amountKobo}`);
				}
			}

			if (updates.length > 0) {
				try {
					const updateData = {};
					updates.forEach(u => {
						updateData[u.field] = u.value;
					});

					await db.collection('payments').doc(docId).update(updateData);
					console.log(`   ✅ Updated payment ${docId}`);
					updated++;
				} catch (error) {
					console.log(`   ❌ Failed to update payment ${docId}:`, error.message);
				}
			} else {
				console.log(`   ✅ Payment ${docId} is up to date`);
			}
			console.log('');
		}

		return { updated, total: paymentsSnap.size };
	} catch (error) {
		console.error('❌ Error migrating payments:', error.message);
		throw error;
	}
}

async function migrateBilling() {
	console.log('🔍 Migrating billing documents...\n');

	try {
		const billingSnap = await db.collectionGroup('billing').get();
		
		if (billingSnap.empty) {
			console.log('❌ No billing documents found. Nothing to migrate.');
			return { updated: 0, total: 0 };
		}

		console.log(`📊 Found ${billingSnap.size} billing document(s)\n`);

		let updated = 0;

		for (const doc of billingSnap.docs) {
			const data = doc.data();
			const updates = [];
			const path = doc.ref.path;

			console.log(`📁 Checking billing: ${path}`);

			// Ensure required fields exist
			if (typeof data.freeUsed !== 'boolean') {
				updates.push({ field: 'freeUsed', value: false });
				console.log(`   ➕ Adding freeUsed: false`);
			}

			if (typeof data.credits !== 'number') {
				updates.push({ field: 'credits', value: 0 });
				console.log(`   ➕ Adding credits: 0`);
			}

			if (!data.updatedAt) {
				updates.push({ field: 'updatedAt', value: new Date() });
				console.log(`   ➕ Adding updatedAt: ${new Date().toISOString()}`);
			}

			if (updates.length > 0) {
				try {
					const updateData = {};
					updates.forEach(u => {
						updateData[u.field] = u.value;
					});

					await doc.ref.update(updateData);
					console.log(`   ✅ Updated billing document`);
					updated++;
				} catch (error) {
					console.log(`   ❌ Failed to update billing document:`, error.message);
				}
			} else {
				console.log(`   ✅ Billing document is up to date`);
			}
			console.log('');
		}

		return { updated, total: billingSnap.size };
	} catch (error) {
		console.error('❌ Error migrating billing:', error.message);
		throw error;
	}
}

async function ensureInsights() {
	console.log('🔍 Ensuring insights/global document exists...\n');

	try {
		const insightsRef = db.collection('insights').doc('global');
		const insightsSnap = await insightsRef.get();

		if (!insightsSnap.exists) {
			console.log('➕ Creating insights/global document with defaults');
			await insightsRef.set({
				usersServed: 0,
				resumesAnalyzed: 0,
				updatedAt: new Date()
			});
			console.log('✅ Created insights/global document');
		} else {
			console.log('✅ insights/global document already exists');
		}
	} catch (error) {
		console.error('❌ Error ensuring insights:', error.message);
	}
}

async function runMigration() {
	console.log('🚀 Starting Firestore Migration...\n');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	try {
		// Migrate payments
		const paymentResults = await migratePayments();
		console.log(`\n📊 Payments: ${paymentResults.updated}/${paymentResults.total} updated\n`);

		// Migrate billing
		const billingResults = await migrateBilling();
		console.log(`\n📊 Billing: ${billingResults.updated}/${billingResults.total} updated\n`);

		// Ensure insights
		await ensureInsights();

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('✨ Migration completed successfully!');
		console.log(`\n📈 Summary:`);
		console.log(`   - Payments updated: ${paymentResults.updated}/${paymentResults.total}`);
		console.log(`   - Billing updated: ${billingResults.updated}/${billingResults.total}`);
		console.log(`   - Insights: ensured`);
		console.log('\n💡 Your database is now up to date with the latest schema!');
		console.log('💡 Try refreshing the scanner page to see your updated credits.');

	} catch (error) {
		console.error('❌ Migration failed:', error.message);
		console.error(error.stack);
		process.exit(1);
	}
}

runMigration()
	.then(() => {
		console.log('\n✨ Script completed!');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Fatal error:', error);
		process.exit(1);
	});
