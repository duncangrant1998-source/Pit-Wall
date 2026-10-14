import { esc, uid, cap, today, addDays, diffDays, nowMin, hm, weekStart, fromISO, dayShort, dayLong, relDay, dur, durShort, icon, mk, WD, MONL } from './util.js';
import { S, load, save, replaceAll, reset, removeSamples, hasSamples, projects, projectNames, newTask, newEvent } from './store.js';
import { parse, detectActions, resolveDay } from './parse.js';

load();
const app = document.getElementById('app');

/* ---------- ui state (not saved) ---------- */
const autoCtx = () => { const d = new Date(), h = d.getHours(), w = d.getDay(); return (w >= 1 && w <= 5 && h >= 8 && h < 18) ? 'work' : 'personal'; };
const ui = {
  ctx: S.settings.autoSwitch ? autoCtx() : 'all',
  calDay: today(),
  taskList: 'today', taskProject: null,
  inboxFilter: 'all', inboxQ: '',
  waitCtx: 'all',
  wkDay: 0, wkOpen: null,
  plan: { sel: null, all: false },
  cap: null,
  sheet: null, toast: null,
};
const LABEL = { work: 'Work', personal: 'Personal' };

/* ---------- helpers ---------- */
const byId = (arr, id) => arr.find((x) => x.id === id);
const keepCtx = (c) => (x) => c === 'all' || x.ctx === c;
const travelMins = (e) => (e.travel && e.travel.mins ? e.travel.mins[e.travel.mode] : null);
const leaveAt = (e) => { const m = travelMins(e); return m == null ? null : e.start - (e.early || 0) - m; };
const isVideo = (loc) => /video|zoom|teams|meet|call/i.test(loc || '');

function seg(items, active, action, cols, extra = '') {
  return `<div class="seg" role="group" ${extra} style="grid-template-columns:repeat(${cols || items.length},minmax(0,1fr))">${items.map((it) =>
    `<button type="button" data-a="${action}" data-v="${esc(it.id)}" aria-pressed="${active === it.id}">${it.mark ? mk(it.mark) : ''}${esc(it.label)}${it.count ? `<span class="cnt">${it.count}</span>` : ''}</button>`).join('')}</div>`;
}
const ctxSeg = (active, action) => seg([{ id: 'all', label: 'All' }, { id: 'work', label: 'Work', mark: 'work' }, { id: 'personal', label: 'Personal', mark: 'personal' }], active, action, 3, 'aria-label="Show"');

function tabbar(cur) {
  const tabs = [['today', 'Today', 'sun'], ['calendar', 'Calendar', 'cal'], ['tasks', 'Tasks', 'tasks'], ['inbox', 'Inbox', 'inbox'], ['more', 'More', 'grid']];
  const unread = S.messages.filter((m) => m.unread || m.missed).length;
  return `<nav class="tabbar" aria-label="Sections">${tabs.map(([id, l, ic]) =>
    `<a class="tab" href="#/${id}" ${cur === id ? 'aria-current="page"' : ''}>${icon(ic)}${l}${id === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}</a>`).join('')}</nav>`;
}
const backLink = (href, label) => `<a class="back" href="${href}">${icon('left', 20, 2)}${esc(label)}</a>`;
const sectionHead = (title, right = '') => `<div class="secthd"><h2 class="h2">${esc(title)}</h2>${right}</div>`;

function taskSort(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const ka = a.sched ? a.sched.start : (a.dueTime ?? 9999), kb = b.sched ? b.sched.start : (b.dueTime ?? 9999);
  if ((a.due || '9') !== (b.due || '9')) return (a.due || '9') < (b.due || '9') ? -1 : 1;
  return ka - kb;
}
function taskRow(t, o = {}) {
  const T = today();
  const late = !t.done && t.due && t.due < T;
  const meta = [];
  if (t.src) meta.push(icon('mail', 13, 2));
  if (t.project) meta.push(esc(t.project));
  if (o.showDue && t.due && !late) meta.push(relDay(t.due));
  if (t.est) meta.push(dur(t.est));
  let right = '';
  if (late) right = `<span class="pill late">${diffDays(t.due, T) === 1 ? 'YESTERDAY' : 'OVERDUE'}</span>`;
  else if (!t.done && t.sched && t.sched.date === T) right = `<span class="sched">${hm(t.sched.start)}</span>`;
  else if (!t.done && t.dueTime != null && t.due === T) right = `<span class="pill">DUE ${hm(t.dueTime)}</span>`;
  return `<div class="lrow ${t.done ? 'done' : ''}">
    <button type="button" class="chk" data-a="toggleTask" data-id="${t.id}" aria-pressed="${t.done}" aria-label="Done: ${esc(t.title)}"><span class="box">${t.done ? icon('check', 16, 3) : ''}</span></button>
    <button type="button" class="body" data-a="openTask" data-id="${t.id}"><span class="ttl">${esc(t.title)}</span><span class="meta">${mk(t.ctx)}${meta.join(' · ')}</span></button>
    ${right}</div>`;
}

/* ---------- views ---------- */
const VIEWS = {};

VIEWS.today = () => {
  const T = today(), nm = nowMin(), ctx = ui.ctx, keep = keepCtx(ctx);
  const evs = S.events.filter((e) => e.date === T && keep(e)).sort((a, b) => a.start - b.start);
  const past = evs.filter((e) => e.start + e.dur <= nm), upcoming = evs.filter((e) => e.start + e.dur > nm);
  const next = upcoming[0];
  const trip = upcoming.find((e) => e.start > nm && e.location && !isVideo(e.location) && leaveAt(e) != null && leaveAt(e) - nm < 360);

  let tripHTML = '';
  if (trip) {
    const lv = leaveAt(trip), late = lv <= nm;
    tripHTML = `<a class="alertcard ${late ? 'late' : ''}" href="#/trip/${trip.id}">
      <span style="color:${late ? 'var(--alert)' : 'var(--pers)'}">${icon('car')}</span>
      <span class="grow stack g4"><span class="k">${late ? 'LEAVE NOW · ' + dur(nm - lv) + ' LATE' : 'LEAVE BY ' + hm(lv) + ' · IN ' + dur(lv - nm).toUpperCase()}</span>
      <span class="b small ellip">${esc(trip.title)} · ${dur(travelMins(trip))} ${trip.travel.mode}</span></span>${icon('right', 18, 2)}</a>`;
  }

  let nextHTML;
  if (next) {
    const now = next.start <= nm;
    const lv = leaveAt(next);
    const action = next.location && !isVideo(next.location) && lv != null
      ? `<a class="btn primary wide" href="#/trip/${next.id}">${icon('car', 18)}Leave by ${hm(lv)}</a>`
      : `<button type="button" class="btn primary wide" data-a="openEvent" data-id="${next.id}">Details</button>`;
    nextHTML = `<section class="card pad stack g14" aria-label="Next up">
      <div class="rowx between"><span class="eyebrow">${now ? 'Now · until ' + hm(next.start + next.dur) : 'Next up · in ' + dur(next.start - nm)}</span><span class="rowx g6 xs b t2">${mk(next.ctx)}${LABEL[next.ctx]}</span></div>
      <div class="stack g6"><span class="mono" style="font-size:44px;line-height:1;font-weight:500;letter-spacing:-.02em">${hm(next.start)}</span>
      <span style="font-size:20px;font-weight:650;line-height:1.2">${esc(next.title)}</span>
      <span class="small muted">${dur(next.dur)}${next.location ? ' · ' + esc(next.location) : ''}</span></div>
      <div class="rowx g8">${action}<a class="btn wide" href="#/calendar">View day</a></div></section>`;
  } else {
    nextHTML = `<section class="card pad stack g12"><span class="t2">Nothing else scheduled today.</span><a class="btn" href="#/plan">${icon('calplus', 18)}Plan your day</a></section>`;
  }

  const msgs = S.messages.filter(keep);
  const cnt = { email: msgs.filter((m) => m.type === 'email' && m.unread).length, text: msgs.filter((m) => m.type === 'text' && m.unread).length, call: msgs.filter((m) => m.type === 'call' && m.missed).length };
  const tile = (ic, n, label, alert) => `<a class="tile" href="#/inbox">${icon(ic, 20)}<span class="stack g4"><span class="num" ${alert && n ? 'style="color:var(--alert)"' : ''}>${n}</span><span class="xs muted">${label}</span></span></a>`;

  const agenda = (e, isPast) => `<button type="button" class="agenda ${isPast ? 'past' : ''}" data-a="openEvent" data-id="${e.id}">
    <span class="tm">${hm(e.start)}</span><span class="stack g4" style="min-width:0"><span class="rowx g8">${mk(e.ctx)}<span class="ttl ellip">${esc(e.title)}</span></span>
    <span class="sub">${dur(e.dur)}${e.location ? ' · ' + esc(e.location) : ''}</span></span></button>`;

  const tasks = S.tasks.filter((t) => keep(t) && ((t.due && t.due <= T) || (t.sched && t.sched.date === T)) && (!t.done || t.doneAt === T)).sort(taskSort);

  const d = fromISO(T);
  return {
    tab: 'today',
    html: `<main class="main has-fab">
      <header class="hd"><div class="stack g4"><span class="eyebrow">${dayLong(T)}</span><h1 class="h1">Today</h1></div>
      <div class="rowx g8"><a class="avatar" href="#/more" aria-label="More and settings">${icon('person', 22, 2)}</a></div></header>
      ${ctxSeg(ctx, 'setCtx')}
      ${tripHTML}
      ${nextHTML}
      <section class="tiles" aria-label="Communications">${tile('mail', cnt.email, 'Unread email')}${tile('text', cnt.text, 'New texts')}${tile('phone', cnt.call, 'Missed calls', true)}</section>
      <section class="stack" aria-label="Schedule">${sectionHead('Schedule', '<a class="link" href="#/calendar">Calendar</a>')}
        ${evs.length ? past.map((e) => agenda(e, true)).join('') + `<div class="nowline"><span class="nowtag">NOW ${hm(nm)}</span><span class="ln"></span></div>` + upcoming.map((e) => agenda(e, false)).join('') : '<p class="small muted" style="padding:6px 0">No events today.</p>'}
      </section>
      <section class="stack" aria-label="Due today">${sectionHead('Due today', '<span class="links"><a class="link" href="#/plan">Plan day</a><a class="link" href="#/tasks">All tasks</a></span>')}
        ${tasks.length ? tasks.map((t) => taskRow(t)).join('') : '<p class="small muted" style="padding:6px 0">Nothing due. Nice.</p>'}
      </section>
    </main>
    <a class="fab" href="#/capture" aria-label="Quick add">${icon('plus', 26, 2.2)}</a>`,
  };
};

/* calendar */
function layoutCols(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = []; let cur = [], end = -1;
  for (const it of items) { if (cur.length && it.s >= end) { clusters.push(cur); cur = []; end = -1; } cur.push(it); end = Math.max(end, it.e); }
  if (cur.length) clusters.push(cur);
  for (const c of clusters) { const cols = []; for (const it of c) { let i = cols.findIndex((e) => e <= it.s); if (i < 0) { i = cols.length; cols.push(0); } cols[i] = it.e; it.col = i; } c.forEach((it) => { it.n = cols.length; }); }
  return items;
}
VIEWS.calendar = () => {
  const day = ui.calDay, T = today(), nm = nowMin();
  const ws = weekStart(day), days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));
  const H = 56, START = 6 * 60, END = 24 * 60;
  const items = [
    ...S.events.filter((e) => e.date === day).map((e) => ({ kind: 'e', o: e, s: e.start, e: e.start + Math.max(e.dur, 20) })),
    ...S.tasks.filter((t) => t.sched && t.sched.date === day).map((t) => ({ kind: 't', o: t, s: t.sched.start, e: t.sched.start + Math.max(t.est || 30, 20) })),
  ];
  layoutCols(items);
  const pos = (it) => `top:${(it.s - START) / 60 * H + 2}px;height:${Math.max((it.e - it.s) / 60 * H - 4, 22)}px;left:calc(56px + (100% - 56px) * ${it.col} / ${it.n});width:calc((100% - 56px) / ${it.n} - 4px)`;
  const blocks = items.map((it) => it.kind === 'e'
    ? `<button type="button" class="tl-ev ${it.o.ctx}" style="${pos(it)}" data-a="openEvent" data-id="${it.o.id}"><span class="t">${mk(it.o.ctx)}<span class="ellip">${esc(it.o.title)}</span></span><span class="r">${hm(it.o.start)}–${hm(it.o.start + it.o.dur)}</span></button>`
    : `<button type="button" class="tl-task ${it.o.ctx} ${it.o.done ? 'done' : ''}" style="${pos(it)}" data-a="openTask" data-id="${it.o.id}"><span class="tasktag">TASK</span><span class="t small b ellip">${esc(it.o.title)}</span></button>`).join('');
  let hours = '';
  for (let m = START; m <= END; m += 60) hours += `<div class="tl-h" style="top:${(m - START) / 60 * H}px" data-a="newAt" data-v="${m}"><span>${hm(m)}</span><i></i></div>`;
  const nowLine = day === T ? `<div class="tl-now" style="top:${(nm - START) / 60 * H}px"><b>${hm(nm)}</b><i></i></div>` : '';
  const dayEv = S.events.filter((e) => e.date === day).length;
  const strip = days.map((d) => {
    const evs = S.events.filter((e) => e.date === d);
    const f = fromISO(d);
    return `<button type="button" class="day ${d === T ? 'today' : ''}" data-a="calDay" data-v="${d}" aria-pressed="${d === day}" aria-label="${dayLong(d)}">
      <span class="w">${WD[f.getDay()].toUpperCase()}</span><span class="n">${f.getDate()}</span>
      <span class="dots">${evs.some((e) => e.ctx === 'work') ? '<i class="work"></i>' : ''}${evs.some((e) => e.ctx === 'personal') ? '<i class="personal"></i>' : ''}</span></button>`;
  }).join('');
  const firstStart = items.length ? Math.min(...items.map((i) => i.s)) : 8 * 60;
  const focus = day === T ? nm - 90 : firstStart - 60;
  const f = fromISO(day);
  return {
    tab: 'calendar',
    initScroll: Math.max(0, (focus - START) / 60 * H),
    html: `<div style="padding:calc(var(--st) + 14px) 20px 12px;border-bottom:1px solid var(--line)" class="stack g14">
      <header class="hd"><div class="stack g4"><span class="eyebrow">${f.getFullYear()}</span><h1 class="h1 sm">${MONL[f.getMonth()]}</h1></div>
      <div class="rowx g6"><button type="button" class="icon-btn" data-a="calWeek" data-v="-7" aria-label="Previous week">${icon('left', 18, 2)}</button>
      <button type="button" class="btn sm" style="border-radius:22px;min-height:44px" data-a="calDay" data-v="${T}">Today</button>
      <button type="button" class="icon-btn" data-a="calWeek" data-v="7" aria-label="Next week">${icon('right', 18, 2)}</button></div></header>
      <div class="week" role="group" aria-label="Day">${strip}</div>
      <div class="rowx between"><span class="small b">${dayLong(day)} · ${dayEv === 1 ? '1 event' : dayEv + ' events'}</span>
      <span class="rowx g12 xs muted"><span class="rowx g6">${mk('work')}Work</span><span class="rowx g6">${mk('personal')}Personal</span></span></div></div>
      <main class="main" style="padding-top:14px;padding-bottom:110px"><div class="tl" style="height:${(END - START) / 60 * H}px">${hours}${blocks}${nowLine}</div></main>
      <a class="fab" href="#/capture?type=event&date=${day}" aria-label="New event">${icon('plus', 26, 2.2)}</a>`,
  };
};

/* tasks */
function taskLists() {
  const T = today(), wk = addDays(T, 7);
  const open = S.tasks.filter((t) => !t.done);
  return {
    today: open.filter((t) => (t.due && t.due <= T) || (t.sched && t.sched.date === T)),
    week: open.filter((t) => t.due && t.due > T && t.due <= wk && !(t.sched && t.sched.date === T)),
    someday: open.filter((t) => !t.due && !(t.sched && t.sched.date === T)),
    later: open.filter((t) => t.due && t.due > wk),
    done: S.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 40),
  };
}
VIEWS.tasks = () => {
  const L = taskLists();
  const openCount = S.tasks.filter((t) => !t.done).length;
  const waiting = S.waiting.filter((w) => !w.done), late = waiting.filter((w) => w.expect && w.expect < today()).length;
  const projs = projects();
  let list, label;
  if (ui.taskProject) {
    list = S.tasks.filter((t) => t.project === ui.taskProject && !t.done).sort(taskSort);
  } else {
    list = (ui.taskList === 'week' ? L.week.concat(L.later) : L[ui.taskList]).slice().sort(taskSort);
  }
  const projCards = projs.map((p) => `<button type="button" class="tile2" style="flex:none;width:168px;min-height:104px;${ui.taskProject === p.name ? 'border:2px solid var(--text);padding:13px' : ''}" data-a="filterProject" data-v="${esc(p.name)}" aria-pressed="${ui.taskProject === p.name}">
      <span class="rowx g8 xs b t2">${mk(p.ctx)}${LABEL[p.ctx]}</span><span style="font-size:17px;font-weight:650;line-height:1.15">${esc(p.name)}</span>
      <span class="stack g6"><span class="bar"><i style="width:${Math.round(p.done / p.total * 100)}%;background:var(--${p.ctx === 'work' ? 'work' : 'pers'})"></i></span><span class="mono" style="font-size:11px;color:var(--muted)">${p.done} of ${p.total} done</span></span></button>`).join('');
  const empty = { today: 'Nothing due today.', week: 'Nothing due in the next week.', someday: 'No undated tasks.', done: 'Nothing completed yet.' };
  return {
    tab: 'tasks',
    html: `<main class="main">
      <header class="hd"><div class="stack g4"><span class="eyebrow">${openCount} open</span><h1 class="h1">Tasks</h1></div>
      <a class="btn primary sm" style="border-radius:22px;min-height:44px" href="#/plan">${icon('calplus', 18, 2)}Plan day</a></header>
      ${projs.length ? `<section class="stack g10" aria-label="Projects"><h2 class="h2">Projects</h2><div class="tray">${projCards}</div></section>` : ''}
      <a class="tile2" style="min-height:60px;flex-direction:row;align-items:center;gap:14px;padding:0 16px" href="#/waiting">${icon('clock')}
        <span class="grow stack g4"><span class="b">Waiting on</span><span class="small muted">${waiting.length} open${late ? ` · <span style="color:var(--alert)">${late} overdue</span>` : ''}</span></span>${icon('right', 18, 2)}</a>
      ${ui.taskProject ? `<div class="rowx between"><span class="b">${esc(ui.taskProject)} · ${list.length} open</span><button type="button" class="btn sm" data-a="filterProject" data-v="">${icon('x', 16, 2)}Clear</button></div>`
        : seg([{ id: 'today', label: 'Today', count: L.today.length || '' }, { id: 'week', label: 'Week', count: (L.week.length + L.later.length) || '' }, { id: 'someday', label: 'Someday', count: L.someday.length || '' }, { id: 'done', label: 'Done' }], ui.taskList, 'taskList', 4, 'aria-label="List"')}
      <section class="stack" aria-label="Task list">${list.length ? list.map((t) => taskRow(t, { showDue: true })).join('') : `<p class="empty">${ui.taskProject ? 'All done here.' : empty[ui.taskList]}</p>`}</section>
    </main>
    <form class="bottombar" data-f="addTask"><label for="newtask" class="sr">Add a task</label>
      <input id="newtask" name="t" class="input" style="height:48px;background:var(--surface);border-color:var(--line)" placeholder="Add a task — “Call venue Fri #work”" autocomplete="off" enterkeyhint="done">
      <button class="btn primary" style="width:48px;padding:0;flex:none" aria-label="Add task">${icon('plus', 22, 2.2)}</button></form>`,
  };
};

/* inbox */
function msgRows() {
  const q = ui.inboxQ.trim().toLowerCase();
  const list = S.messages.filter((m) => (ui.inboxFilter === 'all' || m.type === ui.inboxFilter) && (!q || (m.who + ' ' + (m.subj || '') + ' ' + m.body).toLowerCase().includes(q)))
    .sort((a, b) => (b.date + hm(b.time)).localeCompare(a.date + hm(a.time)));
  if (!list.length) return `<p class="empty" style="margin-top:12px">${q ? 'No matches.' : 'Nothing here.'}</p>`;
  const T = today(); let out = '', lastG = '';
  for (const m of list) {
    const g = m.date === T ? 'Today' : m.date === addDays(T, -1) ? 'Yesterday' : 'Earlier';
    if (g !== lastG) { out += `<h2 class="h2" style="padding:14px 0 6px">${g}</h2>`; lastG = g; }
    const ic = { email: 'mail', text: 'text', call: 'phone' }[m.type];
    const bold = m.unread || m.missed;
    out += `<a href="#/message/${m.id}" class="rowx g12" style="align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line2);text-decoration:none">
      <span style="width:40px;height:40px;flex:none;border-radius:12px;background:var(--surface2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--text2)">${icon(ic, 18)}</span>
      <span class="grow stack g4"><span class="rowx g8">${mk(m.ctx)}<span class="grow ellip" style="font-size:15px;font-weight:${bold ? 700 : 550};color:${bold ? 'var(--text)' : 'var(--text2)'}">${esc(m.who)}</span><span class="mono xs muted">${m.date === T ? hm(m.time) : relDay(m.date)}</span></span>
      ${m.subj ? `<span class="ellip" style="font-size:14px;font-weight:600;color:#E4E2DC">${esc(m.subj)}</span>` : ''}
      <span class="rowx g8"><span class="grow ellip small" style="color:${m.missed ? 'var(--alert)' : 'var(--muted)'};font-weight:${m.missed ? 600 : 400}">${esc(m.body.replace(/\s+/g, ' '))}</span>${m.unread ? '<span style="width:8px;height:8px;border-radius:4px;background:var(--text);flex:none" aria-label="Unread"></span>' : ''}</span></span></a>`;
  }
  return out;
}
VIEWS.inbox = () => {
  const c = (t) => S.messages.filter((m) => (t === 'all' || m.type === t) && (m.unread || m.missed)).length || '';
  const sample = S.messages.some((m) => m.sample);
  return {
    tab: 'inbox',
    html: `<div style="padding:calc(var(--st) + 14px) 20px 10px" class="stack g14">
      <header class="hd"><div class="stack g4"><span class="eyebrow">Email · Texts · Calls</span><h1 class="h1">Inbox</h1></div>
      <a class="avatar" href="mailto:" aria-label="Compose email">${icon('edit', 20, 2)}</a></header>
      <div class="search"><label for="iq" class="sr">Search messages</label>${icon('search', 18)}<input id="iq" class="input" type="search" placeholder="Search people, messages, calls" value="${esc(ui.inboxQ)}" data-i="inboxQ" autocomplete="off"></div>
      ${seg([{ id: 'all', label: 'All', count: c('all') }, { id: 'email', label: 'Email', count: c('email') }, { id: 'text', label: 'Texts', count: c('text') }, { id: 'call', label: 'Calls', count: c('call') }], ui.inboxFilter, 'inboxFilter', 4, 'aria-label="Show"')}</div>
      <main class="main" style="padding-top:0;gap:0">
      ${sample ? '<p class="banner" style="margin-top:6px">These are sample messages so you can try things out. Gmail connects in the next step. iPhone doesn’t let any app read your texts or call history.</p>' : ''}
      <div id="inboxList">${msgRows()}</div></main>`,
  };
};

VIEWS.message = (r) => {
  const m = byId(S.messages, r.id);
  if (!m) return VIEWS.inbox();
  if (m.unread || m.missed) { m.unread = false; m.missed = false; save(); }
  const acts = messageActions(m);
  let body = esc(m.body);
  acts.forEach((a) => { if (a.sentence) { const s = esc(a.sentence); body = body.replace(s, `<mark class="act">${s}</mark>`); } });
  const reply = m.type === 'email' ? `<a class="btn wide" href="mailto:${esc(m.from)}?subject=${encodeURIComponent('Re: ' + (m.subj || ''))}">${icon('reply', 18)}Reply</a>`
    : m.type === 'text' ? `<a class="btn wide" href="sms:${esc(m.from)}">${icon('text', 18)}Reply</a>` : `<a class="btn wide" href="tel:${esc(m.from)}">${icon('phone', 18)}Call back</a>`;
  return {
    html: `<div class="topbar">${backLink('#/inbox', 'Inbox')}<button type="button" class="icon-btn plain" data-a="deleteMsg" data-id="${m.id}" aria-label="Delete">${icon('trash', 20)}</button></div>
    <main class="main" style="padding-top:8px">
      <div class="stack g10"><span class="rowx g8 xs b t2">${mk(m.ctx)}${LABEL[m.ctx]}${acts.length ? ` · ${acts.length} request${acts.length > 1 ? 's' : ''} found` : ''}</span>
      <h1 style="font-size:24px;line-height:1.2;font-weight:700;font-stretch:110%">${esc(m.subj || (m.type === 'call' ? 'Call' : 'Message') + ' from ' + m.who)}</h1></div>
      <div class="rowx g12"><span class="avatar" style="width:40px;height:40px;background:var(--raise);color:var(--text);font-size:14px">${esc(m.who.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>
      <span class="grow stack g4"><span class="b">${esc(m.who)}</span><span class="small muted">${relDay(m.date)} · ${hm(m.time)}</span></span></div>
      <div class="msgbody">${body.split(/\n{2,}/).map((p) => `<p>${p}</p>`).join('')}</div></main>
    <div class="bottombar">${reply}<button type="button" class="btn primary wide" style="flex:1.3" data-a="makeTask" data-id="${m.id}">${icon('tasks', 18, 2)}Make task</button></div>`,
  };
};
function messageActions(m) {
  if (m.actions) {
    return m.actions.map((a) => {
      const sentence = (m.body.match(/[^.!?\n]+[.!?]?/g) || []).map((s) => s.trim()).find((s) => new RegExp('\\b' + a.day.slice(0, 3), 'i').test(s));
      return { title: a.title, date: resolveDay(a.day), sentence };
    });
  }
  return detectActions(m.body);
}

/* more */
VIEWS.more = () => {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const tile = (href, ic, name, sub, soon) => soon
    ? `<div class="tile2" aria-disabled="true">${icon(ic)}<span class="stack g4"><span class="rowx between"><span class="b" style="font-size:16px">${name}</span><span class="pill">SOON</span></span><span class="xs muted">${sub}</span></span></div>`
    : `<a class="tile2" href="${href}">${icon(ic)}<span class="stack g4"><span class="b" style="font-size:16px">${name}</span><span class="xs muted">${sub}</span></span></a>`;
  const next = [['Gmail and Google Calendar', 'Your real inbox and calendar in place of the samples'], ['Live traffic for Leave by', 'Travel times update automatically from Google Maps'], ['Notifications', 'Leave-by alerts, nudges and a morning summary'], ['Contacts and files', 'One list for work and personal']];
  return {
    tab: 'more',
    html: `<main class="main">
      <header class="rowx g14"><span class="avatar" style="width:56px;height:56px;border-radius:28px">${icon('person', 26, 2)}</span>
      <div class="stack g4"><h1 class="h1 sm">More</h1><span class="small muted">Everything else in one place</span></div></header>
      <section class="tiles2" aria-label="Sections">
        ${tile('#/notes', 'note', 'Notes', S.notes.length + ' saved')}
        ${tile('#/waiting', 'clock', 'Waiting on', 'Replies you’re owed')}
        ${tile('#/weekend', 'flag', 'Event weekend', 'Schedule, kit, travel')}
        ${tile('#/plan', 'calplus', 'Plan day', 'Give tasks a time')}
        ${tile('', 'person', 'Contacts', 'Work and personal', true)}
        ${tile('', 'folder', 'Files', 'Attachments', true)}
      </section>
      <section class="stack" aria-label="Work and personal"><h2 class="h2" style="margin-bottom:4px">Work / personal split</h2>
        <div class="swrow"><div class="grow stack g4"><span id="sw-auto" class="b">Auto-switch by work hours</span><span class="small muted" style="line-height:1.35">Mon–Fri 08:00–18:00 opens on Work; evenings and weekends open on Personal</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${!!S.settings.autoSwitch}" aria-labelledby="sw-auto" data-a="toggleAuto"><span class="trk"><span class="kn"></span></span></button></div>
      </section>
      <section class="stack" aria-label="Coming next"><h2 class="h2" style="margin-bottom:4px">Coming next</h2>
        ${next.map(([a, b]) => `<div class="swrow"><span class="grow stack g4"><span class="b">${a}</span><span class="small muted">${b}</span></span><span class="pill">NEXT</span></div>`).join('')}
      </section>
      <section class="stack g10" aria-label="Your data"><h2 class="h2">Your data</h2>
        <p class="small muted" style="line-height:1.45">Everything is saved on this phone only. Export a backup now and then so nothing is lost if you delete the app.</p>
        <div class="grid2"><button type="button" class="btn" data-a="exportData">${icon('download', 18)}Export</button>
        <label class="btn" style="cursor:pointer">${icon('upload', 18)}Import<input type="file" accept="application/json,.json" class="sr" data-c="importData"></label></div>
        ${hasSamples() ? `<button type="button" class="btn" data-a="clearSamples">Remove sample data</button>` : ''}
        <button type="button" class="btn danger" data-a="resetApp">Reset app</button>
      </section>
      <p class="small muted" style="line-height:1.45">${standalone ? 'Running from your Home Screen.' : 'To install: tap Share in Safari, then “Add to Home Screen”. Use the icon from then on; Safari keeps its own separate copy of your data.'}</p>
    </main>`,
  };
};

/* notes */
VIEWS.notes = () => {
  const notes = S.notes.slice().sort((a, b) => b.created - a.created);
  return {
    html: `<div class="topbar">${backLink('#/more', 'More')}</div>
    <main class="main" style="padding-top:4px">
      <header class="stack g4"><span class="eyebrow">${notes.length} saved</span><h1 class="h1">Notes</h1></header>
      <form class="stack g10" data-f="addNote"><label for="nt" class="sr">New note</label><textarea id="nt" name="t" class="input" placeholder="Write a note…"></textarea>
      <div class="rowx g8"><input type="hidden" name="ctx" value="${ui.ctx === 'all' ? autoCtx() : ui.ctx}">
      <div class="rowx g6" data-group="ctx">${['work', 'personal'].map((c) => `<button type="button" class="chip soft" data-a="pick" data-v="${c}" aria-pressed="${(ui.ctx === 'all' ? autoCtx() : ui.ctx) === c}">${mk(c)}${LABEL[c]}</button>`).join('')}</div>
      <span class="grow"></span><button class="btn primary sm">Save note</button></div></form>
      <section class="stack">${notes.length ? notes.map((n) => `<div class="rowx g10" style="align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--line2)">
        <span class="mk ${n.ctx}" style="margin-top:7px"></span><span class="grow stack g6"><span style="font-size:15px;line-height:1.45;white-space:pre-wrap">${esc(n.text)}</span><span class="xs muted mono">${relDay(localISO(n.created))}</span></span>
        <button type="button" class="icon-btn plain" data-a="deleteNote" data-id="${n.id}" aria-label="Delete note">${icon('x', 18, 2)}</button></div>`).join('') : '<p class="empty">No notes yet.</p>'}</section>
    </main>`,
  };
};
const localISO = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* capture */
const EXAMPLES = ['Call venue Fri 10am #work', 'Order paint samples sat #personal', 'Note: projector in room B needs a new cable', 'Waiting on supplier for chair quote #work', 'Gym tomorrow 7am for 1h #personal'];
function capDerived() {
  const c = ui.cap;
  const p = parse(c.text, { projects: projectNames() });
  const type = c.type || (p.type === 'note' || p.type === 'waiting' ? p.type : p.time != null ? 'event' : (c.qtype || 'task'));
  const ctx = c.ctx || p.ctx || (ui.ctx !== 'all' ? ui.ctx : autoCtx());
  const ctxHint = c.ctx ? 'Set by you' : p.ctx ? 'From your #tag' : (ui.ctx !== 'all' ? 'Matches your current view' : 'Auto: based on the time of day');
  const date = p.date || c.qdate || (type === 'event' ? today() : null);
  let time = p.time ?? c.qtime ?? null;
  if (type === 'event' && time == null) time = Math.ceil((nowMin() + 1) / 60) * 60;
  const d = c.dur || p.dur || 60;
  const title = p.title || '';
  const project = p.project;
  const who = c.who != null ? c.who : (p.who || '');
  const location = c.location != null ? c.location : (p.location || '');
  return { p, type, ctx, ctxHint, date, time, dur: d, title, project, who, location };
}
function capDyn() {
  const c = ui.cap, d = capDerived();
  const rows = [['Title', d.title || '—']];
  if (d.type === 'event') rows.push(['When', `${relDay(d.date)} · ${hm(d.time)}–${hm(d.time + d.dur)}`]);
  if (d.type === 'task') rows.push(['Due', d.date ? relDay(d.date) + (d.time != null ? ' · ' + hm(d.time) : '') : 'No date · goes to Someday']);
  if (d.type === 'waiting') { rows.push(['From', d.who || '—']); rows.push(['Expected', d.date ? relDay(d.date) : 'No date']); }
  if (d.type !== 'note') rows.push(['Project', d.project || 'None']);
  const typeSeg = seg([{ id: 'task', label: 'Task' }, { id: 'event', label: 'Event' }, { id: 'note', label: 'Note' }, { id: 'waiting', label: 'Waiting' }], d.type, 'capType', 4, 'aria-label="Save as"');
  const extras = d.type === 'event'
    ? `<div class="field"><span class="lbl">Length</span><div class="rowx g6">${[30, 60, 90, 120].map((m) => `<button type="button" class="chip" data-a="capDur" data-v="${m}" aria-pressed="${d.dur === m}">${durShort(m).toLowerCase()}</button>`).join('')}</div></div>
       <div class="field"><label class="lbl" for="capLoc">Location (for Leave by)</label><input id="capLoc" class="input" data-i="capLoc" value="${esc(d.location)}" placeholder="Address or place" autocomplete="off"></div>`
    : d.type === 'waiting' ? `<div class="field"><label class="lbl" for="capWho">Waiting on</label><input id="capWho" class="input" data-i="capWho" value="${esc(d.who)}" placeholder="Person or company" autocomplete="off"></div>` : '';
  return `${typeSeg}
    <section class="card" style="padding:6px 16px" aria-label="What will be saved">
      ${rows.map(([k, v]) => `<div style="display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line2)"><span class="lbl">${k}</span><span class="b" style="font-size:15px;line-height:1.3">${esc(v)}</span></div>`).join('')}
      <div style="display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;align-items:center;padding:10px 0"><span class="lbl">Category</span>
      <div class="stack g6"><div class="rowx g6">${['work', 'personal'].map((x) => `<button type="button" class="chip soft" data-a="capCtx" data-v="${x}" aria-pressed="${d.ctx === x}">${mk(x)}${LABEL[x]}</button>`).join('')}</div><span class="xs muted">${d.ctxHint}</span></div></div>
    </section>
    ${extras}
    <section class="stack g10" aria-label="Examples"><h2 class="h2">Try</h2><div class="rowx g8" style="flex-wrap:wrap">${EXAMPLES.map((e, i) => `<button type="button" class="chip ex" data-a="capEx" data-v="${i}">${esc(e)}</button>`).join('')}</div></section>`;
}
const SAVE_LBL = { task: 'Add task', event: 'Add event', note: 'Save note', waiting: 'Track reply' };
VIEWS.capture = (r) => {
  if (!ui.cap || ui.cap.key !== location.hash) {
    const q = r.q;
    ui.cap = { key: location.hash, text: '', type: null, qtype: q.get('type'), ctx: null, qdate: q.get('date'), qtime: q.get('time') ? +q.get('time') : null, dur: null, location: null, who: null, saved: null };
  }
  const c = ui.cap, d = capDerived();
  return {
    after: () => { if (!c.saved) { const ta = app.querySelector('#cap'); if (ta && !ta.value) setTimeout(() => ta.focus(), 60); } },
    html: `<div class="topbar" style="display:grid;grid-template-columns:88px 1fr 88px"><button type="button" class="back" data-a="capCancel" style="padding:0 8px">Cancel</button>
      <h1 style="text-align:center;font-size:17px;font-weight:700;font-stretch:112%">Quick add</h1><span></span></div>
      <main class="main" style="padding-top:10px;gap:18px">
      <div class="field"><label for="cap" class="eyebrow">Type it the way you'd say it</label>
      <textarea id="cap" class="input big" rows="3" data-i="capText" placeholder="Call venue Fri 10am #work" enterkeyhint="done">${esc(c.text)}</textarea></div>
      <div id="capDyn" class="stack" style="gap:18px">${capDyn()}</div></main>
      <div class="bottombar" id="capBar">${c.saved
        ? `<div class="stack g12 grow"><div role="status" class="rowx g10 b"><span style="width:28px;height:28px;border-radius:14px;background:var(--ok);color:var(--bg);display:flex;align-items:center;justify-content:center;flex:none">${icon('check', 16, 3)}</span>${esc(c.saved)}</div>
           <div class="rowx g10"><button type="button" class="btn wide" data-a="capAgain">Add another</button><button type="button" class="btn primary wide" data-a="capCancel">Done</button></div></div>`
        : `<button type="button" class="btn" style="width:52px;padding:0;flex:none" data-a="capMic" aria-label="Dictate">${icon('mic')}</button>
           <button type="button" class="btn primary wide" style="height:52px" data-a="capSave" id="capSave">${SAVE_LBL[d.type]}</button>`}</div>`,
  };
};

/* waiting */
VIEWS.waiting = () => {
  const T = today();
  const live = S.waiting.filter((w) => !w.done);
  const shown = live.filter(keepCtx(ui.waitCtx));
  const grp = (w) => (w.expect && w.expect < T ? 'overdue' : w.expect ? 'soon' : 'nodate');
  const pill = (w) => { const g = grp(w); if (g === 'overdue') { const n = diffDays(w.expect, T); return `<span class="pill late">${n} DAY${n > 1 ? 'S' : ''} LATE</span>`; } if (g === 'soon') return `<span class="pill">DUE ${w.expect === T ? 'TODAY' : relDay(w.expect).toUpperCase()}</span>`; return '<span class="pill">NO DATE</span>'; };
  const verb = { email: 'Emailed', text: 'Texted', call: 'Asked on a call' };
  const nudgeHref = (w) => {
    const subj = 'Following up: ' + w.what, bodyTxt = `Hi,\n\nJust following up on this: ${w.what.charAt(0).toLowerCase() + w.what.slice(1)}.\n\nThanks`;
    if (w.via === 'text') return `sms:&body=${encodeURIComponent(bodyTxt)}`;
    if (w.via === 'call') return 'tel:';
    return `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(bodyTxt)}`;
  };
  const card = (w) => `<article class="card" style="padding:14px;border-radius:18px;display:flex;flex-direction:column;gap:10px">
    <div class="rowx g10"><span style="width:36px;height:36px;flex:none;border-radius:10px;background:var(--raise);display:flex;align-items:center;justify-content:center;color:var(--text2)">${icon({ email: 'mail', text: 'text', call: 'phone' }[w.via], 17)}</span>
    <span class="grow rowx g8" style="min-width:0">${mk(w.ctx)}<span class="b ellip">${esc(w.who || 'Someone')}</span></span>${pill(w)}</div>
    <button type="button" class="stack g4" style="text-align:left" data-a="openWaiting" data-id="${w.id}"><span style="font-size:16px;font-weight:600;line-height:1.3">${esc(w.what)}</span>
    <span class="small muted">${verb[w.via]} ${/^(Today|Yesterday)$/.test(relDay(w.sent)) ? relDay(w.sent).toLowerCase() : relDay(w.sent)}${w.auto ? ' · auto-added from sent mail' : ''}${w.nudged ? ' · nudged ' + relDay(w.nudged).toLowerCase() : ''}</span></button>
    <div class="rowx g8"><a class="btn sm wide" href="${nudgeHref(w)}" data-a="nudge" data-id="${w.id}" ${w.nudged ? 'style="color:var(--ok);border-color:#2E4A33"' : ''}>${w.nudged ? 'Nudge again' : 'Nudge'}</a>
    <button type="button" class="btn sm primary wide" data-a="gotReply" data-id="${w.id}">Got a reply</button></div></article>`;
  const groups = [['overdue', 'Overdue', 'color:var(--alert)'], ['soon', 'Expected soon', ''], ['nodate', 'No date', '']]
    .map(([g, label, st]) => { const items = shown.filter((w) => grp(w) === g).sort((a, b) => (a.expect || '').localeCompare(b.expect || '')); return items.length ? `<section class="stack g10"><h2 class="h2" style="${st}">${label}</h2>${items.map(card).join('')}</section>` : ''; }).join('');
  const overdue = live.filter((w) => grp(w) === 'overdue').length;
  return {
    tab: 'tasks',
    html: `<div class="topbar">${backLink('#/tasks', 'Tasks')}<a class="icon-btn" href="#/capture?type=waiting" aria-label="Track a reply">${icon('plus', 20, 2)}</a></div>
    <main class="main" style="padding-top:4px;gap:18px">
      <header class="stack g6"><span class="eyebrow">${live.length} open · ${overdue} overdue</span><h1 class="h1 sm">Waiting on</h1>
      <p class="small muted" style="line-height:1.4">Replies you’re owed. Nudge opens a ready-to-send follow-up.</p></header>
      ${ctxSeg(ui.waitCtx, 'waitCtx')}
      ${groups || '<p class="empty">Nobody owes you anything. Enjoy it.</p>'}
    </main>`,
  };
};

/* event weekend */
function blankWeekend() {
  const li = (label) => ({ id: uid(), label, done: false });
  const T = today(); const d = fromISO(T); let toFri = (5 - d.getDay() + 7) % 7; if (toFri < 1) toFri += 7;
  return {
    id: uid(), name: 'New event', track: '', start: addDays(T, toFri), hotel: '', conf: '', gate: '', gateNote: '', leave: '', drive: '',
    days: [{ label: 'Friday', items: [] }, { label: 'Saturday', items: [] }, { label: 'Sunday', items: [] }],
    lists: [
      { id: uid(), name: 'Equipment', items: ['Laptop and charger', 'Chargers and cables', 'Power bank'].map(li) },
      { id: uid(), name: 'Paperwork', items: ['Tickets or passes', 'Booking confirmations', 'ID'].map(li) },
      { id: uid(), name: 'Personal packing', items: ['Rain jacket', 'Comfortable shoes', 'Phone charger', 'Water bottle'].map(li) },
    ],
    contacts: ['Event lead', 'Venue manager', 'Hotel front desk', 'Transport'].map((role) => ({ id: uid(), role, name: '', phone: '' })),
  };
}
VIEWS.weekend = () => {
  const w = S.weekends[0];
  if (!w) return { tab: 'calendar', html: `<div class="topbar">${backLink('#/more', 'More')}</div><main class="main"><h1 class="h1 sm">Event weekend</h1><p class="empty">No event weekend set up.</p><button type="button" class="btn primary" data-a="wkCreate">Set one up</button></main>` };
  const day = w.days[ui.wkDay] || w.days[0];
  const items = day.items.slice().sort((a, b) => a.t - b.t);
  const lists = w.lists.map((l) => {
    const done = l.items.filter((i) => i.done).length, total = l.items.length, complete = total && done === total, open = ui.wkOpen === l.id;
    return `<div class="card" style="border-radius:18px;overflow:hidden">
      <button type="button" style="width:100%;text-align:left;padding:14px 16px;display:flex;align-items:center;gap:14px;min-height:64px" data-a="wkToggleList" data-id="${l.id}" aria-expanded="${open}">
      <span class="grow stack g8"><span class="rowx between g8"><span class="b" style="font-size:16px">${esc(l.name)}</span><span class="mono xs" style="color:${complete ? 'var(--ok)' : 'var(--muted)'}">${done}/${total}</span></span>
      <span class="bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%;background:${complete ? 'var(--ok)' : 'var(--text)'}"></i></span></span>
      <span style="flex:none;${open ? 'transform:rotate(180deg)' : ''}">${icon('down', 18, 2)}</span></button>
      ${open ? `<div style="padding:0 16px 10px;border-top:1px solid var(--line2)">${l.items.map((i) => `<div class="rowx g6"><button type="button" class="chk grow" style="width:auto;min-height:46px;gap:12px;justify-content:flex-start;text-align:left" data-a="wkItem" data-id="${l.id}" data-v="${i.id}" aria-pressed="${i.done}">
          <span class="box" style="width:22px;height:22px;border-radius:6px;flex:none">${i.done ? icon('check', 14, 3) : ''}</span><span style="font-size:15px;${i.done ? 'color:var(--faint);text-decoration:line-through' : ''}">${esc(i.label)}</span></button>
          <button type="button" class="icon-btn plain" style="width:36px;height:36px" data-a="wkItemDel" data-id="${l.id}" data-v="${i.id}" aria-label="Remove ${esc(i.label)}">${icon('x', 14, 2)}</button></div>`).join('')}
        <form class="rowx g8" style="padding-top:6px" data-f="wkListAdd" data-id="${l.id}"><label class="sr" for="li-${l.id}">Add item</label><input id="li-${l.id}" name="t" class="input" style="height:44px" placeholder="Add item" autocomplete="off"><button class="btn sm" aria-label="Add item">${icon('plus', 18, 2)}</button></form></div>` : ''}</div>`;
  }).join('');
  const startD = fromISO(w.start);
  const row = (ic, a, b) => `<div class="rowx g14" style="padding:12px 0;border-bottom:1px solid var(--line2)"><span class="t2">${icon(ic, 20)}</span><span class="stack g4"><span class="b">${esc(a)}</span>${b ? `<span class="small muted">${esc(b)}</span>` : ''}</span></div>`;
  return {
    tab: 'calendar',
    html: `<div class="topbar">${backLink('#/more', 'More')}<span class="pill ok" style="margin-right:6px">${icon('download', 12, 2.4, 'style="vertical-align:-2px"')} SAVED ON PHONE</span></div>
    <main class="main" style="padding-top:4px">
      <header class="stack g8"><span class="rowx g8 eyebrow">${mk('work')}Event weekend · ${relDay(w.start)}</span>
      <h1 class="h1" style="font-weight:800">${esc(w.name)}</h1><span class="t2">${esc(w.track || '[Venue]')} · ${WD[startD.getDay()]} ${startD.getDate()} ${MONL[startD.getMonth()]}</span>
      <button type="button" class="btn sm" style="align-self:flex-start;margin-top:4px" data-a="wkEdit">${icon('edit', 16, 2)}Edit details</button></header>
      <section class="stack g10" aria-label="Schedule">${seg(w.days.map((d, i) => ({ id: String(i), label: d.label })), String(ui.wkDay), 'wkDay', w.days.length, 'aria-label="Day"')}
        <div class="stack">${items.length ? items.map((i) => `<div class="rowx g12" style="padding:9px 0;border-bottom:1px solid var(--line2)"><span class="mono small" style="width:46px">${hm(i.t)}</span><span class="grow stack g4"><span class="b">${esc(i.title)}</span>${i.where ? `<span class="small muted">${esc(i.where)}</span>` : ''}</span>
          <button type="button" class="icon-btn plain" style="width:36px;height:36px" data-a="wkDelItem" data-v="${i.id}" aria-label="Remove ${esc(i.title)}">${icon('x', 14, 2)}</button></div>`).join('') : '<p class="small muted" style="padding:8px 0">Nothing scheduled.</p>'}
        <form class="rowx g8" style="padding-top:10px" data-f="wkAdd"><label class="sr" for="wkt">Time</label><input id="wkt" name="time" type="time" class="input" style="width:128px;height:44px;flex:none" value="09:00">
        <label class="sr" for="wki">What</label><input id="wki" name="t" class="input" style="height:44px" placeholder="Add to ${esc(day.label)}" autocomplete="off"><button class="btn sm" aria-label="Add">${icon('plus', 18, 2)}</button></form></div></section>
      <section class="stack g10" aria-label="Checklists"><div class="rowx between"><h2 class="h2">Checklists</h2><button type="button" class="link" data-a="wkReset">Untick all</button></div>${lists}</section>
      <section class="stack" aria-label="Travel and stay"><h2 class="h2" style="margin-bottom:4px">Travel &amp; stay</h2>
        ${row('car', 'Leave ' + (w.leave || '[time]'), 'Drive · ' + (w.drive || '[drive time]'))}${row('bed', w.hotel || '[Hotel]', 'Confirmation ' + (w.conf || '—'))}${row('badge', w.gate || '[Gate / parking]', w.gateNote)}
        ${w.track ? `<a class="btn" style="margin-top:12px" href="https://maps.apple.com/?daddr=${encodeURIComponent(w.track)}">${icon('nav', 18, 2)}Directions to ${esc(w.track)}</a>` : ''}</section>
      <section class="stack" aria-label="Key contacts"><h2 class="h2" style="margin-bottom:4px">Key contacts</h2>
        ${w.contacts.map((c) => `<div class="rowx g10" style="padding:8px 0;border-bottom:1px solid var(--line2)"><span class="grow stack g4"><span class="b">${esc(c.role)}</span><span class="small muted">${esc(c.name || 'Add name and number')}${c.phone ? ' · ' + esc(c.phone) : ''}</span></span>
          ${c.phone ? `<a class="icon-btn" href="sms:${esc(c.phone)}" aria-label="Text ${esc(c.role)}">${icon('text', 18)}</a><a class="icon-btn" style="background:var(--text);color:var(--bg);border-color:var(--text)" href="tel:${esc(c.phone)}" aria-label="Call ${esc(c.role)}">${icon('phone', 18)}</a>`
            : `<button type="button" class="btn sm" data-a="wkEdit">Add</button>`}</div>`).join('')}</section>
    </main>`,
  };
};

/* plan day */
const PLAN = { H: 64, END: 23 * 60, FREE_END: 22 * 60 };
function planCtx() {
  const day = today(), nm = nowMin();
  const START = Math.max(6 * 60, Math.floor((nm - 30) / 60) * 60);
  const FIRST = Math.ceil((nm + 5) / 30) * 30;
  const busy = (skipId) => S.events.filter((e) => e.date === day).map((e) => [e.start, e.start + e.dur])
    .concat(S.tasks.filter((t) => t.sched && t.sched.date === day && t.id !== skipId && !t.done).map((t) => [t.sched.start, t.sched.start + (t.est || 30)]));
  const fits = (st, d, skip) => st + d <= PLAN.END && busy(skip).every((b) => st + d <= b[0] || st >= b[1]);
  return { day, nm, START, FIRST, fits };
}
function planSlots(id) {
  const P = planCtx(); const t = byId(S.tasks, id); if (!t) return '';
  let out = '';
  for (let st = P.FIRST; st < PLAN.END; st += 30) if (P.fits(st, t.est || 30, id))
    out += `<button type="button" class="slot" style="top:${(st - P.START) / 60 * PLAN.H + 2}px" data-a="planDrop" data-v="${st}" aria-label="Schedule at ${hm(st)}">+ ${hm(st)}</button>`;
  return out;
}
VIEWS.plan = () => {
  const P = planCtx(), T = P.day;
  const open = S.tasks.filter((t) => !t.done && !(t.sched && t.sched.date === T));
  const dueNow = open.filter((t) => t.due && t.due <= T);
  const tray = (ui.plan.all ? open : dueNow).slice().sort(taskSort);
  if (ui.plan.sel && !tray.some((t) => t.id === ui.plan.sel)) ui.plan.sel = null;
  let free = 0; for (let st = P.FIRST; st < PLAN.FREE_END; st += 30) if (P.fits(st, 30, null)) free += 30;
  const H = PLAN.H, top = (m) => (m - P.START) / 60 * H;
  let hours = ''; for (let m = P.START; m <= PLAN.END; m += 60) hours += `<div class="tl-h" style="top:${top(m)}px"><span>${hm(m)}</span><i></i></div>`;
  const evs = S.events.filter((e) => e.date === T && e.start + e.dur > P.START).map((e) => `<button type="button" class="tl-ev ${e.ctx}" style="left:56px;right:0;top:${top(Math.max(e.start, P.START)) + 2}px;height:${Math.max((e.start + e.dur - Math.max(e.start, P.START)) / 60 * H - 4, 22)}px" data-a="openEvent" data-id="${e.id}"><span class="t">${mk(e.ctx)}<span class="ellip">${esc(e.title)}</span></span><span class="r">${hm(e.start)}–${hm(e.start + e.dur)}</span></button>`).join('');
  const placed = S.tasks.filter((t) => t.sched && t.sched.date === T && t.sched.start + (t.est || 30) > P.START).map((t) => `<div class="tl-task ${t.ctx} ${t.done ? 'done' : ''}" style="left:56px;right:0;top:${top(t.sched.start) + 2}px;height:${Math.max((t.est || 30) / 60 * H - 4, 26)}px">
    <button type="button" class="grow stack g4" style="text-align:left;min-width:0" data-a="openTask" data-id="${t.id}"><span class="rowx g8"><span class="tasktag">TASK</span><span class="t small b ellip">${esc(t.title)}</span></span>${(t.est || 30) >= 45 ? `<span class="mono" style="font-size:11px;color:var(--text2)">${hm(t.sched.start)}–${hm(t.sched.start + (t.est || 30))}</span>` : ''}</button>
    <button type="button" class="icon-btn plain" style="width:40px;height:40px;color:var(--muted)" data-a="unsched" data-id="${t.id}" aria-label="Unschedule ${esc(t.title)}">${icon('x', 16, 2.2)}</button></div>`).join('');
  const cards = tray.map((t) => `<button type="button" class="tcard" data-a="planPick" data-id="${t.id}" aria-pressed="${ui.plan.sel === t.id}">
    <span class="rowx g8" style="align-items:flex-start"><span class="mk ${t.ctx}" style="margin-top:5px"></span><span style="font-size:14px;font-weight:600;line-height:1.3">${esc(t.title)}</span></span>
    <span class="rowx between g6"><span class="mono" style="font-size:11px;font-weight:600;color:${t.due && t.due < T ? 'var(--alert)' : 'var(--text2)'}">${durShort(t.est || 30)}${t.due && t.due < T ? ' · LATE' : ''}</span><span style="color:var(--dim)">${icon('dots', 16)}</span></span></button>`).join('');
  const others = open.length - dueNow.length;
  return {
    tab: 'tasks',
    after: planAfter,
    initScroll: 0,
    html: `<div style="padding:calc(var(--st) + 6px) 20px 14px;border-bottom:1px solid var(--line)" class="stack g12">
      ${backLink('#/tasks', 'Tasks')}
      <header class="stack g4" style="margin-top:-6px"><span class="eyebrow">${dayShort(T)} · ${dur(free)} free</span><h1 class="h1 sm">Plan today</h1></header>
      <div class="rowx between"><h2 class="h2">${ui.plan.all ? 'All open' : 'Due'} · ${tray.length}</h2><span class="xs" style="color:${ui.plan.sel ? 'var(--text)' : 'var(--muted)'};font-weight:${ui.plan.sel ? 600 : 400}">${ui.plan.sel ? 'Now tap a time' : 'Hold and drag, or tap'}</span></div>
      <div class="tray">${cards || `<div class="empty" style="flex:1;padding:16px">${ui.plan.all ? 'Nothing left to schedule.' : 'Everything due has a time.'}</div>`}</div>
      ${others > 0 || ui.plan.all ? `<button type="button" class="link" style="align-self:flex-start;min-height:32px" data-a="planAll">${ui.plan.all ? 'Show only tasks due' : `Show all open tasks (${others} more)`}</button>` : ''}</div>
      <main class="main" style="padding-top:16px"><div class="tl" style="height:${top(PLAN.END) + 10}px">${hours}
        <div class="hatch" style="height:${Math.max(0, top(P.nm))}px" aria-hidden="true"></div>${evs}${placed}
        ${ui.plan.sel ? planSlots(ui.plan.sel) : ''}
        <div class="tl-now" style="top:${top(P.nm)}px"><b>${hm(P.nm)}</b><i></i></div></div></main>`,
  };
};
function schedule(id, start) {
  const t = byId(S.tasks, id); if (!t) return;
  const prev = t.sched;
  t.sched = { date: today(), start };
  ui.plan.sel = null;
  save(); render();
  toast(`Scheduled at ${hm(start)}`, () => { t.sched = prev; save(); render(); });
}
const drag = { active: false, justDropped: 0 };
document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
function planAfter() {
  const main = app.querySelector('.main'), tl = app.querySelector('.tl');
  app.querySelectorAll('.tcard').forEach((card) => {
    card.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      const id = card.dataset.id, sx = ev.clientX, sy = ev.clientY, mouse = ev.pointerType === 'mouse';
      let started = false, cancelled = false, ghost = null, hot = null, lastY = sy, scrollTimer = null;
      const timer = mouse ? null : setTimeout(() => { if (!cancelled) begin(sx, sy); }, 230);
      function begin(x, y) {
        started = true; drag.active = true;
        card.classList.add('lifting');
        tl.querySelectorAll('.slot').forEach((s) => s.remove());
        tl.insertAdjacentHTML('beforeend', planSlots(id));
        ghost = card.cloneNode(true); ghost.classList.add('ghost'); ghost.classList.remove('lifting'); ghost.style.width = card.offsetWidth + 'px';
        document.body.appendChild(ghost);
        place(x, y);
        if (navigator.vibrate) navigator.vibrate(10);
        scrollTimer = setInterval(() => {
          const r = main.getBoundingClientRect();
          if (lastY > r.bottom - 70) main.scrollTop += 10; else if (lastY < r.top + 50 && lastY > r.top - 200) main.scrollTop -= 10;
        }, 16);
      }
      function place(x, y) {
        lastY = y;
        ghost.style.left = x + 'px'; ghost.style.top = y + 'px';
        const el = document.elementFromPoint(x, y); const slot = el && el.closest('.slot');
        if (hot !== slot) { if (hot) hot.classList.remove('hot'); hot = slot; if (hot) hot.classList.add('hot'); }
      }
      function move(e) {
        const dx = e.clientX - sx, dy = e.clientY - sy, dist = Math.hypot(dx, dy);
        if (!started) {
          if (mouse && dist > 6) begin(e.clientX, e.clientY);
          else if (!mouse && dist > 8) { if (Math.abs(dy) > Math.abs(dx)) begin(e.clientX, e.clientY); else { cancelled = true; cleanup(); } }
          return;
        }
        place(e.clientX, e.clientY);
      }
      function up() {
        const target = hot ? +hot.dataset.v : null;
        const wasStarted = started;
        cleanup();
        if (wasStarted) {
          drag.justDropped = Date.now();
          if (target != null) schedule(id, target);
          else { tl.querySelectorAll('.slot').forEach((s) => s.remove()); card.classList.remove('lifting'); }
        }
      }
      function cleanup() {
        clearTimeout(timer); clearInterval(scrollTimer);
        drag.active = false;
        if (ghost) ghost.remove();
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      }
      function cancel() { const s = started; cleanup(); if (s) { tl.querySelectorAll('.slot').forEach((x) => x.remove()); card.classList.remove('lifting'); } }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    });
    card.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

/* leave by */
const MODES = { drive: ['Drive', 'd', 'driving'], transit: ['Transit', 'r', 'transit'], bike: ['Bike', null, 'bicycling'], walk: ['Walk', 'w', 'walking'] };
VIEWS.trip = (r) => {
  const e = byId(S.events, r.id);
  if (!e) return VIEWS.today();
  if (!e.travel) e.travel = { mode: 'drive', mins: {} };
  const mode = e.travel.mode, mins = e.travel.mins[mode];
  const nm = nowMin(), T = today();
  const lv = mins != null ? e.start - (e.early || 0) - mins : null;
  const until = lv != null && e.date === T ? lv - nm : null;
  const dest = encodeURIComponent(e.location || '');
  const apple = `https://maps.apple.com/?daddr=${dest}${MODES[mode][1] ? '&dirflg=' + MODES[mode][1] : ''}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${MODES[mode][2]}`;
  return {
    tab: 'today',
    html: `<div class="topbar">${backLink('#/today', 'Today')}<button type="button" class="btn sm" data-a="openEvent" data-id="${e.id}">Edit event</button></div>
    <main class="main" style="padding-top:4px;gap:20px">
      <header class="stack g6"><span class="eyebrow" style="color:var(--pers)">Leave by${until != null ? (until >= 0 ? ' · in ' + dur(until) : ' · ' + dur(-until) + ' ago') : e.date !== T ? ' · ' + relDay(e.date) : ''}</span>
      <span class="mono" style="font-size:72px;line-height:.95;font-weight:500;letter-spacing:-.03em">${lv != null ? hm(lv) : '--:--'}</span>
      <span class="t2">Arrive ${hm(e.start - (e.early || 0))} · ${mins != null ? dur(mins) + ' ' + MODES[mode][0].toLowerCase() : 'set your travel time below'}</span></header>
      <div class="card rowx g12" style="padding:14px 16px;border-radius:18px">${mk(e.ctx)}<span class="grow stack g4"><span class="b" style="font-size:16px">${esc(e.title)}</span><span class="small muted">${relDay(e.date)} · ${hm(e.start)}–${hm(e.start + e.dur)} · ${esc(e.location || 'No location')}</span></span></div>
      <div class="grid2"><a class="btn primary" href="${apple}">${icon('nav', 18, 2)}Apple Maps</a><a class="btn" href="${google}">Google Maps</a></div>
      <p class="small muted" style="line-height:1.45;margin-top:-8px">Maps opens with live traffic. Check the time there, then set it here. Once Google Maps is connected this updates on its own.</p>
      ${seg(Object.keys(MODES).map((k) => ({ id: k, label: MODES[k][0], count: e.travel.mins[k] != null ? dur(e.travel.mins[k]).replace(' min', 'm').replace(' h', 'h') : '' })), mode, 'tripMode', 4, 'aria-label="Travel mode"')}
      <section class="stack g8" aria-label="Travel time"><h2 class="h2">${MODES[mode][0]} time</h2>
        <div class="rowx g10"><button type="button" class="icon-btn" style="width:52px;height:52px;border-radius:14px" data-a="tripMin" data-v="-5" aria-label="5 minutes less">−</button>
        <span class="grow mono" style="text-align:center;font-size:28px;font-weight:500">${mins != null ? dur(mins) : '—'}</span>
        <button type="button" class="icon-btn" style="width:52px;height:52px;border-radius:14px" data-a="tripMin" data-v="5" aria-label="5 minutes more">+</button></div></section>
      <section class="stack g8" aria-label="Arrive early"><h2 class="h2">Arrive early by</h2>
        <div class="rowx g6">${[0, 5, 10, 15].map((b) => `<button type="button" class="chip" style="flex:1;justify-content:center" data-a="tripEarly" data-v="${b}" aria-pressed="${(e.early || 0) === b}">${b ? b + ' min' : 'On time'}</button>`).join('')}</div></section>
    </main>`,
  };
};

/* ---------- sheets ---------- */
function renderSheet() {
  const sh = ui.sheet; let inner = '';
  if (sh.type === 'task') inner = taskSheet(sh);
  else if (sh.type === 'event') inner = sh.edit ? eventEditSheet(sh) : eventSheet(sh);
  else if (sh.type === 'mk') inner = mkSheet(sh);
  else if (sh.type === 'waiting') inner = waitingSheet(sh);
  else if (sh.type === 'wk') inner = wkSheet();
  return `<div class="backdrop" data-a="closeSheet"></div><section class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${inner}</section>`;
}
const sheetHead = (title, sub) => `<div class="rowx between" style="align-items:flex-start;gap:12px"><div class="stack g4"><h2 style="font-size:22px;font-weight:750;font-stretch:115%">${esc(title)}</h2>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>
  <button type="button" class="icon-btn plain" style="margin:-6px -10px 0 0" data-a="closeSheet" aria-label="Close">${icon('x', 20, 2)}</button></div>`;
const ctxPicker = (cur) => `<div class="field"><span class="lbl">Category</span><input type="hidden" name="ctx" value="${cur}"><div class="rowx g6" data-group="ctx">${['work', 'personal'].map((c) => `<button type="button" class="chip soft" data-a="pick" data-v="${c}" aria-pressed="${cur === c}">${mk(c)}${LABEL[c]}</button>`).join('')}</div></div>`;
const EST = [15, 30, 45, 60, 90, 120, 180, 240];

function taskSheet(sh) {
  const t = byId(S.tasks, sh.id); if (!t) return '';
  const src = t.src && byId(S.messages, t.src.msg);
  return `${sheetHead(sh.isNew ? 'New task' : 'Task')}
  <form class="stack g14" data-f="saveTask" data-id="${t.id}">
    <div class="field"><label class="lbl" for="tt">Title</label><input id="tt" name="title" class="input" value="${esc(t.title)}" autocomplete="off"></div>
    ${ctxPicker(t.ctx)}
    <div class="grid2"><div class="field"><label class="lbl" for="tdue">Due</label><input id="tdue" name="due" type="date" class="input" value="${t.due || ''}"></div>
    <div class="field"><label class="lbl" for="test">Takes about</label><select id="test" name="est" class="input">${EST.map((m) => `<option value="${m}" ${(t.est || 30) === m ? 'selected' : ''}>${dur(m)}</option>`).join('')}</select></div></div>
    <div class="field"><label class="lbl" for="tproj">Project</label><input id="tproj" name="project" class="input" list="projlist" value="${esc(t.project || '')}" placeholder="None" autocomplete="off"><datalist id="projlist">${projectNames().map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
    ${t.sched ? `<div class="rowx between card" style="padding:10px 14px;border-radius:14px"><span class="small">Scheduled ${relDay(t.sched.date).toLowerCase()} at ${hm(t.sched.start)}</span><button type="button" class="btn sm" data-a="unsched" data-id="${t.id}">Unschedule</button></div>` : ''}
    ${src ? `<a class="btn" href="#/message/${src.id}">${icon('mail', 18)}Open the email</a>` : ''}
    <div class="rowx g8"><button type="button" class="btn danger" data-a="deleteTask" data-id="${t.id}" aria-label="Delete task">${icon('trash', 18)}</button><button class="btn primary wide">Save</button></div>
  </form>`;
}
function eventSheet(sh) {
  const e = byId(S.events, sh.id); if (!e) return '';
  const lv = leaveAt(e);
  return `${sheetHead(e.title, `${relDay(e.date)} · ${hm(e.start)}–${hm(e.start + e.dur)}`)}
    <div class="stack g8">${e.location ? `<span class="rowx g8 t2">${icon('pin', 18)}${esc(e.location)}</span>` : ''}<span class="rowx g8 small t2">${mk(e.ctx)}${LABEL[e.ctx]} · ${dur(e.dur)}</span></div>
    ${e.location && !isVideo(e.location) ? `<a class="btn primary" href="#/trip/${e.id}">${icon('car', 18)}${lv != null ? 'Leave by ' + hm(lv) : 'Set up Leave by'}</a>` : ''}
    <div class="rowx g8"><button type="button" class="btn danger" data-a="deleteEvent" data-id="${e.id}" aria-label="Delete event">${icon('trash', 18)}</button><button type="button" class="btn wide" data-a="editEvent" data-id="${e.id}">${icon('edit', 18)}Edit</button></div>`;
}
function eventEditSheet(sh) {
  const e = byId(S.events, sh.id); if (!e) return '';
  const durs = [15, 30, 45, 60, 90, 120, 180, 240, 300, 480];
  if (!durs.includes(e.dur)) durs.push(e.dur);
  return `${sheetHead(sh.isNew ? 'New event' : 'Edit event')}
  <form class="stack g14" data-f="saveEvent" data-id="${e.id}">
    <div class="field"><label class="lbl" for="et">Title</label><input id="et" name="title" class="input" value="${esc(e.title)}" autocomplete="off"></div>
    ${ctxPicker(e.ctx)}
    <div class="grid2"><div class="field"><label class="lbl" for="ed">Date</label><input id="ed" name="date" type="date" class="input" value="${e.date}" required></div>
    <div class="field"><label class="lbl" for="es">Starts</label><input id="es" name="start" type="time" class="input" value="${hm(e.start)}" required></div></div>
    <div class="field"><label class="lbl" for="edur">Length</label><select id="edur" name="dur" class="input">${durs.sort((a, b) => a - b).map((m) => `<option value="${m}" ${e.dur === m ? 'selected' : ''}>${dur(m)}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="eloc">Location</label><input id="eloc" name="location" class="input" value="${esc(e.location || '')}" placeholder="Address, place or “Video call”" autocomplete="off"></div>
    <div class="rowx g8"><button type="button" class="btn" data-a="closeSheet">Cancel</button><button class="btn primary wide">Save</button></div>
  </form>`;
}
function mkSheet(sh) {
  const m = byId(S.messages, sh.id); if (!m) return '';
  if (sh.done) {
    return `<div role="status" class="stack g16"><div class="rowx g12"><span style="width:40px;height:40px;border-radius:20px;background:var(--ok);color:var(--bg);display:flex;align-items:center;justify-content:center;flex:none">${icon('check', 20, 3)}</span>
      <span class="stack g4"><span class="b" style="font-size:18px">${sh.done === 1 ? 'Task created' : sh.done + ' tasks created'}</span><span class="small muted">Linked to this ${m.type === 'email' ? 'email' : 'message'}</span></span></div>
      <div class="rowx g8"><a class="btn wide" href="#/inbox">Back to inbox</a><a class="btn primary wide" href="#/plan">Give it a time</a></div></div>`;
  }
  const proj = parse((m.subj || '') + ' ' + m.body, { projects: projectNames() }).project;
  return `${sheetHead('Make it a task', sh.items.length > 1 ? `${sh.items.length} requests found · the ${m.type === 'email' ? 'email' : 'message'} stays linked` : `The ${m.type === 'email' ? 'email' : 'message'} stays linked`)}
  <form class="stack g12" data-f="mkCreate" data-id="${m.id}">
    ${sh.items.map((it, i) => `<div class="card stack g10" style="padding:12px 14px;border-radius:16px">
      <div class="rowx g8"><label class="rowx g10 grow" style="min-height:36px"><input type="checkbox" name="on${i}" ${it.on ? 'checked' : ''} style="width:22px;height:22px;accent-color:#F2F0EB"><span class="lbl">Include</span></label></div>
      <label class="sr" for="mt${i}">Task</label><input id="mt${i}" name="t${i}" class="input" value="${esc(it.title)}" autocomplete="off">
      <div class="rowx g8"><label class="lbl" for="md${i}" style="width:40px">Due</label><input id="md${i}" name="d${i}" type="date" class="input" style="height:44px" value="${it.date || ''}"></div></div>`).join('')}
    <div class="rowx g8" style="flex-wrap:wrap"><span class="tag">${mk(m.ctx)}${LABEL[m.ctx]}</span>${proj ? `<span class="tag">${esc(proj)}</span>` : ''}<span class="tag">${icon('link', 14, 2)}Linked</span></div>
    <button class="btn primary" style="height:54px">Create task${sh.items.length > 1 ? 's' : ''}</button>
  </form>`;
}
function waitingSheet(sh) {
  const w = byId(S.waiting, sh.id); if (!w) return '';
  return `${sheetHead('Waiting on')}
  <form class="stack g14" data-f="saveWaiting" data-id="${w.id}">
    <div class="field"><label class="lbl" for="ww">Who</label><input id="ww" name="who" class="input" value="${esc(w.who)}" autocomplete="off"></div>
    <div class="field"><label class="lbl" for="wwhat">For what</label><input id="wwhat" name="what" class="input" value="${esc(w.what)}" autocomplete="off"></div>
    ${ctxPicker(w.ctx)}
    <div class="grid2"><div class="field"><label class="lbl" for="wvia">Asked by</label><select id="wvia" name="via" class="input">${['email', 'text', 'call'].map((v) => `<option value="${v}" ${w.via === v ? 'selected' : ''}>${cap(v)}</option>`).join('')}</select></div>
    <div class="field"><label class="lbl" for="wexp">Expected by</label><input id="wexp" name="expect" type="date" class="input" value="${w.expect || ''}"></div></div>
    <div class="rowx g8"><button type="button" class="btn danger" data-a="deleteWaiting" data-id="${w.id}" aria-label="Delete">${icon('trash', 18)}</button><button class="btn primary wide">Save</button></div>
  </form>`;
}
function wkSheet() {
  const w = S.weekends[0]; if (!w) return '';
  const f = (name, label, val, ph, type = 'text') => `<div class="field"><label class="lbl" for="wk-${name}">${label}</label><input id="wk-${name}" name="${name}" type="${type}" class="input" value="${esc(val || '')}" placeholder="${esc(ph || '')}" autocomplete="off"></div>`;
  return `${sheetHead('Event details')}
  <form class="stack g14" data-f="saveWk">
    ${f('name', 'Event name', w.name)}${f('track', 'Venue / location', w.track, 'Used for directions')}${f('start', 'First day', w.start, '', 'date')}
    <div class="grid2">${f('leave', 'Leave', w.leave, 'Thu 14:00')}${f('drive', 'Drive time', w.drive, '2 h 30 min')}</div>
    ${f('hotel', 'Hotel', w.hotel)}${f('conf', 'Confirmation #', w.conf)}${f('gate', 'Gate / parking', w.gate)}${f('gateNote', 'Parking note', w.gateNote)}
    <h3 class="h2" style="margin-top:6px">Contacts</h3>
    ${w.contacts.map((c, i) => `<div class="card stack g8" style="padding:12px;border-radius:14px"><span class="b">${esc(c.role)}</span><div class="grid2">
      <input name="cn${i}" class="input" style="height:44px" value="${esc(c.name)}" placeholder="Name" aria-label="${esc(c.role)} name" autocomplete="off">
      <input name="cp${i}" class="input" style="height:44px" type="tel" value="${esc(c.phone)}" placeholder="Phone" aria-label="${esc(c.role)} phone" autocomplete="off"></div></div>`).join('')}
    <div class="rowx g8"><button type="button" class="btn danger" data-a="wkDelete" aria-label="Delete event weekend">${icon('trash', 18)}</button><button class="btn primary wide">Save</button></div>
  </form>`;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, undo) {
  ui.toast = { msg, undo };
  const old = app.querySelector('.toast'); if (old) old.remove();
  app.insertAdjacentHTML('beforeend', toastHTML());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; const t = app.querySelector('.toast'); if (t) t.remove(); }, 4200);
}
const toastHTML = () => `<div class="toast" role="status"><span class="grow">${esc(ui.toast.msg)}</span>${ui.toast.undo ? '<button type="button" data-a="undo">Undo</button>' : ''}</div>`;

/* ---------- actions ---------- */
const A = {
  setCtx: (el) => { ui.ctx = el.dataset.v; render(); },
  waitCtx: (el) => { ui.waitCtx = el.dataset.v; render(); },
  taskList: (el) => { ui.taskList = el.dataset.v; render(); },
  filterProject: (el) => { ui.taskProject = el.dataset.v && ui.taskProject !== el.dataset.v ? el.dataset.v : null; render(); },
  inboxFilter: (el) => { ui.inboxFilter = el.dataset.v; render(); },
  calDay: (el) => { ui.calDay = el.dataset.v; delete scrollMem[location.hash]; render(); },
  calWeek: (el) => { ui.calDay = addDays(ui.calDay, +el.dataset.v); delete scrollMem[location.hash]; render(); },
  newAt: (el) => { go(`#/capture?type=event&date=${ui.calDay}&time=${el.dataset.v}`); },
  toggleTask: (el) => { const t = byId(S.tasks, el.dataset.id); t.done = !t.done; t.doneAt = t.done ? today() : null; save(); render(); if (t.done) toast('Done', () => { t.done = false; t.doneAt = null; save(); render(); }); },
  openTask: (el) => { ui.sheet = { type: 'task', id: el.dataset.id }; render(); },
  openEvent: (el) => { ui.sheet = { type: 'event', id: el.dataset.id }; render(); },
  editEvent: (el) => { ui.sheet = { type: 'event', id: el.dataset.id, edit: true }; render(); },
  openWaiting: (el) => { ui.sheet = { type: 'waiting', id: el.dataset.id }; render(); },
  closeSheet: () => { const sh = ui.sheet; ui.sheet = null; if (sh && sh.isNew && sh.type === 'event') { /* nothing saved */ } render(); },
  pick: (el) => { const g = el.closest('[data-group]'); g.querySelectorAll('[data-a="pick"]').forEach((b) => b.setAttribute('aria-pressed', b === el)); const form = el.closest('form'); const inp = form && form.querySelector(`input[name="${g.dataset.group}"]`); if (inp) inp.value = el.dataset.v; },
  deleteTask: (el) => { const i = S.tasks.findIndex((t) => t.id === el.dataset.id); const [t] = S.tasks.splice(i, 1); ui.sheet = null; save(); render(); toast('Task deleted', () => { S.tasks.splice(i, 0, t); save(); render(); }); },
  deleteEvent: (el) => { const i = S.events.findIndex((e) => e.id === el.dataset.id); const [e] = S.events.splice(i, 1); ui.sheet = null; save(); if (location.hash.startsWith('#/trip/')) go('#/today'); else render(); toast('Event deleted', () => { S.events.splice(i, 0, e); save(); render(); }); },
  deleteWaiting: (el) => { const i = S.waiting.findIndex((e) => e.id === el.dataset.id); const [w] = S.waiting.splice(i, 1); ui.sheet = null; save(); render(); toast('Removed', () => { S.waiting.splice(i, 0, w); save(); render(); }); },
  deleteMsg: (el) => { const i = S.messages.findIndex((m) => m.id === el.dataset.id); const [m] = S.messages.splice(i, 1); save(); go('#/inbox'); toast('Message removed', () => { S.messages.splice(i, 0, m); save(); render(); }); },
  deleteNote: (el) => { const i = S.notes.findIndex((n) => n.id === el.dataset.id); const [n] = S.notes.splice(i, 1); save(); render(); toast('Note deleted', () => { S.notes.splice(i, 0, n); save(); render(); }); },
  unsched: (el) => { const t = byId(S.tasks, el.dataset.id); const prev = t.sched; t.sched = null; if (ui.sheet) ui.sheet = null; save(); render(); toast('Back in the tray', () => { t.sched = prev; save(); render(); }); },
  undo: () => { const u = ui.toast && ui.toast.undo; ui.toast = null; const t = app.querySelector('.toast'); if (t) t.remove(); if (u) u(); },
  gotReply: (el) => { const w = byId(S.waiting, el.dataset.id); w.done = true; save(); render(); toast('Cleared', () => { w.done = false; save(); render(); }); },
  nudge: (el) => { const w = byId(S.waiting, el.dataset.id); w.nudged = today(); save(); setTimeout(render, 400); },
  makeTask: (el) => {
    const m = byId(S.messages, el.dataset.id);
    let acts = messageActions(m);
    if (!acts.length) acts = [{ title: m.subj ? 'Reply: ' + m.subj : (m.type === 'call' ? 'Call back ' : 'Reply to ') + m.who, date: today() }];
    ui.sheet = { type: 'mk', id: m.id, items: acts.map((a) => ({ title: a.title, date: a.date, on: true })) };
    render();
  },
  toggleAuto: () => { S.settings.autoSwitch = !S.settings.autoSwitch; save(); render(); },
  clearSamples: () => { if (confirm('Remove all the sample tasks, events, messages and notes? Anything you added stays.')) { removeSamples(); ui.taskProject = null; render(); toast('Sample data removed'); } },
  resetApp: () => { if (confirm('Erase everything on this phone and start again with the sample data?')) { reset(); render(); toast('App reset'); } },
  exportData: async () => {
    const name = `pitwall-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Pit Wall backup' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  /* capture */
  capType: (el) => { ui.cap.type = el.dataset.v; refreshCap(true); },
  capCtx: (el) => { ui.cap.ctx = el.dataset.v; refreshCap(); },
  capDur: (el) => { ui.cap.dur = +el.dataset.v; refreshCap(); },
  capEx: (el) => { Object.assign(ui.cap, { text: EXAMPLES[+el.dataset.v], type: null, ctx: null, dur: null, location: null, who: null }); const ta = app.querySelector('#cap'); ta.value = ui.cap.text; refreshCap(true); },
  capMic: () => { const ta = app.querySelector('#cap'); ta.focus(); toast('Tap the mic on your keyboard to dictate'); },
  capCancel: () => { ui.cap = null; if (history.length > 1) history.back(); else go('#/today'); },
  capAgain: () => { ui.cap.saved = null; Object.assign(ui.cap, { text: '', type: null, ctx: null, dur: null, location: null, who: null }); render(); },
  capSave: () => {
    const d = capDerived(), c = ui.cap;
    if (!d.title && d.type !== 'note') { toast('Type something first'); return; }
    let msg;
    if (d.type === 'task') { S.tasks.push(newTask({ title: d.title, ctx: d.ctx, project: d.project, due: d.date, dueTime: d.time })); msg = 'Added to ' + (d.date ? relDay(d.date) : 'Someday'); }
    else if (d.type === 'event') { S.events.push(newEvent({ title: d.title, ctx: d.ctx, date: d.date, start: d.time, dur: d.dur, location: d.location })); msg = `Added to ${relDay(d.date)} at ${hm(d.time)}`; }
    else if (d.type === 'note') { const txt = parse(c.text).title || c.text.trim(); if (!txt) { toast('Type something first'); return; } S.notes.push({ id: uid(), text: txt, ctx: d.ctx, created: Date.now() }); msg = 'Saved to Notes'; }
    else { S.waiting.push({ id: uid(), who: d.who, what: d.title, via: 'email', ctx: d.ctx, sent: today(), expect: d.date, nudged: null, done: false }); msg = 'Added to Waiting on'; }
    save(); c.saved = msg + ' · ' + LABEL[d.ctx]; render();
  },
  /* plan */
  planPick: (el) => { if (Date.now() - drag.justDropped < 400) return; ui.plan.sel = ui.plan.sel === el.dataset.id ? null : el.dataset.id; render(); },
  planDrop: (el) => { if (ui.plan.sel) schedule(ui.plan.sel, +el.dataset.v); },
  planAll: () => { ui.plan.all = !ui.plan.all; render(); },
  /* trip */
  tripMode: (el) => { const e = byId(S.events, ui.route.id); e.travel.mode = el.dataset.v; save(); render(); },
  tripMin: (el) => { const e = byId(S.events, ui.route.id); const m = e.travel.mode; const cur = e.travel.mins[m]; e.travel.mins[m] = Math.max(5, (cur == null ? 15 : cur) + (cur == null ? 0 : +el.dataset.v)); save(); render(); },
  tripEarly: (el) => { const e = byId(S.events, ui.route.id); e.early = +el.dataset.v; save(); render(); },
  /* weekend */
  wkDay: (el) => { ui.wkDay = +el.dataset.v; render(); },
  wkToggleList: (el) => { ui.wkOpen = ui.wkOpen === el.dataset.id ? null : el.dataset.id; render(); },
  wkItem: (el) => { const l = byId(S.weekends[0].lists, el.dataset.id); const i = byId(l.items, el.dataset.v); i.done = !i.done; save(); render(); },
  wkItemDel: (el) => { const l = byId(S.weekends[0].lists, el.dataset.id); l.items = l.items.filter((i) => i.id !== el.dataset.v); save(); render(); },
  wkDelItem: (el) => { const d = S.weekends[0].days[ui.wkDay]; d.items = d.items.filter((i) => i.id !== el.dataset.v); save(); render(); },
  wkReset: () => { if (confirm('Untick every checklist item, ready for the next event?')) { S.weekends[0].lists.forEach((l) => l.items.forEach((i) => { i.done = false; })); save(); render(); } },
  wkEdit: () => { ui.sheet = { type: 'wk' }; render(); },
  wkCreate: () => { S.weekends.unshift(blankWeekend()); save(); ui.sheet = { type: 'wk' }; render(); },
  wkDelete: () => { if (confirm('Delete this event weekend?')) { S.weekends.shift(); ui.sheet = null; save(); render(); } },
};

/* forms */
const fv = (f, n) => { const el = f.elements.namedItem(n); return el ? el.value : ''; };
const fc = (f, n) => { const el = f.elements.namedItem(n); return !!(el && el.checked); };
const F = {
  addTask: (f) => {
    const v = fv(f, 't').trim(); if (!v) return;
    const p = parse(v, { projects: projectNames() });
    const ctx = p.ctx || (ui.ctx !== 'all' ? ui.ctx : autoCtx());
    let due = p.date; if (!due && ui.taskList === 'today') due = today();
    S.tasks.push(newTask({ title: p.title || v, ctx, project: ui.taskProject || p.project, due, dueTime: p.time }));
    save(); render();
    const inp = app.querySelector('#newtask'); if (inp) inp.focus();
    toast('Added to ' + (due ? relDay(due) : 'Someday'));
  },
  addNote: (f) => { const v = fv(f, 't').trim(); if (!v) return; S.notes.push({ id: uid(), text: v, ctx: fv(f, 'ctx'), created: Date.now() }); save(); render(); },
  saveTask: (f) => {
    const t = byId(S.tasks, f.dataset.id);
    Object.assign(t, { title: fv(f, 'title').trim() || t.title, ctx: fv(f, 'ctx'), due: fv(f, 'due') || null, est: +fv(f, 'est'), project: fv(f, 'project').trim() || null });
    if (!t.due) t.dueTime = null;
    ui.sheet = null; save(); render();
  },
  saveEvent: (f) => {
    const e = byId(S.events, f.dataset.id);
    const [h, m] = fv(f, 'start').split(':').map(Number);
    Object.assign(e, { title: fv(f, 'title').trim() || e.title, ctx: fv(f, 'ctx'), date: fv(f, 'date'), start: h * 60 + m, dur: +fv(f, 'dur'), location: fv(f, 'location').trim() });
    ui.sheet = { type: 'event', id: e.id }; save(); render();
  },
  saveWaiting: (f) => {
    const w = byId(S.waiting, f.dataset.id);
    Object.assign(w, { who: fv(f, 'who').trim(), what: fv(f, 'what').trim() || w.what, ctx: fv(f, 'ctx'), via: fv(f, 'via'), expect: fv(f, 'expect') || null });
    ui.sheet = null; save(); render();
  },
  mkCreate: (f) => {
    const m = byId(S.messages, f.dataset.id); const sh = ui.sheet;
    const proj = parse((m.subj || '') + ' ' + m.body, { projects: projectNames() }).project;
    let n = 0;
    sh.items.forEach((it, i) => {
      if (!fc(f, 'on' + i)) return;
      S.tasks.push(newTask({ title: fv(f, 't' + i).trim() || it.title, ctx: m.ctx, project: proj, due: fv(f, 'd' + i) || null, src: { msg: m.id } })); n++;
    });
    if (!n) { toast('Tick at least one'); return; }
    sh.done = n; save(); render();
  },
  wkAdd: (f) => {
    const v = fv(f, 't').trim(); if (!v) return;
    const [h, m] = (fv(f, 'time') || '09:00').split(':').map(Number);
    S.weekends[0].days[ui.wkDay].items.push({ id: uid(), t: h * 60 + m, title: v, where: '' });
    save(); render();
  },
  wkListAdd: (f) => { const v = fv(f, 't').trim(); if (!v) return; byId(S.weekends[0].lists, f.dataset.id).items.push({ id: uid(), label: v, done: false }); save(); render(); const inp = app.querySelector('#li-' + f.dataset.id); if (inp) inp.focus(); },
  saveWk: (f) => {
    const w = S.weekends[0];
    ['name', 'track', 'leave', 'drive', 'hotel', 'conf', 'gate', 'gateNote'].forEach((k) => { w[k] = fv(f, k).trim(); });
    if (fv(f, 'start')) w.start = fv(f, 'start');
    w.sample = false;
    w.contacts.forEach((c, i) => { c.name = fv(f, 'cn' + i).trim(); c.phone = fv(f, 'cp' + i).trim(); });
    ui.sheet = null; save(); render();
  },
};

/* inputs (no full re-render while typing) */
const I = {
  inboxQ: (el) => { ui.inboxQ = el.value; const l = app.querySelector('#inboxList'); if (l) l.innerHTML = msgRows(); },
  capText: (el) => { ui.cap.text = el.value; refreshCap(); },
  capLoc: (el) => { ui.cap.location = el.value; },
  capWho: (el) => { ui.cap.who = el.value; },
};
function refreshCap() {
  const dyn = app.querySelector('#capDyn'); if (!dyn) return;
  const active = document.activeElement && document.activeElement.id;
  dyn.innerHTML = capDyn();
  const btn = app.querySelector('#capSave'); if (btn) btn.textContent = SAVE_LBL[capDerived().type];
  if (active && active !== 'cap') { const el = app.querySelector('#' + active); if (el) el.focus(); }
}
const C = {
  importData: (el) => {
    const file = el.files && el.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || data.v !== 1 || !Array.isArray(data.tasks)) throw new Error('bad');
        if (!confirm('Replace everything on this phone with this backup?')) return;
        replaceAll(data); render(); toast('Backup restored');
      } catch (e) { toast('That file isn’t a Pit Wall backup'); }
    };
    r.readAsText(file);
  },
};

/* ---------- router & render ---------- */
const scrollMem = {};
let lastKey = null;
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'today', id: parts[1] || null, q: new URLSearchParams(q || '') };
}
function go(h) { if (location.hash === h) render(); else location.hash = h; }
function render() {
  const main = app.querySelector('.main');
  if (main && lastKey) scrollMem[lastKey] = main.scrollTop;
  const r = parseHash(); ui.route = r;
  const key = location.hash || '#/today';
  const V = VIEWS[r.name] || VIEWS.today;
  const v = V(r);
  app.innerHTML = `<div class="scr">${v.html}</div>${v.tab ? tabbar(v.tab) : ''}${ui.sheet ? renderSheet() : ''}${ui.toast ? toastHTML() : ''}`;
  const m2 = app.querySelector('.main');
  if (m2) {
    if (scrollMem[key] != null) m2.scrollTop = scrollMem[key];
    else if (v.initScroll != null) m2.scrollTop = v.initScroll;
  }
  lastKey = key;
  if (v.after) v.after();
  if (ui.sheet) { const s = app.querySelector('.sheet'); if (s) s.scrollTop = 0; }
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || !app.contains(el)) return;
  const fn = A[el.dataset.a];
  if (fn) fn(el, e);
});
app.addEventListener('input', (e) => { const el = e.target; if (el.dataset && el.dataset.i && I[el.dataset.i]) I[el.dataset.i](el, e); });
app.addEventListener('change', (e) => { const el = e.target; if (el.dataset && el.dataset.c && C[el.dataset.c]) C[el.dataset.c](el, e); });
app.addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; if (F[f.dataset.f]) F[f.dataset.f](f); });
app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'cap' && !e.shiftKey) { e.preventDefault(); A.capSave(); } });
window.addEventListener('hashchange', () => { ui.sheet = null; ui.toast = null; clearTimeout(toastTimer); render(); });

// keep times fresh
let lastDay = today();
function tick() {
  if (document.hidden || drag.active || ui.sheet) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (today() !== lastDay) { lastDay = today(); ui.calDay = today(); }
  if (['today', 'calendar', 'plan', 'trip'].includes(ui.route && ui.route.name)) render();
}
setInterval(tick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (S.settings.autoSwitch && ui.ctx !== 'all') ui.ctx = autoCtx(); tick(); } });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
render();
