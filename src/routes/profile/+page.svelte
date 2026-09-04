<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
	import { profileStore } from '$stores/profile.svelte';
	import { firebaseConfigured } from '$lib/firebase';
	import SeoHead from '$components/seo/SeoHead.svelte';

	// redirect if not logged in. self-host installs (auth disabled) skip the
	// redirect: the profile there is localStorage-backed and viewable without
	// a sign-in, same as /tracker.
	$effect(() => {
		if (authStore.disabled) return;
		if (!authStore.loading && !authStore.isAuthenticated) {
			goto('/login');
		}
	});

	$effect(() => {
		if (authStore.disabled || authStore.isAuthenticated) {
			profileStore.load();
		}
	});

	// account identity (display name / avatar) is only editable in firebase
	// mode, where it's backed by the real Firebase user record - ldap's name
	// comes from AD (not locally editable), and 'none' mode has no persistent
	// identity to attach it to.
	const canEditIdentity = $derived(authStore.mode === 'firebase');

	let formDisplayName = $state('');
	let formPhotoURL = $state('');
	let formRemoteOnly = $state(false);
	let formKeywords = $state('');
	let formNotifyOnMatch = $state(false);
	let formNotifyKeywords = $state('');
	let formNotifyRemoteOnly = $state(false);
	let hydrated = $state(false);
	let saving = $state(false);
	let savedMessage = $state('');
	let errorMessage = $state('');

	// hydrate the local form fields once the store finishes its first load,
	// so the form isn't fighting default values while the async load is
	// still in flight.
	$effect(() => {
		if (profileStore.loaded && !hydrated) {
			formDisplayName = profileStore.profile.displayName || authStore.displayName;
			formPhotoURL = profileStore.profile.photoURL || authStore.photoURL || '';
			formRemoteOnly = profileStore.profile.preferredRemoteOnly;
			formKeywords = profileStore.profile.preferredKeywords;
			formNotifyOnMatch = profileStore.profile.notifyOnMatch;
			formNotifyKeywords = profileStore.profile.notifyKeywords;
			formNotifyRemoteOnly = profileStore.profile.notifyRemoteOnly;
			hydrated = true;
		}
	});

	async function handleSave(e: Event) {
		e.preventDefault();
		saving = true;
		savedMessage = '';
		errorMessage = '';
		try {
			if (canEditIdentity && authStore.user && firebaseConfigured) {
				const { updateProfile } = await import('firebase/auth');
				await updateProfile(authStore.user, {
					displayName: formDisplayName.trim() || null,
					photoURL: formPhotoURL.trim() || null
				});
			}
			const ok = await profileStore.save({
				displayName: formDisplayName.trim(),
				photoURL: formPhotoURL.trim(),
				preferredRemoteOnly: formRemoteOnly,
				preferredKeywords: formKeywords.trim(),
				notifyOnMatch: formNotifyOnMatch,
				notifyKeywords: formNotifyKeywords.trim(),
				notifyRemoteOnly: formNotifyRemoteOnly
			});
			if (ok) {
				savedMessage = 'Profile saved.';
			} else {
				errorMessage = 'Could not save your profile. Please try again.';
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not save your profile.';
		} finally {
			saving = false;
		}
	}
</script>

<SeoHead
	title="Profile | ATS Screener"
	description="Manage your display name, avatar, and job-board search and notification preferences."
	noIndex={true}
/>

<main class="profile-page">
	<header class="profile-header">
		<h1 class="profile-title">Profile</h1>
		<p class="profile-subtitle">
			Your display name and avatar, plus defaults for job-board search and match notifications.
		</p>
	</header>

	<form class="profile-form" onsubmit={handleSave}>
		{#if canEditIdentity}
			<section class="profile-section">
				<h2 class="section-title">Identity</h2>
				<div class="form-row">
					<label class="field">
						<span class="field-label">Display name</span>
						<input
							type="text"
							class="field-input"
							bind:value={formDisplayName}
							placeholder="Your name"
							maxlength="80"
						/>
					</label>
					<label class="field">
						<span class="field-label">Avatar URL</span>
						<input
							type="url"
							class="field-input"
							bind:value={formPhotoURL}
							placeholder="https://..."
						/>
					</label>
				</div>
			</section>
		{/if}

		<section class="profile-section">
			<h2 class="section-title">Job board search defaults</h2>
			<p class="section-hint">
				Pre-fills the job board's filters when you land there without your own search yet.
			</p>
			<label class="field">
				<span class="field-label">Preferred keywords</span>
				<input
					type="text"
					class="field-input"
					bind:value={formKeywords}
					placeholder="e.g. product manager"
				/>
			</label>
			<label class="checkbox-field">
				<input type="checkbox" bind:checked={formRemoteOnly} />
				<span>Remote roles only</span>
			</label>
		</section>

		<section class="profile-section">
			<h2 class="section-title">Match notifications</h2>
			<p class="section-hint">
				Get notified in-app when a newly posted role matches your criteria below. Email delivery
				isn't set up yet - notifications appear here on the site.
			</p>
			<label class="checkbox-field">
				<input type="checkbox" bind:checked={formNotifyOnMatch} />
				<span>Notify me about matching roles</span>
			</label>
			{#if formNotifyOnMatch}
				<label class="field">
					<span class="field-label">Match keywords</span>
					<input
						type="text"
						class="field-input"
						bind:value={formNotifyKeywords}
						placeholder="e.g. network engineer"
					/>
				</label>
				<label class="checkbox-field">
					<input type="checkbox" bind:checked={formNotifyRemoteOnly} />
					<span>Remote roles only</span>
				</label>
			{/if}
		</section>

		{#if savedMessage}
			<p class="status-message success">{savedMessage}</p>
		{/if}
		{#if errorMessage}
			<p class="status-message error">{errorMessage}</p>
		{/if}

		<button class="btn-primary" type="submit" disabled={saving}>
			{saving ? 'Saving...' : 'Save profile'}
		</button>
	</form>
</main>

<style>
	.profile-page {
		max-width: var(--container-sm);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.profile-header {
		margin-bottom: var(--space-8);
	}

	.profile-title {
		font-size: var(--text-3xl);
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: var(--space-2);
	}

	.profile-subtitle {
		color: var(--text-tertiary);
	}

	.profile-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.profile-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--text-primary);
	}

	.section-hint {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin-top: calc(var(--space-2) * -1);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.field-input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-family: inherit;
	}

	.checkbox-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.status-message {
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
	}

	.status-message.success {
		color: var(--accent-text);
		background: var(--accent-tint);
	}

	.status-message.error {
		color: var(--danger);
		background: rgba(239, 68, 68, 0.1);
	}

	.btn-primary {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-full);
		font-weight: 600;
		font-size: var(--text-sm);
		border: none;
		cursor: pointer;
		font-family: inherit;
		background: var(--gradient-primary);
		color: var(--btn-text, #0a0e14);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
