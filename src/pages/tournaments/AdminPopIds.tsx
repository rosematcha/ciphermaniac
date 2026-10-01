/**
 * The admin page's POP IDs tab, where a dispute from the feedback form is
 * settled: look an account up by POP ID, email or account ID, then move its
 * POP ID to another account (named by its ID) or clear it, each asked first.
 * History follows the POP ID. The lookup is read again after a change, so
 * the rows show where the POP ID now is.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import type { FoundAccount } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText } from '../../lib/tournament/api';
import { findAccounts, movePopId, ROLE_WORDS } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';

/** Move to account: the account ID it goes to, then the move, asked first. */
function MoveForm(props: { account: FoundAccount & { popId: string }; onMoved: () => void; onCancel: () => void }) {
  const [target, setTarget] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  async function move() {
    setError(null);
    try {
      await movePopId(props.account.popId, target().trim());
      props.onMoved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const id = () => `move-${props.account.id}`;
  return (
    <div class='tm-move'>
      <div class='tm-move-head'>
        <label class='tm-label' for={id()}>
          Account ID
        </label>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onCancel()}>
          Cancel
        </button>
      </div>
      <div class='tm-move-row'>
        <input
          id={id()}
          class='tm-input tm-mono'
          value={target()}
          onInput={event => setTarget(event.currentTarget.value)}
        />
        <ConfirmAction
          class='btn btn-secondary'
          label='Move'
          question={`Move ${props.account.popId} to ${target().trim()}?`}
          disabled={target().trim() === '' || target().trim() === props.account.id}
          onConfirm={() => void move()}
        />
      </div>
      <ErrorLine message={error()} />
    </div>
  );
}

/**
 * One account found: who it is, its POP ID, and the moves on it. A change
 * names what to look up next: the POP ID after a move, so its new holder
 * shows; the account after a clear, so it stays in sight.
 */
function FoundRow(props: { account: FoundAccount; onChanged: (lookup: string) => void }) {
  const a = () => props.account;
  const [moving, setMoving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function clear(popId: string) {
    setError(null);
    try {
      await movePopId(popId, null);
      props.onChanged(a().id);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <article class='tm-found'>
      <div class='tm-found-who'>
        <h3>
          {a().name}
          <Show when={a().role}>{role => <span class='tm-flag'>{ROLE_WORDS[role()]}</span>}</Show>
        </h3>
        <dl class='tm-app-facts'>
          <div>
            <dt>POP ID</dt>
            <dd class='tm-num'>{a().popId ?? 'None'}</dd>
          </div>
          <Show when={a().email}>
            {email => (
              <div>
                <dt>Email</dt>
                <dd>{email()}</dd>
              </div>
            )}
          </Show>
          <div>
            <dt>Account ID</dt>
            <dd class='tm-mono tm-select-all'>{a().id}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{dayOf(a().createdAt)}</dd>
          </div>
        </dl>
      </div>
      <Show when={a().popId}>
        {popId => (
          <div class='tm-found-acts'>
            <Show
              when={moving()}
              fallback={
                <span class='tm-row-actions'>
                  <button type='button' class='btn btn-secondary' onClick={() => setMoving(true)}>
                    Move to account…
                  </button>
                  <ConfirmAction
                    class='btn btn-ghost'
                    label='Clear'
                    question={`Clear ${popId()}?`}
                    danger
                    onConfirm={() => void clear(popId())}
                  />
                </span>
              }
            >
              <MoveForm
                account={{ ...a(), popId: popId() }}
                onMoved={() => {
                  setMoving(false);
                  props.onChanged(popId());
                }}
                onCancel={() => setMoving(false)}
              />
            </Show>
            <ErrorLine message={error()} />
          </div>
        )}
      </Show>
    </article>
  );
}

export function AdminPopIds() {
  const [text, setText] = createSignal('');
  const [asked, setAsked] = createSignal<string | null>(null);
  const [found, { refetch }] = createResource(asked, value => findAccounts(value).then(answer => answer.accounts));
  // Read again after a change, the rows stay up until the new ones come.
  const shown = () => latestValue(found);
  /** Looks `value` up, again when it is what was last looked up. */
  const lookUp = (value: string) => {
    setText(value);
    if (asked() === value) {
      void refetch();
    } else {
      setAsked(value);
    }
  };
  return (
    <section class='tm-box tm-pop-ids'>
      <form
        class='tm-box-bar tm-lookup'
        onSubmit={event => {
          event.preventDefault();
          if (text().trim()) {
            lookUp(text().trim());
          }
        }}
      >
        <label class='tm-label' for='lookup'>
          POP ID, email or account ID
        </label>
        <div class='tm-lookup-row'>
          <input id='lookup' class='tm-input' value={text()} onInput={event => setText(event.currentTarget.value)} />
          <button type='submit' class='btn btn-secondary' disabled={!text().trim()}>
            Look up
          </button>
        </div>
      </form>
      <Show when={asked()}>
        <Show
          when={shown()}
          fallback={
            <Show when={found.error} fallback={<Skeleton height='96px' />}>
              <div class='tm-box-bar'>
                <ErrorLine message={errorText(found.error)} />
              </div>
            </Show>
          }
        >
          {accounts => (
            <Show when={accounts().length > 0} fallback={<p class='tm-empty muted'>No account found</p>}>
              <For each={accounts()}>{account => <FoundRow account={account} onChanged={lookUp} />}</For>
            </Show>
          )}
        </Show>
      </Show>
    </section>
  );
}
