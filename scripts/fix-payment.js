/**
 * Utility script to investigate and fix stuck payment status
 * Usage: node scripts/fix-payment.js <user-uid> <payment-reference>
 *
 * This script will:
 * 1. Check the payment status in Firestore
 * 2. Check the user's billing state
 * 3. If payment is stuck in 'initiated' but was actually successful, it will fix it
 */

const admin = require('firebase-admin');
const serviceAccount = require('../ats-system-729c8-firebase-adminsdk-fbsvc-845fc8685a.json');

// Initialize Firebase Admin
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fixPaymentStatus(userUid, paymentReference) {
	console.log(`Investigating payment ${paymentReference} for user ${userUid}...`);

	try {
		// Check payment document
		const paymentRef = db.collection('payments').doc(paymentReference);
		const paymentSnap = await paymentRef.get();

		if (!paymentSnap.exists) {
			console.log('❌ Payment document not found');
			return;
		}

		const payment = paymentSnap.data();
		console.log('📄 Current payment status:', payment.status);
		console.log('💰 Amount:', payment.amountMinor, payment.currency);
		console.log('📅 Created:', payment.createdAt?.toDate?.() || payment.createdAt);

		// Check billing state
		const billingRef = db.collection('users').doc(userUid).collection('billing').doc('state');
		const billingSnap = await billingRef.get();
		const billing = billingSnap.exists() ? billingSnap.data() : { freeUsed: false, credits: 0 };

		console.log('💳 Current billing state:');
		console.log('   Free used:', billing.freeUsed);
		console.log('   Credits:', billing.credits);

		// If payment is stuck in 'initiated' but user says it was successful
		if (payment.status === 'initiated') {
			console.log('\n⚠️  Payment is stuck in "initiated" status');
			console.log('🔧 Attempting to fix...');

			await db.runTransaction(async (tx) => {
				const payTx = await tx.get(paymentRef);
				const billTx = await tx.get(billingRef);

				const payData = payTx.data();
				const billData = billTx.exists() ? billTx.data() : { freeUsed: false, credits: 0 };

				// Update payment to success
				tx.set(
					paymentRef,
					{
						...payData,
						status: 'success',
						scansAllowed: 4,
						updatedAt: new Date()
					},
					{ merge: true }
				);

				// Add credits to billing
				tx.set(billingRef, {
					freeUsed: billData.freeUsed === true,
					credits: (billData.credits || 0) + 4,
					updatedAt: new Date()
				});
			});

			console.log('✅ Payment status fixed!');
			console.log('✅ Added 4 scan credits to account');
		} else if (payment.status === 'success') {
			console.log('\n✅ Payment is already marked as successful');
			console.log('💡 If you still cannot scan, try refreshing the page or clearing browser cache');
		} else {
			console.log('\n❓ Payment status is:', payment.status);
			console.log('💡 Manual intervention may be required');
		}

		// Show final state
		const finalPaymentSnap = await paymentRef.get();
		const finalBillingSnap = await billingRef.get();
		const finalPayment = finalPaymentSnap.data();
		const finalBilling = finalBillingSnap.exists() ? finalBillingSnap.data() : {};

		console.log('\n📊 Final state:');
		console.log('   Payment status:', finalPayment.status);
		console.log('   Billing credits:', finalBilling.credits);

	} catch (error) {
		console.error('❌ Error:', error.message);
	}
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
	console.log('Usage: node scripts/fix-payment.js <user-uid> <payment-reference>');
	console.log('Example: node scripts/fix-payment.js abc123 xyz789');
	process.exit(1);
}

const [userUid, paymentReference] = args;

fixPaymentStatus(userUid, paymentReference)
	.then(() => {
		console.log('\n✨ Done!');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
