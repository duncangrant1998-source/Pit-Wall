import { iso, addDays, cap } from './util.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYNAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYRE = /\b(?:(on|this|next)\s+)?(today|tonight|tomorrow|tmrw|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const DATERE = /\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?|(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?)\b/i;
const TIME12 = /\b(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i;
const TIME24 = /\b(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i;
const DURRE = /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;

export function resolveDay(word, now = new Date()) {
  const w = word.toLowerCase();
  const td = iso(now);
  if (w === 'today' || w === 'tonight') return td;
  if (w.startsWith('tom') || w === 'tmrw') return addDays(td, 1);
  const idx = DAYNAMES.indexOf(w.slice(0, 3));
  if (idx < 0) return null;
  const diff = (idx - now.getDay() + 7) % 7;
  return addDays(td, diff);
}

function findDate(t, now) {
  let m = t.match(DATERE);
  if (m) {
    const day = +(m[1] || m[4]);
    const mon = MONTHS.indexOf((m[2] || m[3]).slice(0, 3).toLowerCase());
    let d = new Date(now.getFullYear(), mon, day);
    if (iso(d) < iso(now)) d = new Date(now.getFullYear() + 1, mon, day);
    return { date: iso(d), match: m[0] };
  }
  m = t.match(DAYRE);
  if (m) {
    let date = resolveDay(m[2], now);
    if (m[1] && m[1].toLowerCase() === 'next' && date === iso(now)) date = addDays(date, 7);
    return { date, match: m[0], tonight: m[2].toLowerCase() === 'tonight' };
  }
  return null;
}

function findTime(t) {
  let m = t.match(TIME12);
  if (m) {
    const pm = m[3].toLowerCase().startsWith('p');
    let h = (+m[1]) % 12 + (pm ? 12 : 0);
    return { time: h * 60 + (+(m[2] || 0)), match: m[0] };
  }
  m = t.match(TIME24);
  if (m) return { time: (+m[1]) * 60 + (+m[2]), match: m[0] };
  return null;
}

export function matchProject(text, projects) {
  const low = ' ' + text.toLowerCase() + ' ';
  for (const p of projects) {
    const tokens = p.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w));
    if (tokens.some((tok) => low.includes(tok))) return p;
  }
  return null;
}

/** Parse a free-text capture into a structured item. */
export function parse(text, opts = {}) {
  const now = opts.now || new Date();
  let t = ' ' + (text || '') + ' ';
  const out = { ctx: null, type: null, date: null, time: null, dur: null, location: null, who: null };
  if (/#work\b/i.test(t)) out.ctx = 'work';
  else if (/#(personal|home|me)\b/i.test(t)) out.ctx = 'personal';
  t = t.replace(/#\w+/g, ' ');

  if (/^\s*note\b[:\-]?/i.test(t)) { out.type = 'note'; t = t.replace(/^\s*note\b[:\-]?\s*/i, ' '); }
  else if (/\bwaiting\s+on\b/i.test(t)) out.type = 'waiting';

  const d = findDate(t, now);
  if (d) { out.date = d.date; t = t.replace(d.match, ' '); }
  const tm = findTime(t);
  if (tm) { out.time = tm.time; t = t.replace(tm.match, ' '); }
  else if (d && d.tonight) out.time = 19 * 60;
  const dm = t.match(DURRE);
  if (dm) { const n = parseFloat(dm[1]); out.dur = /^h/i.test(dm[2]) ? Math.round(n * 60) : Math.round(n); t = t.replace(dm[0], ' '); }

  if (out.type === 'waiting') {
    t = t.replace(/\bwaiting\s+on\s+/i, ' ').trim();
    const fm = t.match(/^(.*?)\s+(?:for|about|re:?|to send|to)\s+(.*)$/i);
    if (fm && fm[1].split(/\s+/).length <= 4) { out.who = cap(fm[1].trim()); t = fm[2]; }
  }

  if (!out.type) out.type = out.time != null ? 'event' : 'task';

  if (out.type === 'event') {
    const lm = t.match(/\s(?:at|@)\s+([^,]+?)\s*$/i);
    if (lm && lm[1].trim().length > 1) { out.location = lm[1].trim(); t = t.replace(lm[0], ' '); }
  }

  let title = t.replace(/\s{2,}/g, ' ').trim()
    .replace(/^[\s,:;\-–—]+|[\s,:;\-–—]+$/g, '')
    .replace(/\s+(by|on|at|before|due)$/i, '')
    .replace(/^(by|on|at)\s+/i, '');
  out.title = cap(title.trim());
  out.project = opts.projects ? matchProject(text, opts.projects) : null;
  return out;
}

const ACTION_RE = /\b(please|could you|can you|would you|let (?:us|me) know|need(?:s|ed)? (?:to|you|the|your)|confirm|send (?:us|me|over)|reply|respond|by (?:today|tomorrow|end of|mon|tue|wed|thu|fri|sat|sun))/i;

/** Find sentences in a message that ask for something; suggest a task for each. */
export function detectActions(body, now = new Date()) {
  const text = (body || '').replace(/\r/g, '');
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [];
  const found = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length < 12 || !ACTION_RE.test(s)) continue;
    if (/^(hi|hey|hello|thanks|thank you|best|cheers|regards)\b/i.test(s) && s.length < 40) continue;
    const p = parse(s, { now });
    let title = s
      .replace(/^(?:hi|hey|hello)[^,]*,\s*/i, '')
      .replace(/^.*?\b(?:please|could you|can you|would you)\s+/i, '')
      .replace(/^(?:we|i)\s+(?:will\s+)?(?:also\s+)?need\s+(?:you\s+to\s+)?/i, '')
      .replace(/\s+(?:by|before|no later than)\s+.*$/i, '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (title.length > 70) title = title.slice(0, 67).replace(/\s+\S*$/, '') + '…';
    found.push({ sentence: s, title: cap(title), date: p.date });
  }
  return found;
}
