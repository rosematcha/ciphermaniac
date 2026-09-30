/**
 * The organizer console's copy of the event, and the one way it changes: an
 * action is sent, and the server's answer replaces the copy. Nothing is
 * applied optimistically, because the server may pair differently or refuse,
 * and a console that shows what did not happen is worse than a short wait.
 * A result on its way is drawn in its row as sent, not as entered (see
 * RoundPanel), and goes back to open if the server refuses it.
 */

import { createSignal } from 'solid-js';
import type { Command } from '../../../shared/tournament/commands';
import { ApiError, errorText, fetchManage, type Manage, sendCommand } from '../../lib/tournament/api';
import { announceChange } from '../../lib/tournament/changes';
import { shared } from '../../lib/tournament/share';

export interface ManageState {
  data: () => Manage | null;
  loadError: () => ApiError | null;
  error: () => string | null;
  busy: () => boolean;
  /** Reads the event again; whether the read went through. */
  load: () => Promise<boolean>;
  /** Runs a request that answers with the event, and takes its answer. */
  run: (request: () => Promise<Manage>) => Promise<boolean>;
  /** Waits on a request that changes something beside the event, and shows why if it fails; whether it went through. */
  act: (request: Promise<unknown>) => Promise<boolean>;
  send: (command: Command) => Promise<boolean>;
  clearError: () => void;
}

export function createManage(code: () => string): ManageState {
  const [data, setData] = createSignal<Manage | null>(null);
  const [loadError, setLoadError] = createSignal<ApiError | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // A count, since results go out one after another without waiting: busy until the last one answers.
  const [sending, setSending] = createSignal(0);
  const busy = () => sending() > 0;

  /**
   * Takes a copy unless it is older than the one shown. A refresh can land
   * after a command sent later, and would otherwise hide a result just saved.
   * What the copy leaves as it was stays the same objects (see share.ts), so
   * only the rows that changed are drawn again.
   */
  function take(next: Manage) {
    const shown = data();
    if (!shown || shown.code !== next.code || next.version >= shown.version) {
      setData(shared(shown, next));
    }
    if (shown?.code === next.code && next.version > shown.version) {
      // A big screen open in another tab looks again now rather than at its next poll.
      announceChange(next.code, next.version);
    }
  }

  async function load(): Promise<boolean> {
    try {
      const shown = data();
      const next = await fetchManage(code(), shown?.code === code() ? shown.version : undefined);
      if (next) {
        take(next);
      }
      setLoadError(null);
      return true;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err : new ApiError(String(err), 0));
      return false;
    }
  }

  async function act(request: Promise<unknown>): Promise<boolean> {
    setSending(count => count + 1);
    setError(null);
    try {
      await request;
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setSending(count => count - 1);
    }
  }

  return {
    data,
    loadError,
    error,
    busy,
    load,
    // Started inside a promise, so a request that throws before it sends still shows why.
    run: request => act(Promise.resolve().then(request).then(take)),
    act,
    send: command => act(sendCommand(code(), command).then(take)),
    clearError: () => setError(null)
  };
}
