// Talks to the user's own Pit Wall connector (an Apps Script web app in their Google account).
import { S } from './store.js';
import { today, addDays, fromISO } from './util.js';

const GKEY = 'pitwall.google.v1';
export const G = { events: {}, threads: {}, bodies: {}, waiting: {}, sync: {} };

export function loadG() {
  try { Object.assign(G, JSON.parse(localStorage.getItem(GKEY)) || {}); } catch (e) { /* ignore */ }
}
export function saveG() {
  try { localStorage.setItem(GKEY, JSON.stringify(G)); } catch (e) {
    // Storage full: drop cached email bodies first, then try again.
    G.bodies = {};
    try { localStorage.setItem(GKEY, JSON.stringify(G)); } catch (e2) { /* give up quietly */ }
  }
}
export function forgetAccount(id) {
  for (const k of ['events', 'threads', 'waiting', 'sync']) delete G[k][id];
  for (const k of Object.keys(G.bodies)) if (k.startsWith(id + ':')) delete G.bodies[k];
  saveG();
}

/** Split a pasted connection link into URL + key (accepts "…/exec?key=XYZ" or a bare URL). */
export function parseLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const key = u.searchParams.get('key') || u.searchParams.get('k') || '';
    u.search = '';
    return { url: u.toString(), key };
  } catch (e) { return null; }
}

export async function call(acct, action, params = {}, post = false) {
  const p = Object.assign({ key: acct.key, action }, params);
  let res;
  if (post) {
    res = await fetch(acct.url, { method: 'POST', body: JSON.stringify(p), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  } else {
    res = await fetch(acct.url + (acct.url.includes('?') ? '&' : '?') + new URLSearchParams(p).toString(), { redirect: 'follow' });
  }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('The connector didn’t answer. Check the web app URL and that access is set to “Anyone”.'); }
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function syncAccount(a) {
  const from = fromISO(addDays(today(), -7)).toISOString();
  const to = fromISO(addDays(today(), 60)).toISOString();
  const cals = Object.keys(a.cals || {}).filter((id) => a.cals[id].show !== false).join(',');
  try {
    const [ev, ib, wt] = await Promise.all([
      cals ? call(a, 'events', { from, to, cals }) : Promise.resolve({ events: [] }),
      a.mail === false ? Promise.resolve({ threads: [] }) : call(a, 'inbox', { max: 30 }),
      a.mail === false ? Promise.resolve({ items: [] }) : call(a, 'waiting').catch(() => ({ items: [] })),
    ]);
    G.events[a.id] = ev.events;
    G.threads[a.id] = ib.threads;
    G.waiting[a.id] = wt.items;
    G.sync[a.id] = { at: Date.now(), error: null };
  } catch (e) {
    G.sync[a.id] = Object.assign({}, G.sync[a.id], { error: e.message || String(e), failedAt: Date.now() });
  }
  saveG();
}

let running = null;
export function syncAll() {
  if (running) return running;
  const accts = (S.accounts || []).slice();
  running = Promise.all(accts.map(syncAccount)).finally(() => { running = null; });
  return running;
}
export const isSyncing = () => !!running;
export function lastSync() {
  const times = (S.accounts || []).map((a) => (G.sync[a.id] && G.sync[a.id].at) || 0);
  return times.length ? Math.min(...times) : 0;
}
export function syncErrors() {
  return (S.accounts || []).filter((a) => G.sync[a.id] && G.sync[a.id].error).map((a) => ({ acct: a, error: G.sync[a.id].error }));
}
