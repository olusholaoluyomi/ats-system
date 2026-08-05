// theme state for the design-system light/dark switch. matches the reference
// site's behaviour: persisted in localStorage, defaults to the OS preference,
// applied via the `data-theme` attribute on <html>.
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ats_theme';

class ThemeStore {
	theme = $state<Theme>('dark');

	constructor() {
		if (browser) {
			this.theme = this.resolveInitial();
			this.apply();
		}
	}

	private resolveInitial(): Theme {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved === 'dark' || saved === 'light') return saved;
		} catch {
			// storage unavailable — fall through to OS preference
		}
		return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	}

	private apply() {
		if (!browser) return;
		document.documentElement.setAttribute('data-theme', this.theme);
		try {
			localStorage.setItem(STORAGE_KEY, this.theme);
		} catch {
			// storage unavailable — theme still applies for this session
		}
	}

	toggle() {
		this.theme = this.theme === 'dark' ? 'light' : 'dark';
		this.apply();
	}
}

export const themeStore = new ThemeStore();
