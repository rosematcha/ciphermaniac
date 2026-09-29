/**
 * The organizer console's copy of the event, and the one way it changes: an
 * action is sent, and the server's answer replaces the copy. Nothing is
 * applied optimistically, because the server may pair differently or refuse,
 * and a console that shows what did not happen is worse than a short wait.
 */

import { createSignal } from 'solid-js';
import type { Command } from '../../../shared/tournament/commands';
import { ApiError, fetchManage, type Manage, sendCommand } from '../../lib/tournament/api';

export interface ManageState {
  data: () => Manage | null;
  loadError: () => ApiError | null;
  error: () => string | null;
  busy: () => boolean;
  load: () => Promise<void>;
  /** Runs a request that answers with the event, and takes its answer. */
  run: (request: () => Promise<Manage>) => Promise<boolean>;
  send: (command: Command) => Promise<boolean>;
  clearError: () => void;
}

export function createManage(code: () => string): ManageState {
  const [data, setData] = createSignal<Manage | null>(null);
  const [loadError, setLoadError] = createSignal<ApiError | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  /**
   * Takes a copy unless it is older than the one shown. A refresh can land
   * after a command sent later, and would otherwise hide a result just saved.
   */
  function take(next: Manage) {
    const shown = data();
    if (!shown || shown.code !== next.code || next.version >= shown.version) {
      setData(next);
    }
  }

  async function load() {
    try {
      const shown = data();
      const next = await fetchManage(code(), shown?.code === code() ? shown.version : undefined);
      if (next) {
        take(next);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    }
  }

  async function run(request: () => Promise<Manage>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      take(await request());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    data,
    loadError,
    error,
    busy,
    load,
    run,
    send: command => run(() => sendCommand(code(), command)),
    clearError: () => setError(null)
  };
}
