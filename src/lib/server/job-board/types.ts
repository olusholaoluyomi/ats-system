// shared shape every ATS client (greenhouse/lever/ashby) normalizes its raw
// response into, so dedupe-and-write.ts never needs to know which source a
// posting came from.

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
	// what actually gates "posted in the last 48 hours", since this field is
	// inconsistent across companies/sources (often null, or reflects internal
	// creation rather than public posting).
	postedAtSource: Date | null;
	// Lever and Ashby both expose a direct remote/hybrid/onsite categorical
	// field (see their ats-clients); Greenhouse has none, so this stays
	// undefined there. see work-mode.ts for how this and `remote`/
	// `locationRaw` combine into the WorkMode shown on the board.
	workplaceTypeRaw?: string | null;
}
