<script lang="ts">
	import { onMount } from 'svelte';
	import TextInput from '../../../common/TextInput.svelte';
	import { api, cloud, CloudError, type Me } from '$lib/cloud';
	import { listProjects } from '$lib/db/projects';
	import type { Project } from '$lib/db/types';
	import { formatCents } from '$lib/shared/money';
	import { messageForUnknown } from '$lib/shared/errors';
	import * as team from '$lib/team';

	const MESSAGES: Record<string, string> = {
		invalid_input: 'Eingabe ungültig.',
		invalid_token: 'Einladung ungültig oder abgelaufen.',
		wrong_account: 'Die Einladung gilt für eine andere E-Mail-Adresse.',
		already_member: 'Du bist bereits Mitglied dieser Firma.',
		too_many_requests: 'Zu viele Einladungen heute, bitte später erneut probieren.',
		rejected: 'Zuweisung nicht möglich.',
		not_found: 'Nicht gefunden.',
		no_grants_for_role: 'Admin und Subunternehmer erhalten keine Bereichsrechte.'
	};
	const message = (e: unknown) =>
		(e instanceof CloudError && MESSAGES[e.code]) || messageForUnknown(e);
	const ROLES: Record<team.Role, string> = {
		admin: 'Admin',
		member: 'Mitglied',
		subcontractor: 'Subunternehmer'
	};
	const AREA_LABELS: Record<team.Area, string> = {
		invoices: 'Rechnungen',
		incoming_invoices: 'Eingangsrechnungen',
		reports: 'Berichte',
		recurring: 'Wiederkehrend',
		team_time: 'Team-Zeiten',
		settings: 'Einstellungen'
	};
	type GrantLevel = '' | team.Grant['level'];
	const hours = (min: number) => (min / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 });
	const eur = (cents: number | null) => (cents == null ? '' : String(cents / 100).replace('.', ','));

	const session = cloud();
	let me = $state<Me | null>(null);
	let members = $state<team.TeamMember[]>([]);
	let rates = $state<Record<number, string>>({});
	let grants = $state<Record<number, Record<team.Area, GrantLevel>>>({});
	let projects = $state<Project[]>([]);
	let projectId = $state<number | null>(null);
	let assigned = $state<number[]>([]);
	let inviteEmail = $state('');
	let inviteRole = $state<'member' | 'subcontractor'>('member');
	let inviteRate = $state('');
	let token = $state('');
	let approveUser = $state<number | null>(null);
	let month = $state(new Date().toISOString().slice(0, 7));
	let report = $state<team.SubcontractorRow[] | null>(null);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const active = $derived(me?.companies.find((c) => c.id === me?.activeCompanyId));
	const admin = $derived(active?.role === 'admin');

	onMount(() => session && run(load));

	async function load() {
		me = await api<Me>('/me');
		if (active?.role !== 'admin') return;
		members = await team.listMembers();
		rates = Object.fromEntries(members.map((m) => [m.user_id, eur(m.cost_rate_cents)]));
		grants = Object.fromEntries(
			members.map((m) => [
				m.user_id,
				Object.fromEntries(
					team.AREAS.map((a) => [a, m.grants.find((g) => g.area === a)?.level ?? ''])
				) as Record<team.Area, GrantLevel>
			])
		);
		projects = await listProjects(active.id);
		if (projectId != null) assigned = await team.listAssignments(projectId);
	}

	async function run(fn: () => Promise<unknown>, done = '') {
		busy = true;
		error = notice = '';
		try {
			await fn();
			notice = done;
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}

	const sendInvite = () =>
		run(async () => {
			await team.invite(inviteEmail.trim(), inviteRole, inviteRate);
			inviteEmail = inviteRate = '';
		}, 'Einladung gesendet.');

	// The server switches the session to the new company: reload like a company switch.
	const accept = () =>
		run(async () => {
			await team.acceptInvitation(token);
			location.reload();
		});

	const saveRate = (userId: number) =>
		run(async () => {
			await team.setCostRate(userId, rates[userId]);
			await load();
		}, 'Kostensatz gespeichert.');

	const saveGrants = (userId: number) =>
		run(async () => {
			const g = grants[userId];
			await team.setGrants(
				userId,
				team.AREAS.flatMap((area) => (g[area] ? [{ area, level: g[area] }] : []))
			);
			await load();
		}, 'Rechte gespeichert.');

	const changeRole = (m: team.TeamMember, select: HTMLSelectElement) => {
		const role = select.value as 'member' | 'subcontractor';
		if (
			role === 'subcontractor' &&
			m.grants.length > 0 &&
			!confirm(`${m.name} wird Subunternehmer und verliert alle Bereichsrechte. Fortfahren?`)
		) {
			select.value = m.role;
			return;
		}
		run(async () => {
			await team.setRole(m.user_id, role);
			await load();
		}, 'Rolle geändert.');
	};

	const remove = (m: team.TeamMember) => {
		if (!confirm(`${m.name} aus der Firma entfernen?`)) return;
		run(async () => {
			await team.removeMember(m.user_id);
			await load();
		}, 'Mitglied entfernt.');
	};

	const pickProject = (id: number | null) =>
		run(async () => {
			projectId = id;
			assigned = id == null ? [] : await team.listAssignments(id);
		});

	const toggleAssignment = (userId: number, on: boolean) =>
		run(async () => {
			if (projectId == null) return;
			await (on ? team.assign(projectId, userId) : team.unassign(projectId, userId));
			assigned = await team.listAssignments(projectId);
		});

	const approve = (on: boolean) =>
		run(async () => {
			if (approveUser == null) return;
			const n = on
				? (await team.approveMonth(approveUser, month)).approved
				: (await team.unapproveMonth(approveUser, month)).unapproved;
			notice = `${n} Einträge ${on ? 'freigegeben' : 'zurückgenommen'}.`;
		}, '');

	const loadReport = () => run(async () => (report = await team.subcontractorReport(month)));
</script>

{#if !session}
	<section class="card">
		<p class="text-sm">Die Teamverwaltung ist nur mit bookie Cloud verfügbar.</p>
	</section>
{:else}
	<div class="space-y-6">
		{#if error}<p class="text-sm text-red-600">{error}</p>{/if}
		{#if notice}<p class="text-sm text-green-700 dark:text-green-400">{notice}</p>{/if}

		{#if admin}
			<section class="card space-y-4">
				<h2 class="text-base font-semibold">Mitglieder</h2>
				<div class="table-scroll">
					<table class="w-full text-sm">
						<thead class="table-head">
							<tr>
								<th class="px-3 py-2 text-left">Name</th>
								<th class="px-3 py-2 text-left">E-Mail</th>
								<th class="px-3 py-2 text-left">Rolle</th>
								<th class="px-3 py-2 text-left">Kostensatz (€/h)</th>
								<th class="px-3 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each members as m (m.user_id)}
								<tr class="data-row">
									<td class="px-3 py-2">{m.name}</td>
									<td class="px-3 py-2">{m.email}</td>
									<td class="px-3 py-2">
										{#if m.role === 'admin'}
											<span class="badge badge-zinc">{ROLES[m.role]}</span>
										{:else}
											<select
												class="input-base input-valid"
												aria-label="Rolle"
												disabled={busy}
												value={m.role}
												onchange={(e) => changeRole(m, e.currentTarget)}
											>
												<option value="member">{ROLES.member}</option>
												<option value="subcontractor">{ROLES.subcontractor}</option>
											</select>
										{/if}
									</td>
									<td class="px-3 py-2">
										{#if m.role === 'subcontractor'}
											<div class="flex gap-2">
												<input
													class="input-base input-valid w-28"
													inputmode="decimal"
													aria-label="Kostensatz"
													bind:value={rates[m.user_id]}
												/>
												<button
													class="btn-secondary"
													disabled={busy}
													onclick={() => saveRate(m.user_id)}>Speichern</button
												>
											</div>
										{/if}
									</td>
									<td class="px-3 py-2 text-right">
										{#if m.role !== 'admin'}
											<button class="btn-danger" disabled={busy} onclick={() => remove(m)}
												>Entfernen</button
											>
										{/if}
									</td>
								</tr>
								{#if m.role === 'member' && grants[m.user_id]}
									<tr>
										<td colspan="5" class="px-3 pb-3">
											<div class="flex flex-wrap items-end gap-3">
												{#each team.AREAS as area (area)}
													<div class="flex flex-col gap-1">
														<label for={`grant-${m.user_id}-${area}`} class="label"
															>{AREA_LABELS[area]}</label
														>
														<select
															id={`grant-${m.user_id}-${area}`}
															class="input-base input-valid"
															bind:value={grants[m.user_id][area]}
														>
															<option value="">Kein Zugriff</option>
															<option value="view">Lesen</option>
															<option value="edit">Bearbeiten</option>
														</select>
													</div>
												{/each}
												<button
													class="btn-secondary"
													disabled={busy}
													onclick={() => saveGrants(m.user_id)}>Rechte speichern</button
												>
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			<section class="card space-y-4">
				<h2 class="text-base font-semibold">Einladen</h2>
				<div class="grid gap-3 sm:grid-cols-3">
					<TextInput bind:value={inviteEmail} label="E-Mail" type="email" />
					<div class="flex flex-col gap-1">
						<label for="invite-role" class="label">Rolle</label>
						<select id="invite-role" class="input-base input-valid" bind:value={inviteRole}>
							<option value="member">Mitglied</option>
							<option value="subcontractor">Subunternehmer</option>
						</select>
					</div>
					{#if inviteRole === 'subcontractor'}
						<TextInput bind:value={inviteRate} label="Kostensatz (€/h)" placeholder="z. B. 55,00" />
					{/if}
				</div>
				<button class="btn-primary" disabled={busy || !inviteEmail.trim()} onclick={sendInvite}
					>Einladung senden</button
				>
			</section>

			<section class="card space-y-4">
				<h2 class="text-base font-semibold">Projektzuweisungen</h2>
				<p class="text-sm text-zinc-500 dark:text-zinc-400">
					Subunternehmer sehen nur die Projekte, denen sie zugewiesen sind.
				</p>
				<div class="flex flex-col gap-1">
					<label for="assign-project" class="label">Projekt</label>
					<select
						id="assign-project"
						class="input-base input-valid"
						value={projectId ?? ''}
						onchange={(e) =>
							pickProject(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
					>
						<option value="">Projekt wählen…</option>
						{#each projects as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</div>
				{#if projectId != null}
					<ul class="space-y-1 text-sm">
						{#each members.filter((m) => m.role !== 'admin') as m (m.user_id)}
							<li>
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										checked={assigned.includes(m.user_id)}
										disabled={busy}
										onchange={(e) => toggleAssignment(m.user_id, e.currentTarget.checked)}
									/>
									{m.name} <span class="text-zinc-500">({ROLES[m.role]})</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="card space-y-4">
				<h2 class="text-base font-semibold">Monatsfreigabe</h2>
				<p class="text-sm text-zinc-500 dark:text-zinc-400">
					Freigegebene Zeiteinträge sind gesperrt; der Kostensatz wird festgeschrieben.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-1">
						<label for="approve-user" class="label">Mitglied</label>
						<select id="approve-user" class="input-base input-valid" bind:value={approveUser}>
							<option value={null}>Mitglied wählen…</option>
							{#each members as m (m.user_id)}
								<option value={m.user_id}>{m.name}</option>
							{/each}
						</select>
					</div>
					<TextInput bind:value={month} label="Monat" type="month" />
				</div>
				<div class="flex gap-3">
					<button class="btn-primary" disabled={busy || approveUser == null} onclick={() => approve(true)}
						>Freigeben</button
					>
					<button
						class="btn-secondary"
						disabled={busy || approveUser == null}
						onclick={() => approve(false)}>Freigabe zurücknehmen</button
					>
				</div>
			</section>
		{/if}

		<section class="card space-y-4">
			<h2 class="text-base font-semibold">Subunternehmer-Bericht</h2>
			<div class="flex items-end gap-3">
				<TextInput bind:value={month} label="Monat" type="month" />
				<button class="btn-secondary" disabled={busy || !month} onclick={loadReport}>Anzeigen</button>
			</div>
			{#if report}
				{#if report.length === 0}
					<p class="empty-state">Keine Einträge in diesem Monat.</p>
				{:else}
					<div class="table-scroll">
						<table class="w-full text-sm">
							<thead class="table-head">
								<tr>
									<th class="px-3 py-2 text-left">Subunternehmer</th>
									<th class="px-3 py-2 text-left">Projekt</th>
									<th class="px-3 py-2 text-right">Stunden</th>
									<th class="px-3 py-2 text-right">davon freigegeben</th>
									<th class="px-3 py-2 text-right">Kosten</th>
									<th class="px-3 py-2 text-right">Umsatz</th>
								</tr>
							</thead>
							<tbody>
								{#each report as r (`${r.user_id}|${r.project_id}`)}
									<tr class="data-row">
										<td class="px-3 py-2">{r.user_name}</td>
										<td class="px-3 py-2">{r.project_name ?? '–'}</td>
										<td class="px-3 py-2 text-right">{hours(r.minutes)}</td>
										<td class="px-3 py-2 text-right">{hours(r.approved_minutes)}</td>
										<td class="px-3 py-2 text-right">{formatCents(r.cost_cents)}</td>
										<td class="px-3 py-2 text-right">{formatCents(r.revenue_cents)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</section>

		<section class="card space-y-4">
			<h2 class="text-base font-semibold">Einladung annehmen</h2>
			<p class="text-sm text-zinc-500 dark:text-zinc-400">
				Füge den Einladungslink aus der E-Mail (oder nur den Code) ein.
			</p>
			<TextInput bind:value={token} label="Einladungslink oder Code" />
			<button class="btn-primary" disabled={busy || !token.trim()} onclick={accept}>Annehmen</button>
		</section>
	</div>
{/if}
