/**
 * The store's people, for its Managers. A store always keeps its Owner:
 * removing or demoting the Owner is refused (409); the Owner hands the store
 * over instead, and may leave once someone else owns it.
 * GET — everyone in the store, and the invite links still open.
 * POST { invite: 'manager' | 'staff' } — a new link that lets one person in
 * as that, for a week; answers its token, which is shown only now.
 * PATCH { user, role } — makes someone in the store a Manager or Staff; role
 * 'owner', the Owner's alone to send, hands them the store, the Owner
 * becoming a Manager.
 * DELETE ?user= — takes someone out (anyone in the store may take themselves
 * out); ?invite= withdraws a link.
 */

import { GIVEN_ROLES, type GivenRole, managesStore } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore, type StoreAccess } from '../../../lib/stores/access.js';
import {
  createInvite,
  handOver,
  listInvites,
  listMembers,
  removeMember,
  setMemberRole,
  withdrawInvite
} from '../../../lib/stores/db.js';
import { privateJson } from '../../../lib/tournaments/access.js';

const OWNER_STAYS = 'The owner stays until they hand the store to someone else';

const roleOf = (value: unknown): GivenRole | null => GIVEN_ROLES.find(role => role === value) ?? null;

async function people(access: StoreAccess): Promise<Response> {
  const [members, invites] = await Promise.all([
    listMembers(access.db, access.store.id),
    listInvites(access.db, access.store.id)
  ]);
  return privateJson({ members, invites });
}

export async function onRequestGet(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  return access instanceof Response ? access : people(access);
}

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const role = roleOf((await readJsonObject(context.request, 256))?.invite);
  if (!role) {
    return jsonError('Invite a manager or staff', 400);
  }
  const token = await createInvite(access.db, access.store.id, role, { guard: access.guard('manager') });
  return token ? privateJson({ token }, 201) : jsonError('Only this store’s managers can do that', 403);
}

/** Who the PATCH names and what it makes them: a role a Manager gives, or 'owner'; null when it says neither. */
function readChange(body: Record<string, unknown> | null): { user: string; role: GivenRole | 'owner' } | null {
  const role = body?.role === 'owner' ? 'owner' : roleOf(body?.role);
  const user = typeof body?.user === 'string' ? body.user : '';
  return role && user ? { user, role } : null;
}

/** Makes the change, the Owner's hand-over or a Manager's role change, each guarded in its own write. */
function applyChange(access: StoreAccess, change: { user: string; role: GivenRole | 'owner' }): Promise<boolean> {
  const { db, store } = access;
  return change.role === 'owner'
    ? handOver(db, store.id, change.user, access.guard('owner'))
    : setMemberRole(db, store.id, { userId: change.user, role: change.role }, access.guard('manager'));
}

export async function onRequestPatch(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const change = readChange(await readJsonObject(context.request, 512));
  if (!change) {
    return jsonError('Say who, and as what', 400);
  }
  const handing = change.role === 'owner';
  if (handing && access.role !== 'owner') {
    return jsonError('Only this store’s owner can hand it over', 403);
  }
  const members = await listMembers(access.db, access.store.id);
  if (!members.some(member => member.id === change.user)) {
    return jsonError('No one by that ID is in this store', 404);
  }
  return (await applyChange(access, change))
    ? people(access)
    : jsonError(handing ? 'The store was not handed over' : OWNER_STAYS, 409);
}

export async function onRequestDelete(context: Context<'id'>): Promise<Response> {
  const query = new URL(context.request.url).searchParams;
  const user = query.get('user') ?? '';
  const invite = query.get('invite') ?? '';
  const access = await openStore(context, 'member');
  if (access instanceof Response) {
    return access;
  }
  // Anyone in the store may take themselves out; nothing else here is theirs to do.
  const leaving = user !== '' && user === access.user?.id && invite === '';
  if (!managesStore(access.role) && !leaving) {
    return jsonError('Only this store’s managers can do that', 403);
  }
  if (invite) {
    const removed = await withdrawInvite(access.db, access.store.id, invite, access.guard('manager'));
    return removed ? noContent() : jsonError('No open invite or manager access', 409);
  }
  if (!user) {
    return jsonError('Say who to remove', 400);
  }
  return removePerson(access, user, leaving);
}

async function removePerson(access: StoreAccess, user: string, leaving: boolean): Promise<Response> {
  const removed = await removeMember(access.db, access.store.id, user, access.guard(leaving ? 'member' : 'manager'));
  return removed ? noContent() : jsonError(OWNER_STAYS, 409);
}
