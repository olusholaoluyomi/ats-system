// upserts one company's fetched postings into jobs/{jobId}, and sweeps
// postings that have disappeared from a source into active:false. mirrors
// billing.ts's idempotency-inside-transaction shape: tx.get() before
// tx.set(), decide new-vs-existing from what's actually in the doc right now.
import type { Firestore } from 'firebase-admin/firestore';
import type { RawJobPosting } from './types.ts';
import type { SeedCompany } from './seed-companies.ts';

export interface UpsertResult {
	jobId: string;
	isNew: boolean;
	// true for a brand-new posting, OR an existing one that was never
	// successfully classified (e.g. every LLM provider failed on a prior
	// run). isNew alone under-covers this: a posting that exists but still
	// has classification:null would otherwise never be retried by any
	// future run, since only "new" postings trigger classification.
	needsClassification: boolean;
}

// doc ID is deterministic per external posting (`${atsType}:${externalId}`)
// so re-ingestion always upserts the same doc instead of duplicating it.
export function jobId(atsType: SeedCompany['atsType'], externalId: string): string {
	return `${atsType}:${externalId}`;
}

export async function upsertCompanyPostings(
	db: Firestore,
	company: SeedCompany,
	postings: RawJobPosting[]
): Promise<UpsertResult[]> {
	const results: UpsertResult[] = [];

	for (const posting of postings) {
		const id = jobId(company.atsType, posting.externalId);
		const ref = db.doc(`jobs/${id}`);

		const { isNew, needsClassification } = await db.runTransaction(async (tx) => {
			const snap = await tx.get(ref);
			const now = new Date();

			if (!snap.exists) {
				tx.set(ref, {
					source: company.atsType,
					externalId: posting.externalId,
					companySlug: company.slug,
					companyName: company.name,
					title: posting.title,
					department: posting.department ?? null,
					locationRaw: posting.locationRaw,
					remote: posting.remote,
					applyUrl: posting.applyUrl,
					descriptionText: posting.descriptionText,
					postedAtSource: posting.postedAtSource,
					// the authoritative "posted" signal for the 24h filter - set
					// once, on first observation, never touched again. see
					// types.ts's RawJobPosting.postedAtSource comment for why the
					// source's own date is display-only instead.
					firstSeenAt: now,
					lastSeenAt: now,
					classifiedAt: null,
					classification: null,
					whyThisCompany: company.whyThisCompany ?? null,
					active: true,
					createdAt: now,
					updatedAt: now
				});
				return { isNew: true, needsClassification: true };
			}

			// existing posting: refresh everything except firstSeenAt (preserved)
			// and classification/classifiedAt (only classify.ts writes those - see
			// the cost-control note in the job-board plan). classification is
			// re-attempted on every run until it actually succeeds once, so a
			// posting that exists but was never successfully classified (every LLM
			// provider failed on some prior run) isn't stuck unclassified forever.
			const existing = snap.data() ?? {};
			tx.set(ref, {
				...existing,
				title: posting.title,
				department: posting.department ?? null,
				locationRaw: posting.locationRaw,
				remote: posting.remote,
				applyUrl: posting.applyUrl,
				descriptionText: posting.descriptionText,
				postedAtSource: posting.postedAtSource,
				lastSeenAt: now,
				active: true,
				updatedAt: now
			});
			return { isNew: false, needsClassification: existing.classification == null };
		});

		results.push({ jobId: id, isNew, needsClassification });
	}

	return results;
}

// marks postings inactive once they've gone missing from their source's
// feed for long enough that it's not just a single flaky ingestion run.
// `touchedJobIds` is every jobId successfully upserted THIS run, across all
// companies; anything currently active but not touched, whose lastSeenAt is
// older than `staleAfterMs`, gets flipped to active:false.
export async function sweepInactiveJobs(
	db: Firestore,
	touchedJobIds: Set<string>,
	staleAfterMs: number
): Promise<number> {
	const cutoff = new Date(Date.now() - staleAfterMs);
	const snapshot = await db.collection('jobs').where('active', '==', true).get();

	let sweptCount = 0;
	for (const doc of snapshot.docs) {
		if (touchedJobIds.has(doc.id)) continue;
		const lastSeenAt = doc.data().lastSeenAt;
		const lastSeenDate =
			lastSeenAt && typeof lastSeenAt.toDate === 'function' ? lastSeenAt.toDate() : lastSeenAt;
		if (lastSeenDate instanceof Date && lastSeenDate < cutoff) {
			await doc.ref.set({ active: false, updatedAt: new Date() }, { merge: true });
			sweptCount++;
		}
	}
	return sweptCount;
}
