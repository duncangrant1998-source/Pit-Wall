// Microsoft 365 (Outlook mail + calendar) through Microsoft Graph.
// Sign-in uses the standard OAuth 2.0 authorization-code flow with PKCE for single-page apps.
// Microsoft limits single-page-app sign-ins to 24 hours, so Pit Wall asks for a quick re-sign-in daily.
import { save } from './store.js';

export const SCOPES = 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite';
const PEND = 'pitwall.msauth';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();

export const redirectUri = () => location.origin + location.pathname;
export const tenantFromEmail = (email) => String(email || '').split('@')[1] || 'organizations';
export const adminConsentLink = (tenant, clientId) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/adminconsent?client_id=${encodeURIComponent(clientId)}`;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomStr = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Send the browser to Microsoft's sign-in page. draft = { email, clientId, tenant, ctx }. */
export async function startSignIn(draft, acctId) {
  const verifier = randomStr(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomStr(16);
  localStorage.setItem(PEND, JSON.stringify({ verifier, state, draft, acctId: acctId || null, hash: location.hash || '#/more', at: Date.now() }));
  const q = new URLSearchParams({
    client_id: draft.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: draft.email || '',
  });
  location.assign(`https://login.microsoftonline.com/${encodeURIComponent(draft.tenant)}/oauth2/v2.0/authorize?${q}`);
}

async function tokenRequest(tenant, body) {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) { const e = new Error(d.error_description || d.error || 'Microsoft sign-in failed'); e.code = d.error; throw e; }
  const now = Date.now();
  return { access: d.access_token, exp: now + (d.expires_in || 3600) * 1000, refresh: d.refresh_token || null, rexp: now + 24 * 3600 * 1000 };
}

/** Call once on startup. Returns null, { error, consent, draft }, or { tok, draft, acctId }. */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  let pend = null;
  try { pend = JSON.parse(localStorage.getItem(PEND) || 'null'); } catch (e) { pend = null; }
  localStorage.removeItem(PEND);
  history.replaceState(null, '', location.pathname + ((pend && pend.hash) || '#/more'));
  if (!pend || q.get('state') !== pend.state) return { error: 'That sign-in expired. Please try again.' };
  if (q.has('error')) {
    const desc = q.get('error_description') || q.get('error');
    return { error: desc, consent: /AADSTS65001|AADSTS90094|AADSTS90008|consent|approval|administrator/i.test(desc), draft: pend.draft, acctId: pend.acctId };
  }
  try {
    const tok = await tokenRequest(pend.draft.tenant, {
      grant_type: 'authorization_code', client_id: pend.draft.clientId, code: q.get('code'),
      redirect_uri: redirectUri(), code_verifier: pend.verifier, scope: SCOPES,
    });
    return { tok, draft: pend.draft, acctId: pend.acctId };
  } catch (e) {
    return { error: e.message, consent: /AADSTS65001|consent/i.test(e.message), draft: pend.draft, acctId: pend.acctId };
  }
}

const refreshing = {};
function accessToken(a) {
  const t = a.tok;
  if (t && t.access && t.exp > Date.now() + 60000) return Promise.resolve(t.access);
  if (!refreshing[a.id]) refreshing[a.id] = renew(a).finally(() => { delete refreshing[a.id]; });
  return refreshing[a.id];
}
async function renew(a) {
  const t = a.tok;
  if (t && t.refresh && (!t.rexp || t.rexp > Date.now())) {
    try {
      const nt = await tokenRequest(a.tenant, { grant_type: 'refresh_token', client_id: a.clientId, refresh_token: t.refresh, scope: SCOPES });
      nt.rexp = t.rexp || nt.rexp; // single-page-app sign-ins don't extend past 24 h
      a.tok = nt; a.needsSignIn = false; save();
      return nt.access;
    } catch (e) { /* fall through */ }
  }
  a.needsSignIn = true; save();
  throw new Error('Sign-in needed');
}

async function graph(a, path, opts = {}) {
  const tok = await accessToken(a);
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + tok }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 202 || res.status === 204) return {};
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) { a.needsSignIn = true; save(); throw new Error('Sign-in needed'); }
  if (!res.ok) throw new Error((d.error && d.error.message) || 'Microsoft returned ' + res.status);
  return d;
}

const tzHeader = { Prefer: `outlook.timezone="${TZ}"` };
const localToISO = (dt) => new Date(String(dt).replace(/(\.\d{3})\d*$/, '$1')).toISOString();
const utcPlain = (isoStr) => new Date(isoStr).toISOString().slice(0, 19);
const fmtAddr = (x) => { const e = (x && x.emailAddress) || {}; return e.name && e.name !== e.address ? `"${e.name}" <${e.address}>` : (e.address || ''); };
const evJson = (ev, cal) => ({
  eid: ev.id, cal, title: ev.subject || '(No title)',
  start: localToISO(ev.start.dateTime), end: localToISO(ev.end.dateTime),
  allDay: !!ev.isAllDay, location: (ev.location && ev.location.displayName) || '',
});

/** Same actions as the Google connector, answered from Microsoft Graph. */
export async function msCall(a, action, p = {}) {
  switch (action) {
    case 'ping': {
      const me = await graph(a, '/me?$select=mail,userPrincipalName,displayName');
      const cals = await graph(a, '/me/calendars?$top=50&$select=id,name,isDefaultCalendar,canEdit');
      return { ok: true, email: me.mail || me.userPrincipalName, calendars: (cals.value || []).map((c) => ({ id: c.id, name: c.name, primary: !!c.isDefaultCalendar, owned: !!c.canEdit })) };
    }
    case 'events': {
      const out = [];
      for (const cal of String(p.cals || '').split(',').filter(Boolean)) {
        let url = `/me/calendars/${encodeURIComponent(cal)}/calendarView?startDateTime=${encodeURIComponent(p.from)}&endDateTime=${encodeURIComponent(p.to)}&$top=200&$select=id,subject,start,end,isAllDay,location`;
        for (let page = 0; url && page < 10; page++) {
          const d = await graph(a, url, { headers: tzHeader });
          (d.value || []).forEach((ev) => out.push(evJson(ev, cal)));
          url = d['@odata.nextLink'] || null;
        }
      }
      return { ok: true, events: out };
    }
    case 'createEvent': {
      const ev = await graph(a, `/me/calendars/${encodeURIComponent(p.cal)}/events`, { method: 'POST', headers: tzHeader, body: {
        subject: p.title || 'Untitled', start: { dateTime: utcPlain(p.start), timeZone: 'UTC' }, end: { dateTime: utcPlain(p.end), timeZone: 'UTC' }, location: { displayName: p.location || '' },
      } });
      return { ok: true, event: evJson(ev, p.cal) };
    }
    case 'updateEvent': {
      const body = {};
      if (p.title != null) body.subject = p.title;
      if (p.location != null) body.location = { displayName: p.location };
      if (p.start && p.end) { body.start = { dateTime: utcPlain(p.start), timeZone: 'UTC' }; body.end = { dateTime: utcPlain(p.end), timeZone: 'UTC' }; }
      await graph(a, `/me/events/${encodeURIComponent(p.eid)}`, { method: 'PATCH', body });
      return { ok: true };
    }
    case 'deleteEvent': await graph(a, `/me/events/${encodeURIComponent(p.eid)}`, { method: 'DELETE' }); return { ok: true };
    case 'inbox': {
      const d = await graph(a, `/me/mailFolders/inbox/messages?$top=${Math.min(+p.max || 30, 50)}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,webLink`);
      return { ok: true, threads: (d.value || []).map((m) => ({ id: m.id, subj: m.subject || '(No subject)', from: fmtAddr(m.from), date: m.receivedDateTime, unread: !m.isRead, count: 1, snippet: (m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 180), link: m.webLink })) };
    }
    case 'thread': {
      const m = await graph(a, `/me/messages/${encodeURIComponent(p.id)}?$select=subject,from,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
      return { ok: true, thread: { id: p.id, subj: m.subject, messages: [{ from: fmtAddr(m.from), date: m.receivedDateTime, body: ((m.body && m.body.content) || '').slice(0, 12000) }] } };
    }
    case 'markRead': await graph(a, `/me/messages/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { isRead: true } }); return { ok: true };
    case 'archive': await graph(a, `/me/messages/${encodeURIComponent(p.id)}/move`, { method: 'POST', body: { destinationId: 'archive' } }); return { ok: true };
    case 'reply': await graph(a, `/me/messages/${encodeURIComponent(p.id)}/reply`, { method: 'POST', body: { comment: String(p.body || '') } }); return { ok: true };
    case 'waiting': {
      const [sent, inbox] = await Promise.all([
        graph(a, '/me/mailFolders/sentitems/messages?$top=40&$orderby=sentDateTime desc&$select=id,conversationId,subject,toRecipients,sentDateTime,bodyPreview'),
        graph(a, '/me/mailFolders/inbox/messages?$top=100&$orderby=receivedDateTime desc&$select=conversationId,receivedDateTime'),
      ]);
      const now = Date.now(), seen = new Set(), items = [];
      for (const m of sent.value || []) {
        const t = new Date(m.sentDateTime).getTime();
        if (now - t > 14 * 864e5 || now - t < 864e5 || seen.has(m.conversationId)) continue;
        seen.add(m.conversationId);
        if (!(m.bodyPreview || '').includes('?')) continue;
        if ((inbox.value || []).some((r) => r.conversationId === m.conversationId && new Date(r.receivedDateTime).getTime() > t)) continue;
        items.push({ id: m.conversationId, to: fmtAddr((m.toRecipients || [])[0]), subj: m.subject || '(No subject)', sent: m.sentDateTime });
      }
      return { ok: true, items };
    }
    default: throw new Error('Unknown action');
  }
}
