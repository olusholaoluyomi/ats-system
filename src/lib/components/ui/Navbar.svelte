<script lang="ts">
	import { page } from '$app/state';
	import Logo from './Logo.svelte';
	import UserMenu from './UserMenu.svelte';
	import AuthButton from './AuthButton.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { themeStore } from '$stores/theme.svelte';

	// controls the mobile menu visibility
	let mobileOpen = $state(false);

	// highlight the active route
	const currentPath = $derived(page.url.pathname);
</script>

<nav class="navbar">
	<div class="nav-inner">
		<div class="brand">
			<Logo size="sm" />
			<a
				href="https://olusholaoluyomi.com"
				class="brand-name"
				target="_blank"
				rel="noopener"
				aria-label="Olushola Oluyomi - personal site"
			>
				Olushola Oluyomi
			</a>
		</div>

		<div class="nav-links" class:open={mobileOpen}>
			<a
				href="/"
				class="nav-link"
				class:active={currentPath === '/'}
				aria-current={currentPath === '/' ? 'page' : undefined}>Home</a
			>
			<a
				href="/scanner"
				class="nav-link"
				class:active={currentPath === '/scanner'}
				aria-current={currentPath === '/scanner' ? 'page' : undefined}>Scanner</a
			>
			<a href="/scanner" class="nav-cta"> Scan Now </a>

			<!-- theme toggle sits between the Scan Now CTA and the auth slot -->
			<button
				class="theme-toggle"
				onclick={() => themeStore.toggle()}
				aria-label={themeStore.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			>
				{#if themeStore.theme === 'dark'}
					<!-- sun icon -->
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
					</svg>
				{:else}
					<!-- moon icon -->
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
					</svg>
				{/if}
			</button>

			<!-- auth slot hidden in anonymous self-host ('none' mode) since there's
			     no sign-in to offer. shown when auth is required (hosted firebase OR
			     ldap self-host); the UserMenu / AuthButton split applies to both. -->
			{#if authStore.requiresAuth && !authStore.loading}
				{#if authStore.isAuthenticated}
					<UserMenu />
				{:else}
					<AuthButton />
				{/if}
			{/if}
		</div>

		<!-- mobile hamburger -->
		<button
			class="nav-toggle"
			onclick={() => (mobileOpen = !mobileOpen)}
			aria-label="toggle navigation"
		>
			<span class="bar" class:open={mobileOpen}></span>
			<span class="bar" class:open={mobileOpen}></span>
			<span class="bar" class:open={mobileOpen}></span>
		</button>
	</div>
</nav>

<style>
	.navbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: 0.875rem 2rem;
		background: color-mix(in srgb, var(--color-bg-primary) 85%, transparent);
		backdrop-filter: blur(24px);
		border-bottom: 1px solid var(--glass-border);
	}

	.nav-inner {
		max-width: 1400px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: space-between;
	}

	/* logo + owner credit link, persistent across all routes */
	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.brand-name {
		padding-left: 0.75rem;
		border-left: 1px solid var(--glass-border);
		font-family: var(--font-display);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.2s ease;
	}

	.brand-name:hover {
		color: var(--accent-text);
	}

	/* theme toggle */
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		min-height: 32px;
		padding: 0.4rem;
		color: var(--text-secondary);
		background: var(--tint);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
	}

	.theme-toggle:hover {
		color: var(--accent-text);
		border-color: var(--glass-border-hover);
		background: var(--tint-hover);
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 2rem;
	}

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		transition: color 0.2s ease;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.nav-link:hover,
	.nav-link.active {
		color: var(--text-primary);
	}

	/* active nav item: accent color + 2px left border + subtle tint */
	.nav-link.active {
		color: var(--accent-text);
		border-left: 2px solid var(--accent-cyan);
		padding-left: 0.6rem;
		background: rgba(255, 43, 127, 0.05);
	}

	/* CTA button in navbar */
	.nav-cta {
		padding: 0.5rem 1.25rem;
		font-family: var(--font-display);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--btn-text);
		background: var(--gradient-primary);
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.nav-cta:hover {
		transform: translateY(-1px);
		box-shadow: var(--glow-accent);
		color: var(--btn-text);
	}

	.nav-toggle {
		display: none;
		flex-direction: column;
		gap: 4px;
		background: none;
		border: none;
		cursor: pointer;
		/* 44x44 meets WCAG 2.5.5 touch target size recommendation.
		   bars are 20x2px; the extra padding makes up the difference. */
		min-width: 44px;
		min-height: 44px;
		padding: 12px;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}

	.bar {
		width: 20px;
		height: 2px;
		background: var(--text-secondary);
		border-radius: 1px;
		transition:
			transform 0.3s ease,
			opacity 0.3s ease;
	}

	.bar.open:nth-child(1) {
		transform: rotate(45deg) translate(4px, 4px);
	}
	.bar.open:nth-child(2) {
		opacity: 0;
	}
	.bar.open:nth-child(3) {
		transform: rotate(-45deg) translate(4px, -4px);
	}

	@media (max-width: 640px) {
		.nav-toggle {
			display: flex;
		}

		.brand-name {
			font-size: 0.62rem;
		}

		.nav-links {
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			flex-direction: column;
			padding: 1.5rem 2rem;
			background: color-mix(in srgb, var(--color-bg-primary) 98%, transparent);
			backdrop-filter: blur(24px);
			border-bottom: 1px solid var(--glass-border);
			gap: 1rem;
			display: none;
		}

		.nav-links.open {
			display: flex;
		}

		.nav-cta {
			width: fit-content;
		}
	}
</style>
