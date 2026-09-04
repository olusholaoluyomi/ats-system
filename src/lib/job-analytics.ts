// client-side apply-click counter for job board postings, one doc per job
// in `job_analytics/{jobId}`. mirrors insights.ts's exact shape (increment
// fire-and-forget, setDoc+merge because the doc doesn't exist until the
// first click, swallow all errors so a failed write never blocks the
// outbound Apply navigation it's attached to).
import { firebaseConfigured } from '$lib/firebase';

export async function incrementApplyClick(jobId: string): Promise<void> {
	if (!firebaseConfigured) return;
	try {
		const { getFirebase } = await import('$lib/firebase');
		const { db } = await getFirebase();
		const { doc, setDoc, increment } = await import('firebase/firestore');
		await setDoc(doc(db, 'job_analytics', jobId), { applyClicks: increment(1) }, { merge: true });
	} catch {
		// non-critical; a failed counter write must never block the Apply click
	}
}
