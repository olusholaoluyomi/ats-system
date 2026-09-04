<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { firebaseConfigured } from '$lib/firebase';
	import SeoHead from '$components/seo/SeoHead.svelte';

	$effect(() => {
		if (authStore.disabled) return;
		if (!authStore.loading && !authStore.isAuthenticated) {
			goto('/login');
		}
	});

	$effect(() => {
		if (authStore.isAuthenticated) {
			notificationsStore.load();
		}
	});

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function handleOpen(id: string, jobId: string) {
		notificationsStore.markRead(id);
		goto(`/jobs/${jobId}`);
	}
</script>

<SeoHead
	title="Notifications | ATS Screener"
	description="Roles that matched your saved job-board preferences."
	noIndex={true}
/>

<main class="notifications-page">
	<header class="notifications-header">
		<h1 class="notifications-title">Notifications</h1>
		{#if notificationsStore.unreadCount > 0}
			<button class="btn-secondary" onclick={() => notificationsStore.markAllRead()}>
				Mark all read
			</button>
		{/if}
	</header>

	{#if !firebaseConfigured}
		<p class="notifications-empty">
			Match notifications aren't available in this self-host configuration.
		</p>
	{:else if notificationsStore.loading}
		<p class="notifications-empty">Loading...</p>
	{:else if notificationsStore.notifications.length === 0}
		<p class="notifications-empty">
			No notifications yet. Turn on match notifications from your <a href="/profile">profile</a> to get
			notified when a new role matches your keywords.
		</p>
	{:else}
		<ul class="notifications-list">
			{#each notificationsStore.notifications as n (n.id)}
				<li>
					<button
						class="notification-row"
						class:unread={!n.read}
						onclick={() => handleOpen(n.id, n.jobId)}
					>
						<div class="notification-main">
							<span class="notification-title">{n.title}</span>
							<span class="notification-company">{n.companyName}</span>
						</div>
						<span class="notification-date">{formatDate(n.createdAt)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.notifications-page {
		max-width: var(--container-sm);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.notifications-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-6);
	}

	.notifications-title {
		font-size: var(--text-3xl);
		font-weight: 800;
		color: var(--text-primary);
	}

	.btn-secondary {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		font-family: inherit;
	}

	.notifications-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: var(--space-16) 0;
	}

	.notifications-empty a {
		color: var(--accent-text);
	}

	.notifications-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.notification-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.notification-row.unread {
		border-color: var(--accent-border);
		background: var(--accent-tint);
	}

	.notification-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.notification-title {
		font-weight: 700;
		color: var(--text-primary);
	}

	.notification-company {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.notification-date {
		flex-shrink: 0;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}
</style>
