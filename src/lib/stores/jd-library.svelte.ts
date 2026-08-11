// client-side job-description library. lets users save and recall JDs
// across sessions without any server infrastructure.
//
// persists to localStorage under 'ats_jd_library'. capped at 10 entries
// with FIFO eviction (oldest dropped first when the cap is exceeded).
// graceful fallback to in-memory-only when localStorage is unavailable
// (incognito, sandboxed iframes). one warn log per session on first failure.

import { browser } from '$app/environment';
import { logger } from '$lib/log';

const KEY = 'ats_jd_library';
const CAP = 10;

export interface JDEntry {
	id: string;
	label: string;
	content: string;
	savedAt: string;
}

class JDLibrary {
	entries = $state<JDEntry[]>([]);

	// whether we have already warned about a storage failure this session
	private warnedAboutStorage = false;

	constructor() {
		// load eagerly at construction (client only) rather than lazily inside
		// the `list` getter: mutating $state from a getter Svelte reads during
		// render triggers the state_unsafe_mutation warning. on the server
		// browser is false and the store stays empty; the client module
		// re-evaluates with window present, so entries are populated before the
		// first render.
		if (browser) this.load();
	}

	private load() {
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as JDEntry[];
				if (Array.isArray(parsed)) {
					this.entries = parsed;
				}
			}
		} catch (err) {
			if (!this.warnedAboutStorage) {
				this.warnedAboutStorage = true;
				logger.warn('jd_library.storage_failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}
	}

	private persist() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify(this.entries));
		} catch (err) {
			if (!this.warnedAboutStorage) {
				this.warnedAboutStorage = true;
				logger.warn('jd_library.storage_failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}
	}

	get list(): JDEntry[] {
		return this.entries;
	}

	save(label: string, content: string): void {
		const trimmedLabel = label.trim();
		const trimmedContent = content.trim();
		if (!trimmedContent) return;

		const entry: JDEntry = {
			id: crypto.randomUUID(),
			label: trimmedLabel || 'untitled',
			content: trimmedContent,
			savedAt: new Date().toISOString()
		};

		// prepend newest; evict oldest when over cap
		const updated = [entry, ...this.entries];
		this.entries = updated.slice(0, CAP);
		this.persist();
	}

	remove(id: string): void {
		this.entries = this.entries.filter((e) => e.id !== id);
		this.persist();
	}

	clear(): void {
		this.entries = [];
		this.persist();
	}
}

export const jdLibrary = new JDLibrary();
