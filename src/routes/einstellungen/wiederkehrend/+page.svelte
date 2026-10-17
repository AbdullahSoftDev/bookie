<script lang="ts">
	import { onMount } from 'svelte';
	import TextInput from '../../../common/TextInput.svelte';
	import { deleteRecurring, listRecurring, updateRecurring } from '$lib/db/recurring';
	import type { RecurringEntry } from '$lib/db/types';
	import { messageForUnknown } from '$lib/shared/errors';

	// Schedules are created from an invoice / incoming invoice ("monatlich");
	// here they are listed, edited, paused and deleted.
	const KINDS: Record<RecurringEntry['kind'], string> = { invoice: 'Rechnung (Entwurf)', incoming: 'Eingangsrechnung' };
	const FREQUENCIES: Record<RecurringEntry['frequency'], string> = {
		weekly: 'Wöchentlich',
		monthly: 'Monatlich',
		quarterly: 'Quartalsweise',
		yearly: 'Jährlich'
	};
	const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '–');

	let entries = $state<RecurringEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');

	async function load() {
		try {
			entries = await listRecurring();
		} catch (e) {
			error = messageForUnknown(e);
		}
		loading = false;
	}
	onMount(load);

	async function run(f: () => Promise<void>, done: string) {
		error = notice = '';
		try {
			await f();
			notice = done;
			await load();
		} catch (e) {
			error = messageForUnknown(e);
		}
	}

	function save(r: RecurringEntry) {
		if (!r.next_run_date || !Number.isInteger(Number(r.interval_count)) || Number(r.interval_count) < 1) {
			error = 'Nächster Termin und ein Intervall ab 1 sind Pflicht.';
			return;
		}
		if (r.end_date && r.end_date < r.next_run_date) {
			error = 'Das Enddatum liegt vor dem nächsten Termin.';
			return;
		}
		return run(
			() =>
				updateRecurring(r.id, {
					label: r.label,
					frequency: r.frequency,
					interval_count: Number(r.interval_count),
					next_run_date: r.next_run_date,
					end_date: r.end_date || null,
					active: r.active ? 1 : 0
				}),
			'Gespeichert.'
		);
	}

	function remove(r: RecurringEntry) {
		if (!confirm(`„${r.label || KINDS[r.kind]}" löschen? Bereits erzeugte Einträge bleiben erhalten.`)) return;
		return run(() => deleteRecurring(r.id), 'Gelöscht.');
	}
</script>

<section class="card space-y-4">
	<div>
		<h2 class="text-base font-semibold">Wiederkehrende Einträge</h2>
		<p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
			Angelegt über „monatlich" an einer Rechnung oder Eingangsrechnung. Rechnungen entstehen als Entwurf.
		</p>
	</div>

	{#if loading}
		<p class="text-sm text-zinc-500 dark:text-zinc-400">Lade …</p>
	{:else if entries.length === 0 && !error}
		<p class="text-sm text-zinc-500 dark:text-zinc-400">Keine wiederkehrenden Einträge.</p>
	{:else}
		<div class="space-y-3">
			{#each entries as r (r.id)}
				<div class="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
					<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
						<span class="font-medium text-zinc-700 dark:text-zinc-200">{KINDS[r.kind]}</span>
						<span>Zuletzt erzeugt: {day(r.last_run_date)}</span>
					</div>
					<div class="grid gap-3 md:grid-cols-[1fr_160px_100px_160px_160px]">
						<TextInput bind:value={r.label} label="Bezeichnung" />
						<div class="mt-1 flex flex-col gap-1">
							<label for="freq-{r.id}" class="label">Rhythmus</label>
							<select id="freq-{r.id}" bind:value={r.frequency} class="input-base">
								{#each Object.entries(FREQUENCIES) as [value, label]}
									<option {value}>{label}</option>
								{/each}
							</select>
						</div>
						<div class="mt-1 flex flex-col gap-1">
							<label for="interval-{r.id}" class="label">Alle</label>
							<input id="interval-{r.id}" type="number" min="1" step="1" bind:value={r.interval_count} class="input-base" />
						</div>
						<div class="mt-1 flex flex-col gap-1">
							<label for="next-{r.id}" class="label">Nächster Termin</label>
							<input id="next-{r.id}" type="date" bind:value={r.next_run_date} class="input-base" />
						</div>
						<div class="mt-1 flex flex-col gap-1">
							<label for="end-{r.id}" class="label">Enddatum (optional)</label>
							<input id="end-{r.id}" type="date" bind:value={r.end_date} class="input-base" />
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-3">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={!!r.active} onchange={(e) => (r.active = e.currentTarget.checked ? 1 : 0)} />
							Aktiv
						</label>
						<button type="button" onclick={() => save(r)} class="btn-primary">Speichern</button>
						<button type="button" onclick={() => remove(r)} class="btn-secondary">Löschen</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	{#if error}<p class="text-xs text-red-600">{error}</p>{/if}
	{#if notice}<p class="text-xs text-emerald-600">{notice}</p>{/if}
</section>
