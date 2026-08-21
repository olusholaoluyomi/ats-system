import '@testing-library/svelte/vitest';
import { vi } from 'vitest';

// Mock SvelteKit environment modules for tests
vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));
