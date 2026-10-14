/**
 * Pit Wall connector — runs inside YOUR Google account as an Apps Script web app.
 * Your phone talks to this script directly; nothing passes through anyone else's server.
 *
 * Setup (about 5 minutes, easiest on a computer):
 *  1. Go to https://script.google.com and click "New project".
 *  2. Delete everything in the editor and paste this whole file in. Name the project "Pit Wall connector".
 *  3. Replace the KEY below with your own long random secret (or use the one you were given).
 *  4. Click Deploy → New deployment → gear icon → "Web app".
 *       Description: Pit Wall · Execute as: Me · Who has access: Anyone
 *  5. Click Deploy, then Authorize access. Google will warn the app isn't verified —
 *     it's your own script, so choose Advanced → "Go to Pit Wall connector (unsafe)" → Allow.
 *  6. Copy the Web app URL (ends in /exec). In Pit Wall: More → Google accounts → Connect,
 *     paste the URL and the KEY.
 *
 * "Anyone" access is required so your phone can reach the script without a Google sign-in
 * screen; every request must carry the KEY, so keep the URL and KEY private.
 */
const KEY = 'REPLACE-WITH-YOUR-SECRET-KEY';

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { p = {}; }
  return handle_(p);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  if (!p || !KEY || KEY.indexOf('REPLACE') === 0 || p.key !== KEY) return out_({ ok: false, error: 'Wrong or missing key' });
  try {
    switch (p.action) {
      case 'ping': return out_({ ok: true, email: Session.getEffectiveUser().getEmail(), calendars: calendars_() });
      case 'events': return out_({ ok: true, events: events_(p.from, p.to, p.cals) });
      case 'createEvent': return out_({ ok: true, event: createEvent_(p) });
      case 'updateEvent': return out_({ ok: true, event: updateEvent_(p) });
      case 'deleteEvent': deleteEvent_(p); return out_({ ok: true });
      case 'inbox': return out_({ ok: true, threads: inbox_(Number(p.max) || 25) });
      case 'thread': return out_({ ok: true, thread: thread_(p.id) });
      case 'markRead': GmailApp.getThreadById(p.id).markRead(); return out_({ ok: true });
      case 'archive': GmailApp.getThreadById(p.id).moveToArchive(); return out_({ ok: true });
      case 'reply': GmailApp.getThreadById(p.id).reply(String(p.body || '')); return out_({ ok: true });
      case 'waiting': return out_({ ok: true, items: waiting_() });
      default: return out_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- calendar ---------- */
function calendars_() {
  return CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName(), color: c.getColor(), primary: c.isMyPrimaryCalendar(), owned: c.isOwnedByMe() };
  });
}

function eventJson_(ev, cal) {
  return {
    eid: ev.getId(),
    cal: cal.getId(),
    title: ev.getTitle() || '(No title)',
    start: ev.getStartTime().toISOString(),
    end: ev.getEndTime().toISOString(),
    allDay: ev.isAllDayEvent(),
    location: ev.getLocation() || '',
    recurring: ev.isRecurringEvent(),
  };
}

function events_(from, to, cals) {
  const start = new Date(from), end = new Date(to);
  const ids = cals ? String(cals).split(',').filter(String) : null;
  const list = ids && ids.length ? ids.map(function (id) { return CalendarApp.getCalendarById(id); }).filter(Boolean) : CalendarApp.getAllCalendars();
  const outList = [];
  list.forEach(function (cal) {
    cal.getEvents(start, end).forEach(function (ev) { outList.push(eventJson_(ev, cal)); });
  });
  return outList;
}

function findEvent_(p) {
  const cal = CalendarApp.getCalendarById(p.cal);
  if (!cal) throw new Error('Calendar not found');
  const at = new Date(p.origStart);
  const evs = cal.getEvents(new Date(at.getTime() - 60000), new Date(at.getTime() + 60000));
  for (var i = 0; i < evs.length; i++) if (evs[i].getId() === p.eid) return { ev: evs[i], cal: cal };
  const one = cal.getEventById(p.eid);
  if (one) return { ev: one, cal: cal };
  throw new Error('Event not found');
}

function createEvent_(p) {
  const cal = p.cal ? CalendarApp.getCalendarById(p.cal) : CalendarApp.getDefaultCalendar();
  const ev = cal.createEvent(String(p.title || 'Untitled'), new Date(p.start), new Date(p.end), { location: String(p.location || '') });
  return eventJson_(ev, cal);
}

function updateEvent_(p) {
  const f = findEvent_(p);
  if (p.title != null) f.ev.setTitle(String(p.title));
  if (p.start && p.end) f.ev.setTime(new Date(p.start), new Date(p.end));
  if (p.location != null) f.ev.setLocation(String(p.location));
  return eventJson_(f.ev, f.cal);
}

function deleteEvent_(p) { findEvent_(p).ev.deleteEvent(); }

/* ---------- gmail ---------- */
function inbox_(max) {
  return GmailApp.getInboxThreads(0, Math.min(max, 50)).map(function (t) {
    const msgs = t.getMessages();
    const last = msgs[msgs.length - 1];
    return {
      id: t.getId(),
      subj: t.getFirstMessageSubject() || '(No subject)',
      from: last.getFrom(),
      date: last.getDate().toISOString(),
      unread: t.isUnread(),
      count: msgs.length,
      snippet: last.getPlainBody().replace(/\s+/g, ' ').slice(0, 180),
    };
  });
}

function thread_(id) {
  const t = GmailApp.getThreadById(id);
  return {
    id: t.getId(),
    subj: t.getFirstMessageSubject() || '(No subject)',
    messages: t.getMessages().map(function (m) {
      return { from: m.getFrom(), to: m.getTo(), date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 12000) };
    }),
  };
}

/** Sent emails from the last 14 days that asked a question and haven't had a reply yet. */
function waiting_() {
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const items = [];
  GmailApp.search('in:sent newer_than:14d older_than:1d', 0, 40).forEach(function (t) {
    const msgs = t.getMessages();
    const last = msgs[msgs.length - 1];
    if (last.getFrom().toLowerCase().indexOf(me) === -1) return;
    const body = last.getPlainBody().split(/\n>|\nOn .+wrote:/)[0];
    if (body.indexOf('?') === -1) return;
    items.push({ id: t.getId(), to: last.getTo(), subj: t.getFirstMessageSubject() || '(No subject)', sent: last.getDate().toISOString() });
  });
  return items;
}
