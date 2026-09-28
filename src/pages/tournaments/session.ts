/**
 * Who is signed in, shared by every tournament page. Read once per page load
 * and refreshed after sign-in changes; the pages read it through `latestValue`
 * so a refresh never blanks them.
 */

import { createResource, createRoot } from 'solid-js';
import { fetchSession, type Session } from '../../lib/tournament/api';

const EMPTY: Session = { user: null, providers: [] };

const [session, { refetch, mutate }] = createRoot(() =>
  createResource<Session>(() => fetchSession().catch(() => EMPTY))
);

export { mutate as setSession, refetch as refreshSession, session };
