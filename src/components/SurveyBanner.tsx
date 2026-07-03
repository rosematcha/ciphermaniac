import { A, useLocation } from '@solidjs/router';
import { createEffect, createSignal, Show } from 'solid-js';

import { isSurveyClosed } from '../lib/survey';

const DISMISS_KEY = 'cm:survey-banner-dismissed';

/**
 * Site-wide strip inviting people to take the survey. Shows for the whole run
 * of the survey until the user dismisses it (X) or visits the survey page —
 * either of which hides it permanently (persisted in localStorage). Hidden once
 * the survey has closed.
 */
export function SurveyBanner() {
  const location = useLocation();
  const stored = typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1';
  const [dismissed, setDismissed] = createSignal(stored);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* localStorage may be unavailable */
    }
  };

  // Visiting the survey (or its results) permanently dismisses the banner.
  createEffect(() => {
    if (location.pathname.startsWith('/survey')) {
      dismiss();
    }
  });

  const visible = () => !isSurveyClosed() && !dismissed() && !location.pathname.startsWith('/survey');

  return (
    <Show when={visible()}>
      <div class='survey-banner'>
        <A href='/survey' class='survey-banner-link'>
          Please take the Ciphermaniac user survey!
        </A>
        <button type='button' class='survey-banner-close' aria-label='Dismiss' onClick={dismiss}>
          ×
        </button>
      </div>
    </Show>
  );
}
