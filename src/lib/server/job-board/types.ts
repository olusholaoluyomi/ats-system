// shared shape every ATS client (greenhouse/lever/ashby) normalizes its raw
// response into, so dedupe-and-write.ts and classify.ts never need to know
// which source a posting came from.

export interface RawJobPosting {
	externalId: string;
	title: string;
	department?: string;
	locationRaw: string;
	remote: boolean;
	applyUrl: string;
	descriptionText: string;
	// the ATS's own posted/published date, where available. display/debug
	// only - firstSeenAt (stamped at write time, see dedupe-and-write.ts) is
	// what actually gates "posted in the last 24 hours", since this field is
	// inconsistent across companies/sources (often null, or reflects internal
	// creation rather than public posting).
	postedAtSource: Date | null;
}
