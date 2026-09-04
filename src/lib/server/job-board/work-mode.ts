// derives a three-way Remote / Hybrid / Onsite label for a posting, shown
// on every job card (previously the board only ever showed a "Remote" chip
// when remote was true, and said nothing otherwise - every non-remote role
// looked identical whether it was strictly onsite or a hybrid arrangement).
//
// Lever and Ashby both expose a direct `workplaceType` string on their raw
// posting (confirmed live against real boards - see their ats-clients'
// comments); that's the most reliable signal when present. Greenhouse has
// no equivalent field at all. locationRaw text ("Hybrid - NYC") is the
// fallback for whichever source doesn't give a direct signal, mirroring how
// Greenhouse's own remote detection already works (regex over locationRaw).
export type WorkMode = 'remote' | 'hybrid' | 'onsite';

function normalizeWorkplaceType(raw: string | null | undefined): WorkMode | null {
	if (!raw) return null;
	const v = raw.toLowerCase();
	if (v.includes('remote')) return 'remote';
	if (v.includes('hybrid')) return 'hybrid';
	if (v.includes('onsite') || v.includes('on-site') || v.includes('office')) return 'onsite';
	return null;
}

export function deriveWorkMode(
	remote: boolean,
	locationRaw: string,
	workplaceTypeRaw?: string | null
): WorkMode {
	// the raw ATS-provided workplaceType wins when present - it's a direct
	// categorical signal, not an inference. the stored `remote` boolean is
	// itself sometimes derived FROM this same field (see lever.ts/ashby.ts),
	// so checking workplaceType first keeps hybrid roles from being
	// flattened into a plain "remote" or "onsite" label.
	const fromWorkplaceType = normalizeWorkplaceType(workplaceTypeRaw);
	if (fromWorkplaceType) return fromWorkplaceType;
	if (remote) return 'remote';
	if (/hybrid/i.test(locationRaw)) return 'hybrid';
	return 'onsite';
}
