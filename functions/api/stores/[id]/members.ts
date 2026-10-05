/**
 * The store's people, for its Managers. A store always keeps one Manager:
 * removing or demoting the last one is refused (409).
 * GET — everyone in the store, and the invite links still open.
 * POST { invite: 'manager' | 'staff' } — a new link that lets one person in
 * as that, for a week; answers its token, which is shown only now.
 * PATCH { user, role } — makes someone in the store a Manager or Staff.
 * DELETE ?user= — takes someone out (anyone in the store may take themselves
 * out); ?invite= withdraws a link.
 */

import { STORE_ROLES, type StoreRole } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore, type StoreAccess } from '../../../lib/stores/access.js';
import {
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  setMemberRole,
  withdrawInvite
} from '../../../lib/stores/db.js';
import { privateJson } from '../../../lib/tournaments/access.js';

const LAST_MANAGER = 'A store needs a manager; make someone else one first';

const roleOf = (value: unknown): StoreRole | null => STORE_ROLES.find(role => role === value) ?? null;

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

export async function onRequestPatch(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonObject(context.request, 512);
  const role = roleOf(body?.role);
  const user = typeof body?.user === 'string' ? body.user : '';
  if (!role || !user) {
    return jsonError('Say who, and as what', 400);
  }
  const members = await listMembers(access.db, access.store.id);
  if (!members.some(member => member.id === user)) {
    return jsonError('No one by that ID is in this store', 404);
  }
  return (await setMemberRole(access.db, access.store.id, { userId: user, role }, access.guard('manager')))
    ? people(access)
    : jsonError(LAST_MANAGER, 409);
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
  if (access.role !== 'manager' && !leaving) {
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
  return removed ? noContent() : jsonError(LAST_MANAGER, 409);
}
