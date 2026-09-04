<script lang="ts">
	import { browser } from '$app/environment';
	import SeoHead from '$components/seo/SeoHead.svelte';

	interface AdminCompany {
		id: string;
		slug: string;
		name: string;
		atsType: 'greenhouse' | 'lever' | 'ashby';
		boardToken: string;
		whyThisCompany: string | null;
		enabled: boolean;
		source: 'seed' | 'discovered' | 'admin';
	}

	interface AnalyticsRow {
		jobId: string;
		applyClicks: number;
	}

	const TOKEN_STORAGE_KEY = 'ats_admin_token';

	// the admin secret lives only in this tab's sessionStorage - never a
	// cookie, never a URL param, never sent anywhere except as the
	// x-admin-token header on requests this page itself makes. matches how
	// the underlying API routes were designed (see $lib/server/admin-auth):
	// a client-entered secret, not a session/cookie-based admin role.
	let token = $state(browser ? (sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '') : '');
	let companies = $state<AdminCompany[]>([]);
	let analytics = $state<AnalyticsRow[]>([]);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let view = $state<'companies' | 'analytics'>('companies');

	let formName = $state('');
	let formAtsType = $state<'greenhouse' | 'lever' | 'ashby'>('greenhouse');
	let formBoardToken = $state('');
	let formWhy = $state('');
	let adding = $state(false);

	function saveToken() {
		if (browser) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
	}

	async function authedFetch(
		path: string,
		init: Parameters<typeof fetch>[1] = {}
	): Promise<Response> {
		return fetch(path, {
			...init,
			headers: { ...init.headers, 'x-admin-token': token }
		});
	}

	async function loadCompanies() {
		if (!token) return;
		loading = true;
		errorMsg = null;
		try {
			const res = await authedFetch('/api/admin/companies');
			if (!res.ok) {
				errorMsg = `${res.status}: ${(await res.json().catch(() => ({})))?.message ?? 'failed to load'}`;
				return;
			}
			const data = await res.json();
			companies = data.companies;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function loadAnalytics() {
		if (!token) return;
		loading = true;
		errorMsg = null;
		try {
			const res = await authedFetch('/api/admin/job-analytics');
			if (!res.ok) {
				errorMsg = `${res.status}: ${(await res.json().catch(() => ({})))?.message ?? 'failed to load'}`;
				return;
			}
			const data = await res.json();
			analytics = data.rows;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function handleTokenSubmit(e: Event) {
		e.preventDefault();
		saveToken();
		loadCompanies();
	}

	async function handleAdd(e: Event) {
		e.preventDefault();
		if (!formName.trim() || !formBoardToken.trim()) return;
		adding = true;
		errorMsg = null;
		try {
			const res = await authedFetch('/api/admin/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName.trim(),
					atsType: formAtsType,
					boardToken: formBoardToken.trim(),
					whyThisCompany: formWhy.trim() || undefined
				})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				errorMsg = data.message ?? `failed to add (${res.status})`;
				return;
			}
			formName = '';
			formBoardToken = '';
			formWhy = '';
			await loadCompanies();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			adding = false;
		}
	}

	async function toggleEnabled(company: AdminCompany) {
		if (company.source !== 'admin') return;
		const res = await authedFetch(`/api/admin/companies/${company.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !company.enabled })
		});
		if (res.ok) await loadCompanies();
	}

	async function removeCompany(company: AdminCompany) {
		if (company.source !== 'admin') return;
		if (!confirm(`Remove ${company.name}? It will stop being ingested.`)) return;
		const res = await authedFetch(`/api/admin/companies/${company.id}`, { method: 'DELETE' });
		if (res.ok) await loadCompanies();
	}
</script>

<SeoHead
	title="Admin | ATS Screener"
	description="Job board company administration."
	noIndex={true}
/>

<main class="admin-page">
	<h1 class="admin-title">Job Board Admin</h1>

	<form class="token-form" onsubmit={handleTokenSubmit}>
		<label class="field">
			<span class="field-label">Admin token</span>
			<input
				type="password"
				bind:value={token}
				placeholder="x-admin-token"
				class="field-input"
				autocomplete="off"
			/>
		</label>
		<button type="submit" class="btn-primary">Load</button>
	</form>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}

	{#if token}
		<div class="tabs">
			<button
				class="tab"
				class:active={view === 'companies'}
				onclick={() => {
					view = 'companies';
					loadCompanies();
				}}
			>
				Companies
			</button>
			<button
				class="tab"
				class:active={view === 'analytics'}
				onclick={() => {
					view = 'analytics';
					loadAnalytics();
				}}
			>
				Apply-click analytics
			</button>
		</div>

		{#if view === 'companies'}
			<form class="add-form" onsubmit={handleAdd}>
				<div class="form-row">
					<label class="field">
						<span class="field-label">Company name</span>
						<input type="text" bind:value={formName} class="field-input" required />
					</label>
					<label class="field">
						<span class="field-label">ATS</span>
						<select bind:value={formAtsType} class="field-input">
							<option value="greenhouse">Greenhouse</option>
							<option value="lever">Lever</option>
							<option value="ashby">Ashby</option>
						</select>
					</label>
					<label class="field">
						<span class="field-label">Board token</span>
						<input type="text" bind:value={formBoardToken} class="field-input" required />
					</label>
				</div>
				<label class="field">
					<span class="field-label">Why this company (optional)</span>
					<input type="text" bind:value={formWhy} class="field-input" />
				</label>
				<button type="submit" class="btn-primary" disabled={adding}>
					{adding ? 'Verifying live...' : 'Add company'}
				</button>
			</form>

			{#if loading}
				<p>Loading...</p>
			{:else}
				<table class="admin-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>ATS</th>
							<th>Token</th>
							<th>Source</th>
							<th>Enabled</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each companies as c (c.id + c.source)}
							<tr>
								<td>{c.name}</td>
								<td>{c.atsType}</td>
								<td>{c.boardToken}</td>
								<td><span class="source-chip source-{c.source}">{c.source}</span></td>
								<td>
									{#if c.source === 'admin'}
										<input type="checkbox" checked={c.enabled} onchange={() => toggleEnabled(c)} />
									{:else}
										{c.enabled ? 'yes' : 'no'}
									{/if}
								</td>
								<td>
									{#if c.source === 'admin'}
										<button class="remove-btn" onclick={() => removeCompany(c)}>Remove</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{:else if loading}
			<p>Loading...</p>
		{:else}
			<table class="admin-table">
				<thead>
					<tr>
						<th>Job ID</th>
						<th>Apply clicks</th>
					</tr>
				</thead>
				<tbody>
					{#each analytics as row (row.jobId)}
						<tr>
							<td>{row.jobId}</td>
							<td>{row.applyClicks}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</main>

<style>
	.admin-page {
		max-width: var(--container-lg);
		margin: 0 auto;
		padding: 8rem var(--space-6) var(--space-24);
	}

	.admin-title {
		font-size: var(--text-2xl);
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: var(--space-6);
	}

	.token-form {
		display: flex;
		gap: var(--space-3);
		align-items: flex-end;
		margin-bottom: var(--space-6);
		max-width: 480px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1;
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

	.btn-primary {
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-full);
		border: none;
		background: var(--gradient-primary);
		color: var(--btn-text, #0a0e14);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error-banner {
		padding: var(--space-3);
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: var(--radius-md);
		color: #ef4444;
		font-size: var(--text-sm);
		margin-bottom: var(--space-4);
	}

	.tabs {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}

	.tab {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
		font-family: inherit;
	}

	.tab.active {
		background: var(--accent-tint);
		border-color: var(--accent-border);
		color: var(--accent-text);
	}

	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		margin-bottom: var(--space-6);
	}

	.form-row {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: var(--space-3);
	}

	.admin-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.admin-table th {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--glass-border);
	}

	.admin-table td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--glass-border);
		color: var(--text-primary);
	}

	.source-chip {
		font-size: var(--text-xs);
		padding: 0 var(--space-2);
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		color: var(--text-secondary);
	}

	.source-chip.source-admin {
		background: var(--accent-tint);
		border-color: var(--accent-border);
		color: var(--accent-text);
	}

	.remove-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		cursor: pointer;
		font-family: inherit;
	}

	.remove-btn:hover {
		color: #ef4444;
	}

	@media (max-width: 640px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
