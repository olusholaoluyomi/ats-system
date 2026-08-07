import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// runtime pins the serverless function Node version. adapter-vercel's
		// default is nodejs20.x, which cannot require() ESM-only transitive deps
		// like jose@6 (pulled in by firebase-admin -> jwks-rsa) - that blew up as
		// "require() of ES Module ... not supported" at runtime. nodejs24.x
		// matches the declared engines (^22.13.0 || >=24.0.0) and .nvmrc, and
		// supports require(esm).
		adapter: adapter({ runtime: 'nodejs24.x' }),
		alias: {
			$components: 'src/lib/components',
			$engine: 'src/lib/engine',
			$stores: 'src/lib/stores',
			$styles: 'src/lib/styles',
			$utils: 'src/lib/utils'
		}
	}
};

export default config;
