// upserts one company's fetched postings into jobs/{jobId}, and deactivates
// postings that have disappeared from that company's source - all from a
// SINGLE query of that company's existing docs, and only the writes that
// are actually new/changed/reactivated/deactivated, batched together.
//
// this replaced an earlier version that ran one Firestore transaction per
// posting (1 read + 1 write, every posting, every run, even when nothing
// about it had changed) plus a separate global sweep query reading every
// active job across every company, every run. that was fine at a handful of
// companies but blew straight through Firestore's free-tier daily quota
// (50k reads / 20k writes) once the board grew past ~150 companies with
// some posting 500-900+ roles each.
//
// IMPORTANT: this version's single query per company still returns (and
// therefore is billed for) up to `options.maxPostings` documents - Firestore
// bills one read per document a query RETURNS, not one read per query call.
// "one query per company" cut round-trips and eliminated the separate
// global sweep, but the actual read volume is `companies × maxPostings`,
// not `companies` - an earlier version of this comment conflated the two
// and a single ingestion run exhausted the entire daily read quota in ~11
// minutes as a result (2026-09-05). the real per-run read budget lives in
// ingest-jobs.mjs's MAX_POSTINGS_PER_COMPANY and the cron interval in
// ingest-jobs.yml - both were tightened alongside this fix.
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import type { RawJobPosting } from './types.ts';
import type { SeedCompany } from './seed-companies.ts';
import { extractYearsOfExperience } from './experience-heuristic.ts';
import { buildSearchKeywords } from './search-keywords.ts';
import { deriveWorkMode } from './work-mode.ts';
import { extractCompensation } from './compensation-heuristic.ts';
import { detectsRelocationSupport } from './relocation-heuristic.ts';

export interface UpsertResult {
	jobId: string;
	isNew: boolean;
	// false for a posting that was already active with identical content -
	// no write was issued for it. lets the caller log real write volume
	// instead of "one write per posting fetched".
	written: boolean;
}

// doc ID is deterministic per external posting (`${atsType}:${externalId}`)
// so re-ingestion always upserts the same doc instead of duplicating it.
export function jobId(atsType: SeedCompany['atsType'], externalId: string): string {
	return `${atsType}:${externalId}`;
}

// Firestore's hard cap is 500 writes per batch commit; leave headroom for
// the rare company whose posting count sits right at the edge.
const BATCH_LIMIT = 400;

interface MutableFields {
	title: string;
	department: string | null;
	locationRaw: string;
	remote: boolean;
	applyUrl: string;
	descriptionText: string;
	minYearsExperience: number | null;
	maxYearsExperience: number | null;
	workplaceTypeRaw: string | null;
}

// only the fields that matter for "did this posting actually change" -
// postedAtSource is deliberately excluded (display/debug only, see
// types.ts) so a source flip-flopping that field alone never forces a
// write. active must already be true too, so a previously-deactivated
// posting that reappears always gets rewritten (reactivated), never
// silently treated as "unchanged".
function isUnchanged(existing: Record<string, unknown>, next: MutableFields): boolean {
	return (
		existing.active === true &&
		existing.title === next.title &&
		(existing.department ?? null) === next.department &&
		existing.locationRaw === next.locationRaw &&
		existing.remote === next.remote &&
		existing.applyUrl === next.applyUrl &&
		existing.descriptionText === next.descriptionText &&
		(existing.minYearsExperience ?? null) === next.minYearsExperience &&
		(existing.maxYearsExperience ?? null) === next.maxYearsExperience &&
		(existing.workplaceTypeRaw ?? null) === next.workplaceTypeRaw
	);
}

async function commitInChunks(
	db: Firestore,
	writes: { ref: DocumentReference; data: Record<string, unknown> }[]
): Promise<void> {
	for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
		const chunk = writes.slice(i, i + BATCH_LIMIT);
		const batch = db.batch();
		for (const { ref, data } of chunk) {
			batch.set(ref, data, { merge: true });
		}
		await batch.commit();
	}
}

export interface UpsertOptions {
	// caps how many of this company's postings get WRITE-processed this run
	// (see ingest-jobs.mjs's own comment on why one large employer shouldn't
	// dominate the daily quota) - but never how many count as "still live" for
	// deactivation purposes. those are two different questions: a company
	// with 900 open roles and a cap of 40 should only get 40 created/
	// refreshed this run, but the OTHER 860 (already in Firestore from an
	// earlier, uncapped run) must not be wrongly marked inactive just because
	// this run didn't re-touch them - that would silently empty the board
	// company by company as ingestion re-runs. undefined/Infinity means no
	// cap (every test and any caller that doesn't pass this gets the old,
	// uncapped behavior).
	maxPostings?: number;
}

export async function upsertCompanyPostings(
	db: Firestore,
	company: SeedCompany,
	allPostings: RawJobPosting[],
	options: UpsertOptions = {}
): Promise<UpsertResult[]> {
	const results: UpsertResult[] = [];
	const pendingWrites: { ref: DocumentReference; data: Record<string, unknown> }[] = [];

	// the ONE read for this whole company - every posting below is decided
	// from this in-memory map, no per-posting reads.
	const existingSnap = await db.collection('jobs').where('companySlug', '==', company.slug).get();
	const existingByExternalId = new Map<
		string,
		{ ref: DocumentReference; data: Record<string, unknown> }
	>();
	for (const doc of existingSnap.docs) {
		const data = doc.data();
		if (typeof data.externalId === 'string') {
			existingByExternalId.set(data.externalId, { ref: doc.ref, data });
		}
	}

	const now = new Date();
	// built from the FULL fetched list (every posting the ATS actually
	// returned this run), independent of the write-processing cap below -
	// see UpsertOptions.maxPostings.
	const seenExternalIds = new Set(allPostings.map((p) => p.externalId));

	const maxPostings = options.maxPostings ?? Infinity;
	// sorted newest-first (by postedAtSource, nulls last) before capping, so
	// a company over the cap still gets its most current roles created/
	// refreshed rather than an arbitrary prefix of whatever order the ATS
	// API happened to return.
	const postingsToProcess =
		allPostings.length <= maxPostings
			? allPostings
			: [...allPostings]
					.sort((a, b) => (b.postedAtSource?.getTime() ?? 0) - (a.postedAtSource?.getTime() ?? 0))
					.slice(0, maxPostings);

	for (const posting of postingsToProcess) {
		const id = jobId(company.atsType, posting.externalId);
		const ref = db.doc(`jobs/${id}`);
		const { minYears, maxYears } = extractYearsOfExperience(posting.descriptionText);
		const searchKeywords = buildSearchKeywords(
			posting.title,
			company.name,
			posting.department ?? null
		);
		const workMode = deriveWorkMode(posting.remote, posting.locationRaw, posting.workplaceTypeRaw);
		const compensationText = extractCompensation(posting.descriptionText);
		const relocationSupport = detectsRelocationSupport(posting.descriptionText);
		const existing = existingByExternalId.get(posting.externalId);

		if (!existing) {
			pendingWrites.push({
				ref,
				data: {
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
					minYearsExperience: minYears,
					maxYearsExperience: maxYears,
					workplaceTypeRaw: posting.workplaceTypeRaw ?? null,
					workMode,
					compensationText,
					relocationSupport,
					searchKeywords,
					// the authoritative "posted" signal for the 48h filter - set
					// once, on first observation, never touched again.
					firstSeenAt: now,
					lastSeenAt: now,
					whyThisCompany: company.whyThisCompany ?? null,
					active: true,
					createdAt: now,
					updatedAt: now
				}
			});
			results.push({ jobId: id, isNew: true, written: true });
			continue;
		}

		const nextFields: MutableFields = {
			title: posting.title,
			department: posting.department ?? null,
			locationRaw: posting.locationRaw,
			remote: posting.remote,
			applyUrl: posting.applyUrl,
			descriptionText: posting.descriptionText,
			minYearsExperience: minYears,
			maxYearsExperience: maxYears,
			workplaceTypeRaw: posting.workplaceTypeRaw ?? null
		};

		if (isUnchanged(existing.data, nextFields)) {
			// already active with identical content - no write needed just to
			// prove it's still there. seenExternalIds (above) is what keeps it
			// from being deactivated below.
			results.push({ jobId: id, isNew: false, written: false });
			continue;
		}

		pendingWrites.push({
			ref: existing.ref,
			data: {
				...nextFields,
				postedAtSource: posting.postedAtSource,
				workMode,
				compensationText,
				relocationSupport,
				searchKeywords,
				lastSeenAt: now,
				active: true,
				updatedAt: now
				// firstSeenAt intentionally omitted - merge:true leaves it as
				// whatever was already stored, never reset on refresh.
			}
		});
		results.push({ jobId: id, isNew: false, written: true });
	}

	// anything previously known for this company that this run's fetch
	// didn't return is gone from the source - deactivate it now, using data
	// already in hand from the single read above (no extra reads, and this
	// replaces the old global sweep query entirely).
	for (const [externalId, { ref, data }] of existingByExternalId) {
		if (seenExternalIds.has(externalId)) continue;
		if (data.active === false) continue;
		pendingWrites.push({ ref, data: { active: false, updatedAt: now } });
	}

	await commitInChunks(db, pendingWrites);

	return results;
}

// storage-footprint cleanup: postings deactivated long ago (well past the
// 48h display window, see MAX_POSTING_AGE_MS in jobs/shared.ts) are hard-
// deleted rather than kept forever as active:false rows, so the 1 GiB
// free-tier storage cap doesn't creep up unbounded as companies churn
// through postings over months. bounded to one page per call so a single
// run's delete volume stays small and predictable against the 20k/day
// delete quota - called once per ingestion run (see ingest-jobs.mjs), not
// worth its own separate schedule.
const STALE_DELETE_PAGE_SIZE = 400;

export async function deleteStalePostings(db: Firestore, olderThanMs: number): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMs);
	const snapshot = await db
		.collection('jobs')
		.where('active', '==', false)
		.where('updatedAt', '<', cutoff)
		.limit(STALE_DELETE_PAGE_SIZE)
		.get();

	if (snapshot.empty) return 0;

	const batch = db.batch();
	for (const doc of snapshot.docs) batch.delete(doc.ref);
	await batch.commit();
	return snapshot.size;
}
