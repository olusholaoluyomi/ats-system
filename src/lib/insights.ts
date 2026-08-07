// client-side aggregate counters for the landing page's "Users Served" and
// "Resumes Analyzed" stats. both live in a single `insights/global` document,
// deliberately separate from user scan records (`users/{uid}/scans`): clearing
// a user's history only deletes their scans, so these counters keep growing
// regardless. increments are fire-and-forget by design — a failed write must
// never break the signup or scan flow that triggered it.
import { firebaseConfigured } from '$lib/firebase';

// a new account was created (new signups only; see the auth store call sites)
export async function incrementUserCount(): Promise<void> {
	await incrementInsight({ userCount: 1 });
}

// a resume completed a full LLM score analysis
export async function incrementResumesAnalyzed(): Promise<void> {
	await incrementInsight({ resumesAnalyzed: 1 });
}

async function incrementInsight(fields: Record<string, number>): Promise<void> {
	if (!firebaseConfigured) return;
	try {
		const { getFirebase } = await import('$lib/firebase');
		const { db } = await getFirebase();
		const { doc, setDoc, increment } = await import('firebase/firestore');
		// setDoc with merge:true (not updateDoc): the insights/global doc does
		// not exist before the first increment, and updateDoc throws on a
		// missing document, silently zeroing the counter forever. merge:true
		// creates the doc at the field's first value and increments from there.
		const patch = Object.fromEntries(
			Object.entries(fields).map(([key, value]) => [key, increment(value)])
		);
		await setDoc(doc(db, 'insights', 'global'), patch, { merge: true });
	} catch {
		// non-critical; a failed counter write must never break the caller
	}
}
