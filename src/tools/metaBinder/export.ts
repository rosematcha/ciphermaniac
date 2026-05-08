import { AppError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import type { BinderDataset } from '../metaBinderData.js';
import {
  type BinderCard,
  type BinderMetrics,
  type CardRenderOptions,
  getCardIncludeRatio,
  getEffectiveCopies,
  state
} from './state.js';
import { renderArchetypeControls, renderBinderSections, renderTournamentsControls, updateStats } from './ui.js';
import { recomputeFromSelection, saveSelections } from './analysis.js';

export function handleExportLayout(): void {
  logger.info('Export layout clicked', { hasBinderData: Boolean(state.binderData) });

  if (!state.binderData) {
    const message = 'Please generate a binder layout first before exporting.';
    alert(message); // eslint-disable-line no-alert
    logger.warn(message);
    return;
  }

  try {
    const exportData = {
      version: 1,
      timestamp: new Date().toISOString(),
      tournaments: Array.from(state.selectedTournaments),
      archetypes: Array.from(state.selectedArchetypes).filter(arch => arch !== '__NONE__'),
      binderData: state.binderData,
      metrics: state.metrics
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `meta-binder-${new Date().toISOString().slice(0, 10)}.json`;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    logger.info('Exported binder layout', {
      filename,
      tournaments: exportData.tournaments.length,
      archetypes: exportData.archetypes.length,
      size: json.length
    });
  } catch (error) {
    logger.error('Failed to export binder layout', error);
    alert('Failed to export layout. Check the console for details.'); // eslint-disable-line no-alert
  }
}

export function handleExportPtcgLive(): void {
  if (!state.binderData) {
    alert('Please generate a binder layout first before exporting.'); // eslint-disable-line no-alert
    return;
  }

  try {
    const { sections } = state.binderData;

    type Entry = { card: BinderCard; copies: number };

    const addCards = (
      dest: Entry[],
      cards: BinderCard[],
      seen: Set<string>,
      exportOptions: CardRenderOptions = {}
    ): void => {
      for (const card of cards) {
        if (state.includeThreshold > 0 && getCardIncludeRatio(card, exportOptions) < state.includeThreshold) {
          continue;
        }
        const key = card.set && card.number ? `${card.set}::${card.number}` : card.name;
        if (!seen.has(key)) {
          seen.add(key);
          dest.push({ card, copies: getEffectiveCopies(card) });
        }
      }
    };

    const seen = new Set<string>();
    const pokemon: Entry[] = [];
    const trainers: Entry[] = [];
    const energies: Entry[] = [];

    addCards(pokemon, sections.staplePokemon, seen);
    for (const group of sections.archetypePokemon) {
      addCards(pokemon, group.cards, seen, { mode: 'archetype', archetype: group.canonical });
    }
    addCards(trainers, sections.aceSpecs, seen);
    addCards(trainers, sections.frequentSupporters, seen);
    addCards(trainers, sections.nicheSupporters, seen);
    addCards(trainers, sections.stadiums, seen);
    addCards(trainers, sections.tools, seen);
    addCards(trainers, sections.frequentItems, seen);
    addCards(trainers, sections.nicheItems, seen);
    addCards(energies, sections.specialEnergy, seen);
    addCards(energies, sections.basicEnergy, seen);

    const formatLine = ({ card, copies }: Entry): string => {
      const set = card.set ? String(card.set).toUpperCase() : '';
      const num = card.number ? String(card.number) : '';
      return set && num ? `${copies} ${card.name} ${set} ${num}` : `${copies} ${card.name}`;
    };

    const lines: string[] = [];

    if (pokemon.length > 0) {
      lines.push(`Pokémon: ${pokemon.length}`);
      pokemon.forEach(en => lines.push(formatLine(en)));
      lines.push('');
    }
    if (trainers.length > 0) {
      lines.push(`Trainer: ${trainers.length}`);
      trainers.forEach(en => lines.push(formatLine(en)));
      lines.push('');
    }
    if (energies.length > 0) {
      lines.push(`Energy: ${energies.length}`);
      energies.forEach(en => lines.push(formatLine(en)));
      lines.push('');
    }

    const totalCards = [...pokemon, ...trainers, ...energies].reduce((sum, en) => sum + en.copies, 0);
    lines.push(`Total Cards: ${totalCards}`);

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meta-binder-ptcg-live-${new Date().toISOString().slice(0, 10)}.txt`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    logger.info('Exported PTCG Live list', {
      pokemon: pokemon.length,
      trainers: trainers.length,
      energies: energies.length,
      totalCards
    });
  } catch (error) {
    logger.error('Failed to export PTCG Live list', error);
    alert('Failed to export list. Check the console for details.'); // eslint-disable-line no-alert
  }
}

export async function handleImportLayout(
  event: Event,
  onTournamentToggle: (tournament: string, checked: boolean) => void,
  onArchetypeToggle: (archetype: string, checked: boolean) => void
): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  if (!input) {
    return;
  }
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const importData = JSON.parse(text) as {
      version?: number;
      tournaments?: string[];
      archetypes?: string[];
      binderData?: BinderDataset;
      metrics?: BinderMetrics | null;
    };

    if (!importData.version || !importData.binderData) {
      throw new AppError(ErrorTypes.DATA_FORMAT, 'Invalid binder export file format');
    }

    const validTournaments = (importData.tournaments || []).filter(tournament =>
      state.tournaments.includes(tournament)
    );
    if (validTournaments.length === 0) {
      // eslint-disable-next-line no-alert
      alert(
        'None of the tournaments in this export are currently available. Please ensure the same tournaments are loaded.'
      );
      return;
    }

    state.selectedTournaments = new Set(validTournaments);
    state.selectedArchetypes = new Set(importData.archetypes || []);
    state.binderData = importData.binderData;
    state.metrics = importData.metrics || null;
    state.isBinderDirty = false;

    await recomputeFromSelection();

    renderTournamentsControls(onTournamentToggle);
    renderArchetypeControls(onArchetypeToggle);
    renderBinderSections();
    updateStats();
    saveSelections();

    logger.info('Imported binder layout', {
      tournaments: validTournaments.length,
      archetypes: importData.archetypes?.length || 0
    });

    alert('Binder layout imported successfully!'); // eslint-disable-line no-alert
  } catch (error) {
    logger.error('Failed to import binder layout', error);
    alert('Failed to import binder layout. Please ensure the file is valid.'); // eslint-disable-line no-alert
  } finally {
    input.value = '';
  }
}
