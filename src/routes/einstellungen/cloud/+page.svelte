<script lang="ts">
	import { onMount } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import TextInput from '../../../common/TextInput.svelte';
	import { api, cloud, CloudError, login, logout, type Me } from '$lib/cloud';
	import { messageForUnknown } from '$lib/shared/errors';

	const MESSAGES: Record<string, string> = {
		invalid_credentials: 'E-Mail oder Passwort falsch.',
		email_unverified: 'E-Mail-Adresse noch nicht bestätigt. Wir haben den Link erneut gesendet.',
		invalid_code: '2FA-Code ungültig.',
		too_many_requests: 'Zu viele Versuche, bitte später erneut probieren.'
	};
	const message = (e: unknown) =>
		(e instanceof CloudError && MESSAGES[e.code]) || messageForUnknown(e);

	const session = cloud();
	let url = $state('http://localhost:3000');
	let email = $state('');
	let password = $state('');
	let code = $state('');
	let needsCode = $state(false);
	let companyName = $state('');
	let me = $state<Me | null>(null);
	let busy = $state(false);
	let error = $state('');

	const active = $derived(me?.companies.find((c) => c.id === me?.activeCompanyId));

	onMount(async () => {
		if (session) await run(async () => (me = await api<Me>('/me')));
	});

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}

	// Every page loads its data on mount, so a mode switch reloads the app.
	const signIn = () =>
		run(async () => {
			if ((await login(url, email, password, needsCode ? code : undefined)) === 'mfa') {
				needsCode = true;
				return;
			}
			location.reload();
		});

	const signOut = () => run(async () => (await logout(), location.reload()));

	const createCompany = () =>
		run(async () => {
			await api('/companies', 'POST', { name: companyName });
			me = await api<Me>('/me');
		});

	const subscribe = () =>
		run(async () => openUrl((await api<{ url: string }>('/billing/checkout', 'POST', {})).url));
</script>

<section class="card space-y-4">
	<h2 class="text-base font-semibold">bookie Cloud</h2>
	<p class="text-sm text-zinc-500 dark:text-zinc-400">
		Angemeldet speichert bookie Firma, Kunden, Projekte und Zeiten auf dem Server, damit dein Team
		gemeinsam daran arbeiten kann. Die übrigen Bereiche folgen; bis dahin sind sie im Cloud-Modus
		gesperrt. Deine lokalen Daten bleiben unverändert auf diesem Gerät und sind nach dem Abmelden
		wieder da.
	</p>

	{#if !session}
		<div class="grid gap-3 md:grid-cols-2">
			<TextInput bind:value={url} label="Server" placeholder="https://api.example.de" />
			<TextInput bind:value={email} label="E-Mail" type="email" />
			<TextInput bind:value={password} label="Passwort" type="password" />
			{#if needsCode}
				<TextInput bind:value={code} label="2FA-Code oder Wiederherstellungscode" />
			{/if}
		</div>
		<button class="btn-primary" onclick={signIn} disabled={busy || !url || !email || !password}>
			Anmelden
		</button>
	{:else}
		<p class="text-sm">Angemeldet als <strong>{session.email}</strong> bei {session.url}</p>
		{#if me && !active}
			<div class="flex flex-wrap items-end gap-3">
				<TextInput bind:value={companyName} label="Firma anlegen" />
				<button class="btn-primary" onclick={createCompany} disabled={busy || !companyName.trim()}>
					Anlegen
				</button>
			</div>
		{:else if active}
			<p class="text-sm">
				Firma: <strong>{active.name}</strong> ·
				{active.paid ? 'Abo aktiv' : 'Kein aktives Abo'}
			</p>
			{#if !active.paid && active.role === 'admin'}
				<button class="btn-primary" onclick={subscribe} disabled={busy}>Abo abschließen</button>
			{/if}
		{/if}
		<button class="btn-secondary" onclick={signOut} disabled={busy}>Abmelden</button>
	{/if}

	{#if error}<p class="text-xs text-red-600">{error}</p>{/if}
</section>
