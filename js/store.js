import { uid, today, addDays, nowMin, fromISO } from './util.js';

const KEY = 'pitwall.v1';
export let S = null;

export function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || S.v !== 1) { S = seed(); save(); }
  return S;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ }
}
export function replaceAll(data) { S = data; save(); }
export function reset() { S = seed(); save(); }
export function blank() {
  return {
    v: 1, created: Date.now(),
    settings: { autoSwitch: true },
    tasks: [], events: [], waiting: [], notes: [], messages: [], weekends: [],
  };
}
export function removeSamples() {
  for (const k of ['tasks', 'events', 'waiting', 'notes', 'messages', 'weekends']) S[k] = S[k].filter((x) => !x.sample);
  save();
}
export const hasSamples = () => ['tasks', 'events', 'waiting', 'notes', 'messages', 'weekends'].some((k) => S[k].some((x) => x.sample));

export function projects() {
  const set = new Map();
  for (const t of S.tasks) if (t.project) {
    const p = set.get(t.project) || { name: t.project, ctx: t.ctx, done: 0, total: 0 };
    p.total++; if (t.done) p.done++;
    set.set(t.project, p);
  }
  return [...set.values()].filter((p) => p.done < p.total).sort((a, b) => (b.total - b.done) - (a.total - a.done));
}
export const projectNames = () => [...new Set(S.tasks.map((t) => t.project).filter(Boolean))];

export function newTask(f) {
  return Object.assign({ id: uid(), title: 'Untitled', ctx: 'work', project: null, due: null, dueTime: null, est: 30, done: false, doneAt: null, sched: null, src: null, created: Date.now() }, f);
}
export function newEvent(f) {
  return Object.assign({ id: uid(), title: 'Untitled', ctx: 'work', date: today(), start: 9 * 60, dur: 60, location: '', travel: { mode: 'drive', mins: {} }, early: 5, created: Date.now() }, f);
}

function seed() {
  const T = today();
  const D = (n) => addDays(T, n);
  const s = blank();
  const smp = { sample: true };

  s.events = [
    { title: 'Gym', ctx: 'personal', date: T, start: 510, dur: 60 },
    { title: 'Team stand-up', ctx: 'work', date: T, start: 600, dur: 30, location: 'Video call' },
    { title: 'Lunch with Alex', ctx: 'personal', date: T, start: 750, dur: 60 },
    { title: 'Client check-in', ctx: 'work', date: T, start: 930, dur: 45, location: 'Video call' },
    { title: 'Dinner with friends', ctx: 'personal', date: T, start: 1110, dur: 120, location: '[Restaurant address]', travel: { mode: 'drive', mins: { drive: 24, transit: 52, bike: 41, walk: 115 } }, early: 5 },
    { title: 'Project kickoff', ctx: 'work', date: D(-1), start: 540, dur: 60 },
    { title: 'Venue walkthrough', ctx: 'work', date: D(1), start: 660, dur: 60, location: '[Venue address]', travel: { mode: 'drive', mins: { drive: 30 } }, early: 10 },
    { title: 'Interview — design candidate', ctx: 'work', date: D(1), start: 840, dur: 45, location: 'Video call' },
    { title: 'Supplier check-in', ctx: 'work', date: D(2), start: 540, dur: 30 },
    { title: 'Movie night', ctx: 'personal', date: D(2), start: 1140, dur: 120 },
    { title: 'Farmers market', ctx: 'personal', date: D(3), start: 600, dur: 120, location: '[Market address]', travel: { mode: 'drive', mins: { drive: 15 } }, early: 5 },
  ].map((e) => newEvent(Object.assign({}, e, smp)));

  s.tasks = [
    { title: 'Finalize offsite agenda', ctx: 'work', project: 'Team offsite', due: T, dueTime: 1020, est: 60 },
    { title: 'Send interview feedback', ctx: 'work', project: 'Hiring', due: T, est: 30, sched: { date: T, start: 990 } },
    { title: 'Order bathroom tiles', ctx: 'personal', project: 'Home reno', due: T, est: 30 },
    { title: 'Renew licence plate sticker', ctx: 'personal', project: 'Admin', due: D(-2), est: 15 },
    { title: 'Print offsite name badges', ctx: 'work', project: 'Team offsite', due: D(1), est: 30 },
    { title: 'Review homepage draft', ctx: 'work', project: 'Website refresh', due: D(2), est: 60 },
    { title: 'Book second-round interviews', ctx: 'work', project: 'Hiring', due: D(2), est: 30 },
    { title: 'Pick up paint samples', ctx: 'personal', project: 'Home reno', due: D(3), est: 60 },
    { title: 'Meal prep for the week', ctx: 'personal', project: 'Home', due: D(4), est: 90 },
    { title: 'Research flights for spring trip', ctx: 'personal', project: 'Trip planning', est: 60 },
    { title: 'Write website style guide', ctx: 'work', project: 'Website refresh', est: 120 },
    { title: 'Organize garage shelving', ctx: 'personal', project: 'Home', est: 120 },
    { title: 'Book offsite venue', ctx: 'work', project: 'Team offsite', done: true, doneAt: D(-20) },
    { title: 'Send offsite invitations', ctx: 'work', project: 'Team offsite', done: true, doneAt: D(-10) },
    { title: 'Shortlist candidates', ctx: 'work', project: 'Hiring', done: true, doneAt: D(-6) },
    { title: 'Remove old vanity', ctx: 'personal', project: 'Home reno', done: true, doneAt: D(-30) },
    { title: 'Choose tile colour', ctx: 'personal', project: 'Home reno', done: true, doneAt: D(-14) },
  ].map((t) => newTask(Object.assign({}, t, smp)));

  s.waiting = [
    { who: 'Supplier', what: 'Quote for new office chairs', via: 'email', ctx: 'work', sent: D(-8), expect: D(-3), auto: true },
    { who: 'Finance team', what: 'Sign-off on the offsite budget', via: 'email', ctx: 'work', sent: D(-5), expect: D(-1) },
    { who: 'Event venue', what: 'Final headcount confirmation', via: 'email', ctx: 'work', sent: D(-2), expect: D(2), auto: true },
    { who: 'Candidates (3)', what: 'References for the second round', via: 'email', ctx: 'work', sent: D(-1), expect: D(5) },
    { who: 'Hardware store', what: 'Stock check on bathroom tiles', via: 'call', ctx: 'personal', sent: T, expect: D(1) },
    { who: 'Insurance broker', what: 'Updated policy documents', via: 'text', ctx: 'personal', sent: D(-2), expect: null },
  ].map((w) => Object.assign({ id: uid(), nudged: null, done: false }, w, smp));

  const nm = nowMin();
  const at = (minsAgo) => { const m = nm - minsAgo; return m >= 0 ? { date: T, time: m } : { date: D(-1), time: 1440 + m }; };
  s.messages = [
    Object.assign({ type: 'email', who: 'Operations team', from: '', subj: 'Quarterly plan — draft for review', ctx: 'work', unread: true,
      body: 'Hi there,\n\nThe first draft of next quarter\'s plan is attached. Could you review it and send comments by Friday? We want to share it with the wider team the week after.\n\nThanks' }, at(24)),
    Object.assign({ type: 'text', who: 'Alex', from: '', ctx: 'personal', unread: true, body: 'Still good for Saturday?' }, at(48)),
    Object.assign({ type: 'call', who: 'Supplier', from: '', ctx: 'work', missed: true, body: 'Missed call · left voicemail' }, at(91)),
    Object.assign({ type: 'email', who: 'Event venue', from: '', subj: 'Final headcount needed by Friday', ctx: 'work', unread: true,
      body: 'Hi there,\n\nThanks again for choosing us for your team offsite. To finalize the room setup and catering, please confirm final numbers and any dietary notes by Friday.\n\nA microphone and screen are included for presentations. Any other AV requests should come to us by Monday.\n\nBest,\nEvents team',
      actions: [{ title: 'Confirm final headcount and dietary notes', day: 'friday' }, { title: 'Send AV requests', day: 'monday' }] }, at(186)),
    Object.assign({ type: 'text', who: 'Jordan', from: '', ctx: 'personal', body: 'Leftovers are in your fridge' }, at(274)),
    Object.assign({ type: 'call', who: 'Hardware store', from: '', ctx: 'personal', body: 'Outgoing · 6 min' }, at(321)),
    { type: 'email', who: 'Design candidate', from: '', subj: 'Re: Interview time', ctx: 'work', body: 'Thanks — that time works for me. Looking forward to it.', date: D(-1), time: 1010 },
    { type: 'call', who: 'Alex', from: '', ctx: 'personal', missed: true, body: 'Missed call', date: D(-1), time: 840 },
    { type: 'text', who: 'Office group', from: '', ctx: 'work', body: 'Spare keys are in the lockbox by the front desk', date: D(-1), time: 700 },
    { type: 'email', who: 'Insurance', from: '', subj: 'Your policy renewal', ctx: 'personal', body: 'Your renewal documents are ready to review. Please let us know if anything has changed with your vehicles before the renewal date.', date: D(-2), time: 600 },
  ].map((m) => Object.assign({ id: uid(), unread: false, missed: false }, m, smp));

  s.notes = [
    { text: 'Projector in meeting room B needs a new cable.', ctx: 'work' },
    { text: 'Measure the bathroom wall before ordering more tiles.', ctx: 'personal' },
  ].map((n, i) => Object.assign({ id: uid(), created: Date.now() - (i + 1) * 36e5 }, n, smp));

  // Next Friday (at least a few days out)
  const td = fromISO(T);
  let toFri = (5 - td.getDay() + 7) % 7; if (toFri < 3) toFri += 7;
  const fri = D(toFri);
  const it = (t, title, where) => ({ id: uid(), t, title, where });
  const li = (label, done) => ({ id: uid(), label, done: !!done });
  s.weekends = [{
    id: uid(), sample: true, name: 'Annual conference', track: '[Venue name]', start: fri,
    hotel: '[Hotel name]', conf: '[number]', gate: 'Parking [lot] · pass required', gateNote: 'Use the north entrance',
    leave: 'Thu 14:00', drive: '[drive time]',
    days: [
      { label: 'Friday', items: [it(480, 'Registration opens', 'Main lobby'), it(540, 'Opening keynote', 'Hall A'), it(630, 'Breakout sessions', 'Rooms 1–4'), it(750, 'Lunch', 'Atrium'), it(840, 'Workshop', 'Room 2'), it(1080, 'Welcome reception', 'Rooftop')] },
      { label: 'Saturday', items: [it(510, 'Registration desk', 'Main lobby'), it(570, 'Panel discussion', 'Hall A'), it(720, 'Lunch', 'Atrium'), it(840, 'Team meetings', 'Room 3'), it(1140, 'Dinner', 'Restaurant')] },
      { label: 'Sunday', items: [it(540, 'Closing keynote', 'Hall A'), it(660, 'Wrap-up', 'Hall A'), it(780, 'Pack down', 'Booth'), it(900, 'Drive home', '')] },
    ],
    lists: [
      { id: uid(), name: 'Equipment', items: [li('Laptop and charger', 1), li('Presentation clicker', 1), li('Extension cord', 1), li('Spare batteries', 1), li('Business cards'), li('Printed handouts')] },
      { id: uid(), name: 'Registration desk', items: [li('Name badges', 1), li('Printed attendee list', 1), li('Sign-in sheets'), li('Card reader or tablet'), li('Signage')] },
      { id: uid(), name: 'Personal packing', items: [li('Rain jacket', 1), li('Comfortable shoes'), li('Phone charger'), li('Power bank'), li('Water bottle')] },
    ],
    contacts: [
      { id: uid(), role: 'Event lead', name: '', phone: '' },
      { id: uid(), role: 'Venue manager', name: '', phone: '' },
      { id: uid(), role: 'Hotel front desk', name: '', phone: '' },
      { id: uid(), role: 'Transport', name: '', phone: '' },
    ],
  }];
  return s;
}
