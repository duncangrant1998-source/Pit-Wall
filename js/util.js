export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const pad = (n) => String(n).padStart(2, '0');
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const today = () => iso(new Date());
export function addDays(s, n) { const d = fromISO(s); d.setDate(d.getDate() + n); return iso(d); }
export function diffDays(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 864e5); }
export function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
export const hm = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(Math.round(m) % 60);
export function weekStart(s) { const d = fromISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
export function dayShort(s) { const d = fromISO(s); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
export function dayLong(s) { const d = fromISO(s); return WDL[d.getDay()] + ' ' + d.getDate() + ' ' + MONL[d.getMonth()]; }
export function relDay(s) {
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  const dd = diffDays(t, s);
  if (dd > 0 && dd < 7) return WD[fromISO(s).getDay()];
  return dayShort(s);
}
export function dur(m) {
  m = Math.round(m);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}
export function durShort(m) {
  m = Math.round(m);
  if (m < 60) return m + ' MIN';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' H' + (r ? ' ' + r : '');
}

const P = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  calplus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  text: '<path d="M4 5h16v11H9l-5 4z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M10 12h6M10 16h6"/>',
  person: '<circle cx="12" cy="9" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4h13l-2.5 4.5L18 13H5"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  car: '<path d="M5 16l1.5-5h11l1.5 5v3H5z"/><path d="M7.5 11l1-3h7l1 3"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
  bed: '<path d="M3 19V7M3 13h18v6M7 13V10h6a3 3 0 0 1 3 3"/>',
  badge: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 17h6"/><circle cx="12" cy="12" r="2"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  dots: '<circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
};
export function icon(name, size = 22, sw = 1.8, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}
export const mk = (ctx) => `<span class="mk ${ctx}"></span>`;
