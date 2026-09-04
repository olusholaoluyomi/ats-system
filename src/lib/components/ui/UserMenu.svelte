<script lang="ts">
	import { authStore } from '$stores/auth.svelte';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { goto } from '$app/navigation';

	let open = $state(false);

	$effect(() => {
		if (authStore.isAuthenticated) {
			notificationsStore.load();
		}
	});

	function handleSignOut() {
		authStore.signOut();
		open = false;
		goto('/');
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.user-menu')) {
			open = false;
		}
	}

	function goToScanner() {
		open = false;
		goto('/scanner');
	}

	function goToHistory() {
		open = false;
		goto('/history');
	}

	function goToTracker() {
		open = false;
		goto('/tracker');
	}

	function goToProfile() {
		open = false;
		goto('/profile');
	}

	function goToNotifications() {
		open = false;
		goto('/notifications');
	}

	function goToTransactions() {
		open = false;
		goto('/transactions');
	}

	async function handleDeleteProfile() {
		open = false;
		if (
			!confirm(
				'Delete your account and personal data? This will remove your profile and scans but keep payment records for audit. This action is irreversible.'
			)
		)
			return;
		const token = await authStore.getIdToken();
		if (!token) {
			alert('You must be signed in to delete your account.');
			return;
		}
		try {
			const res = await fetch('/api/account/delete', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok) {
				// signed-in user removed; sign out locally and redirect home
				authStore.signOut();
				goto('/');
			} else {
				const data = await res.json().catch(() => ({}));
				alert((data.error as string) ?? 'Failed to delete account');
			}
		} catch (err) {
			alert('Failed to delete account: ' + (err instanceof Error ? err.message : String(err)));
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="user-menu">
	<button class="avatar-btn" onclick={() => (open = !open)} aria-label="User menu">
		{#if authStore.photoURL}
			<img
				src={authStore.photoURL}
				alt={authStore.displayName}
				class="avatar-img"
				width="36"
				height="36"
				loading="lazy"
				decoding="async"
				referrerpolicy="no-referrer"
			/>
		{:else}
			<span class="avatar-initials">{authStore.initials}</span>
		{/if}
		{#if notificationsStore.unreadCount > 0}
			<span class="unread-badge"
				>{notificationsStore.unreadCount > 9 ? '9+' : notificationsStore.unreadCount}</span
			>
		{/if}
	</button>

	{#if open}
		<div class="dropdown">
			<div class="dropdown-header">
				<span class="dropdown-name">{authStore.displayName}</span>
				{#if authStore.email}
					<span class="dropdown-email">{authStore.email}</span>
				{/if}
			</div>
			<div class="dropdown-divider"></div>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToScanner();
				}}
				href="/scanner"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14,2 14,8 20,8" />
				</svg>
				Scanner
			</a>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToHistory();
				}}
				href="/history"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<circle cx="12" cy="12" r="10" />
					<polyline points="12,6 12,12 16,14" />
				</svg>
				Scan History
			</a>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToTracker();
				}}
				href="/tracker"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M9 11l3 3L22 4" />
					<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
				</svg>
				Application Tracker
			</a>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToProfile();
				}}
				href="/profile"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
					<circle cx="12" cy="7" r="4" />
				</svg>
				Profile
			</a>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToNotifications();
				}}
				href="/notifications"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
					<path d="M13.73 21a2 2 0 0 1-3.46 0" />
				</svg>
				Notifications
				{#if notificationsStore.unreadCount > 0}
					<span class="item-badge"
						>{notificationsStore.unreadCount > 9 ? '9+' : notificationsStore.unreadCount}</span
					>
				{/if}
			</a>
			<a
				class="dropdown-item"
				onclick={(event) => {
					event.preventDefault();
					goToTransactions();
				}}
				href="/transactions"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M3 3h18v4H3z" />
					<path d="M5 11h14v10H5z" />
				</svg>
				Subscriptions
			</a>
			<div class="dropdown-divider"></div>
			<button class="dropdown-item" onclick={handleSignOut}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
					<polyline points="16,17 21,12 16,7" />
					<line x1="21" y1="12" x2="9" y2="12" />
				</svg>
				Sign Out
			</button>
			<button class="dropdown-item danger" onclick={handleDeleteProfile}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M3 6h18" />
					<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
					<path d="M10 11v6" />
					<path d="M14 11v6" />
					<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
				</svg>
				Delete my profile
			</button>
		</div>
	{/if}
</div>

<style>
	.user-menu {
		position: relative;
	}

	.avatar-btn {
		position: relative;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid var(--glass-border);
		background: var(--glass-bg);
		cursor: pointer;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
		padding: 0;
	}

	.avatar-btn:hover {
		border-color: var(--accent-border-hover);
		box-shadow: 0 0 12px var(--accent-border);
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 50%;
	}

	.avatar-initials {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--accent-text);
	}

	.unread-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 16px;
		height: 16px;
		padding: 0 3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: var(--danger, #ef4444);
		color: #fff;
		font-size: 0.6rem;
		font-weight: 700;
		line-height: 1;
		border: 2px solid var(--color-bg-primary, #0a0e14);
	}

	.item-badge {
		margin-left: auto;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: var(--danger, #ef4444);
		color: #fff;
		font-size: 0.65rem;
		font-weight: 700;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 220px;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(20px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 100;
		overflow: hidden;
		animation: dropdown-in 0.15s ease;
	}

	@keyframes dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}

	/* mobile: when the avatar lives inside the hamburger menu column,
	   center the dropdown under the avatar instead of right-anchoring it. */
	@media (max-width: 768px) {
		.dropdown {
			right: auto;
			left: 50%;
			transform: translateX(-50%);
			min-width: min(260px, calc(100vw - 2rem));
			animation: dropdown-in-centered 0.15s ease;
		}
	}

	@keyframes dropdown-in-centered {
		from {
			opacity: 0;
			transform: translate(-50%, -6px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.dropdown-header {
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.dropdown-name {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.dropdown-email {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--glass-border);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.7rem 1rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		background: none;
		border: none;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		font-family: inherit;
		text-align: left;
	}

	.dropdown-item:hover {
		background: var(--accent-tint);
		color: var(--text-primary);
	}

	.dropdown-item.danger {
		color: var(--danger);
	}
</style>
