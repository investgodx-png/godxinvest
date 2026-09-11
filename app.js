/* ═══════════════════════════════════════════════════════════
   GODX — user app logic 7.0 (daily-interest edition)
   Collections: users, plans, investments, transactions,
                announcements, appContent, paymentMethods,
                supportChats(→messages)

   v7.0 highlights
   ───────────────
   ① DAILY INTEREST ENGINE — every active investment accrues a
     per-day slice (cashbackAmount / durationDays), anchored to the
     EXACT activation timestamp (createdAt). Interest for period N
     becomes due at activation + N×24h — never "at midnight".
     · Firestore serverTimestamp anchors every financial write;
       device-clock skew is corrected against server time and the
       remaining drift is absorbed by the rules' 5-minute slack.
     · Reconciliation runs inside a Firestore transaction guarded
       by a per-investment lock doc — refreshes, double-clicks and
       multiple open tabs can never double-credit.
     · Missed periods are paid as one catch-up credit (rule-
       validated against server time); accrual stops at maturity.
   ② LIVE COUNTDOWN — a premium "Next Interest: 23h 41m 18s" chip
     on every active plan, computed from timestamps each tick
     (never a naive decrement). On zero it reconciles the plan.
   ③ SAFE MONEY — joinPlan / openWithdraw now run as atomic
     Firestore transactions that re-read the balance inside the
     transaction: negative balances & stale-cache races are
     structurally impossible.
   ④ LISTENER LEAKS FIXED — per-view unsubscribes (chat list, chat
     rooms) are torn down when views change; previously every visit
     stacked another permanent onSnapshot.
   ⑤ SUPPORT CHAT — premium redesigned room (ApexVault-style):
     controlled logo size, Inter/Manrope-grade typography, distinct
     user/support bubbles with badge + timestamps, smooth entrance
     animations, loading / error / retry states, dedupe-safe send,
     unread sync, mobile-first layout.
   ═══════════════════════════════════════════════════════════ */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const inr2 = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = ts => ts && ts.toDate ? ts.toDate().toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '';
const ftime = ts => ts && ts.toDate ? ts.toDate().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}) : '';
const fdt = ts => ts && ts.toDate ? ts.toDate().toLocaleString('en-IN', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* paise-exact money helper — converts to integer paise to avoid float drift */
const paise = n => Math.round(Number(n || 0) * 100);
const fromPaise = p => p / 100;
const store = { // safe localStorage (private-mode proof)
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : v; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
};

/* ── Premium DUO-TONE icon library (v16 — modern, realistic, unique) ──
   Every icon = a soft-tinted duotone layer (currentColor at low opacity,
   so it inherits each tile's brand colour) + a crisp 2.1px rounded stroke
   on top. One call signature, so every existing IC.* usage upgrades
   automatically with zero template changes. */
const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  /* navigation + core actions — filled-tab duotone style */
  home: ic('<path fill="currentColor" fill-opacity=".16" stroke="none" d="M4 10.5 12 3.5l8 7V20a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20z"/><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5 9.8V20a1.5 1.5 0 0 0 1.5 1.5H10v-6h4v6h3.5A1.5 1.5 0 0 0 19 20V9.8"/>'),
  target: ic('<circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".12" stroke="none"/><circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="5.4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  wallet: ic('<path fill="currentColor" fill-opacity=".14" stroke="none" d="M4 6.5V18a2 2 0 0 0 2 2h13.2a1 1 0 0 0 .8-.8V8.2a1 1 0 0 0-.8-.8H6a2 2 0 0 1-2-.9Z"/><path d="M20 7H5a2 2 0 0 1 0-4h13v3.5"/><path d="M4 5.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1"/><circle cx="16.5" cy="13.5" r="1.4" fill="currentColor" stroke="none"/>'),
  chat: ic('<path fill="currentColor" fill-opacity=".12" stroke="none" d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.36-4.1-1L3 21l2-5.4a8.5 8.5 0 1 1 16-4.1Z"/><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.36-4.1-1L3 21l2-5.4a8.5 8.5 0 1 1 16-4.1Z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>'),
  gear: ic('<circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M12 2.8 13.7 5h2.6l.8 2.6 2.5 1 1.2 2.4-1.2 2.4-2.5 1-.8 2.6h-2.6L12 21.2 10.3 19H7.7l-.8-2.6-2.5-1L3.2 13l1.2-2.4 2.5-1L7.7 7h2.6z"/><circle cx="12" cy="12" r="3"/>'),
  /* money & growth */
  plus: ic('<rect x="3" y="3" width="18" height="18" rx="6" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M12 7.5v9M7.5 12h9"/>'),
  up: ic('<path d="M3 17.5 8.5 12l4 4L21 7.5"/><path d="M15.5 7.5H21V13"/><circle cx="21" cy="7.5" r="1.6" fill="currentColor" stroke="none"/>'),
  down: ic('<path d="M3 6.5 8.5 12l4-4L21 16.5"/><path d="M15.5 16.5H21V11"/><circle cx="21" cy="16.5" r="1.6" fill="currentColor" stroke="none"/>'),
  upRight: ic('<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M8.5 15.5 15.5 8.5"/><path d="M9.5 8.5h6v6"/>'),
  downLeft: ic('<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="m15.5 8.5-7 7"/><path d="M14.5 15.5h-6v-6"/>'),
  gift: ic('<rect x="3.5" y="8" width="17" height="4" rx="1.4" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M12 8v13"/><path d="M7.8 8a2.3 2.3 0 1 1 2.4-3.9C11.7 5.4 12 8 12 8Z"/><path d="M16.2 8a2.3 2.3 0 1 0-2.4-3.9C12.3 5.4 12 8 12 8Z"/>'),
  /* trust & security */
  shield: ic('<path fill="currentColor" fill-opacity=".14" stroke="none" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
  bank: ic('<path fill="currentColor" fill-opacity=".14" stroke="none" d="m12 3 8 4.2v1.3H4V7.2z"/><path d="m12 2.6 8.5 4.5H3.5z"/><path d="M4.5 10v7M9 10v7M15 10v7M19.5 10v7"/><path d="M3 20.5h18"/><circle cx="12" cy="5.6" r="1.1" fill="currentColor" stroke="none"/>'),
  lock: ic('<rect x="4" y="10.5" width="16" height="10" rx="3" fill="currentColor" fill-opacity=".14" stroke="none"/><rect x="4" y="10.5" width="16" height="10" rx="3"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/><path d="M12 16.2v1.8"/>'),
  /* people */
  users: ic('<circle cx="9" cy="7" r="4" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  user: ic('<circle cx="12" cy="7.2" r="3.8" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7.2" r="3.8"/>'),
  headset: ic('<path d="M4 14v-2.5a8 8 0 0 1 16 0V14"/><rect x="2.8" y="13.5" width="4.6" height="6.5" rx="2.2" fill="currentColor" fill-opacity=".16" stroke="none"/><rect x="16.6" y="13.5" width="4.6" height="6.5" rx="2.2" fill="currentColor" fill-opacity=".16" stroke="none"/><rect x="2.8" y="13.5" width="4.6" height="6.5" rx="2.2"/><rect x="16.6" y="13.5" width="4.6" height="6.5" rx="2.2"/><path d="M20 20a3.5 3.5 0 0 1-3.5 2H13"/>'),
  /* misc utilities */
  send: ic('<path d="m22 2-7 20-4-9-9-4Z" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  paperclip: ic('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  file: ic('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" fill="currentColor" fill-opacity=".10" stroke="none"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  chevL: ic('<path d="m15 18-6-6 6-6"/>'),
  check: ic('<path d="M20 6 9 17l-5-5"/>'),
  checkCircle: ic('<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".14" stroke="none"/><circle cx="12" cy="12" r="9.2"/><path d="m8.5 12.2 2.4 2.4 4.8-4.8"/>'),
  spark: ic('<path d="M9.94 15.5a2 2 0 0 0-1.44-1.44L2.37 12.5a.5.5 0 0 1 0-.98l6.13-1.56A2 2 0 0 0 9.94 8.5l1.56-6.13a.5.5 0 0 1 .98 0l1.56 6.13a2 2 0 0 0 1.44 1.44l6.13 1.56a.5.5 0 0 1 0 .98l-6.13 1.56a2 2 0 0 0-1.44 1.44l-1.56 6.13a.5.5 0 0 1-.98 0z" fill="currentColor" fill-opacity=".16"/><circle cx="19" cy="5" r="1.3" fill="currentColor" stroke="none"/>'),
  chevD: ic('<path d="m6 9 6 6 6-6"/>'),
  arrowR: '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  copy: ic('<rect x="9" y="9" width="12" height="12" rx="2.5" fill="currentColor" fill-opacity=".12" stroke="none"/><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  share: ic('<circle cx="18" cy="5" r="2.6" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="6" cy="12" r="2.6" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="18" cy="19" r="2.6" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>'),
  logout: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  doc: ic('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" fill="currentColor" fill-opacity=".10" stroke="none"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13h6"/><path d="M9 17h6"/>'),
  info: ic('<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".12" stroke="none"/><circle cx="12" cy="12" r="9.2"/><path d="M12 16v-4.5"/><path d="M12 8h.01"/>'),
  clock: ic('<circle cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".12" stroke="none"/><circle cx="12" cy="12" r="9.2"/><polyline points="12 6.5 12 12 15.8 14"/>'),
  star: ic('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" fill-opacity=".2" stroke="none"/><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  zap: ic('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fill-opacity=".18" stroke="none"/><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  phone: ic('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.6 2.81.72A2 2 0 0 1 22 16.92z"/>'),
  edit: ic('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  upload: ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  qr: ic('<rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity=".14" stroke="none"/><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3z"/><path d="M21 14v1"/><path d="M14 21h1"/><path d="M18 18h3v3h-3z"/>'),
  card: ic('<rect x="2" y="5" width="20" height="14" rx="3" fill="currentColor" fill-opacity=".10" stroke="none"/><rect x="2" y="5" width="20" height="14" rx="3"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 15h4"/>'),
  box: ic('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" fill="currentColor" fill-opacity=".10" stroke="none"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  party: ic('<path d="M5.8 11.3 2 22l10.7-3.79" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>'),
  timer: ic('<circle cx="12" cy="13" r="7.5" fill="currentColor" fill-opacity=".12" stroke="none"/><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2.5"/><path d="M5 3 2.5 5.5"/><path d="m21.5 5.5-2.5-2.5"/><path d="M6.5 18.5 4.5 20.5"/><path d="m17.5 18.5 2 2"/>'),
  badge: ic('<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>'),
  refresh: ic('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  alert: ic('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  bell: ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: ic('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>')
};

/* ── Global state ── */
let currentUser = null, userDoc = null;
let unsub = [];               // session-scoped listeners (cleared on logout)
let viewUnsub = [];           // per-view listeners — torn down on every view switch
let balanceVisible = store.get('bgBal', 'on') !== 'off', currentView = 'home';
let lastBalance = null;       // for count-up animation

/* ══════════ WALLET LIMITS (admin-editable, live) ══════════
   appContent/walletLimits holds { minDeposit, minWithdraw, allowCancel }.
   Cached for 30s so the deposit/withdraw sheets stay instant. */
let walletCfgCache = { minDeposit: 50, minWithdraw: 100, allowCancel: true, loadedAt: 0 };
async function walletCfg(force) {
  if (!force && Date.now() - walletCfgCache.loadedAt < 30000) return walletCfgCache;
  try {
    const d = await db.collection('appContent').doc('walletLimits').get();
    const c = d.exists ? d.data() : {};
    walletCfgCache = {
      minDeposit: Number(c.minDeposit ?? 50),
      minWithdraw: Number(c.minWithdraw ?? 100),
      allowCancel: c.allowCancel !== false,
      loadedAt: Date.now()
    };
  } catch (e) { walletCfgCache.loadedAt = Date.now(); }
  return walletCfgCache;
}

/* ══════════ SERVER-TIME SYNC ══════════
   Financial timestamps must not depend on the device clock. We estimate the
   offset between Firestore server time and Date.now() by writing a throwaway
   serverTimestamp to the user's own doc (lastSeenAt — whitelisted in rules)
   and reading it back. nowMs() then returns corrected time everywhere.
   The rules also add a 5-minute slack window, so even a failed sync is safe. */
let serverOffsetMs = 0;
let serverSyncedAt = 0;
function nowMs() { return Date.now() + serverOffsetMs; }
async function syncServerTime(force) {
  if (!currentUser) return;
  if (!force && nowMs() - serverSyncedAt < 10 * 60 * 1000) return; // re-sync every 10 min
  try {
    const ref = db.collection('users').doc(currentUser.uid);
    const t0 = Date.now();
    await ref.set({ lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const snap = await ref.get({ source: 'server' });
    const sv = snap.data().lastSeenAt;
    if (sv && sv.toMillis) {
      const rtt = (Date.now() - t0) / 2;
      serverOffsetMs = sv.toMillis() - (t0 + rtt);
      serverSyncedAt = Date.now();
    }
  } catch (e) { /* rules not yet published / offline — 5-min rule slack covers us */ }
}

/* ══════════ FULLSCREEN LOADER ══════════ */
function showLoader(txt = 'Working…') {
  const el = $('#loader-overlay');
  if (el) { el.querySelector('.lo-txt').textContent = txt; el.classList.add('show'); }
}
function hideLoader() { const el = $('#loader-overlay'); if (el) el.classList.remove('show'); }

/* ══════════ TOAST ══════════ */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = (type === 'ok' ? IC.checkCircle : type === 'err' ? IC.alert : IC.info) + '<span>' + esc(msg) + '</span>';
  $('#toast-root').appendChild(t);
  setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 320); }, 2800);
}

/* ══════════ CONFETTI celebration ══════════ */
function confetti(n = 26) {
  const colors = ['#3B82F6', '#5EEAD4', '#16A34A', '#2563EB', '#DC2626', '#14B8A6'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const size = 6 + Math.random() * 7;
    p.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size * (Math.random() > .5 ? 1 : .45)}px;
      background:${colors[i % colors.length]};animation-duration:${1.6 + Math.random() * 1.4}s;
      animation-delay:${Math.random() * .35}s;transform:rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 3400);
  }
}

/* ══════════ BALANCE COUNT-UP ══════════ */
function countUp(el, to) {
  const from = lastBalance ?? 0;
  lastBalance = to;
  if (from === to || !el) { if (el) el.textContent = inr(to); return; }
  const t0 = performance.now(), dur = 650;
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = inr(Math.round(from + (to - from) * e));
    if (k < 1 && document.body.contains(el)) requestAnimationFrame(tick);
  })(t0);
}

/* ══════════ 3D TILT + GLARE (premium hero cards) ══════════
   Lag-free edition: passive listeners, rAF-throttled to one style write per
   frame, and will-change is granted ONLY while the pointer is on the card —
   a permanent will-change on every hero wastes compositor memory and makes
   scrolling stutter on low-end Android. */
function tilt3D(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  if (!el.querySelector('.hero-glare')) el.insertAdjacentHTML('beforeend', '<div class="hero-glare"></div>');
  let rafId = 0, px = 0, py = 0;
  el.addEventListener('pointerenter', () => { el.style.willChange = 'transform'; }, { passive: true });
  el.addEventListener('pointermove', e => {
    px = e.clientX; py = e.clientY;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const r = el.getBoundingClientRect();
      const x = (px - r.left) / r.width - .5, y = (py - r.top) / r.height - .5;
      el.style.transform = `rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateZ(6px)`;
      el.style.setProperty('--mx', ((x + .5) * 100) + '%');
      el.style.setProperty('--my', ((y + .5) * 100) + '%');
    });
  }, { passive: true });
  const settle = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    el.style.transform = '';
    el.style.willChange = ''; // release the GPU layer — will-change cleanup
  };
  el.addEventListener('pointerleave', settle, { passive: true });
  el.addEventListener('pointercancel', settle, { passive: true });
}

/* ══════════ MODAL (bottom sheet) ══════════ */
function openSheet(html) {
  closeSheet();
  const back = document.createElement('div'); back.className = 'modal-back';
  const sheet = document.createElement('div'); sheet.className = 'modal-sheet';
  sheet.innerHTML = '<div class="sheet-handle"></div><div class="sheet-fade">' + html + '</div>';
  $('#modal-root').append(back, sheet);
  requestAnimationFrame(() => { back.classList.add('show'); sheet.classList.add('show'); });
  back.onclick = closeSheet;
  return sheet;
}
function closeSheet() { $('#modal-root').innerHTML = ''; }

/* ══════════ SPLASH / AUTH ══════════
   Deferred splash: hides as soon as the DOM is ready (never waits on the
   full 'load' event — a slow Firebase CDN can no longer hold it hostage),
   hard-capped at 900ms, then REMOVED from the DOM so it costs zero
   compositing for the rest of the session. */
(function splash(){
  const el = document.getElementById('splash');
  if (!el) return;
  const t0 = performance.now();
  const hide = () => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 560); // drop the layer after the fade
    }, Math.max(0, 900 - (performance.now() - t0)));
  };
  if (document.readyState !== 'loading') hide();
  else document.addEventListener('DOMContentLoaded', hide, { once: true });
  setTimeout(hide, 1600); // absolute failsafe
})();

$('#tab-login').onclick = () => switchAuthTab(true);
$('#tab-signup').onclick = () => switchAuthTab(false);
$('#go-signup').onclick = () => switchAuthTab(false);
$('#go-login').onclick = () => switchAuthTab(true); // FIX: signup tab had no way back to login
function switchAuthTab(login) {
  $('#tab-login').classList.toggle('active', login);
  $('#tab-signup').classList.toggle('active', !login);
  $('#auth-tabs').classList.toggle('show-signup', !login);
  $('#form-login').classList.toggle('hidden', !login);
  $('#form-signup').classList.toggle('hidden', login);
}

/* password show / hide */
$$('.pw-eye').forEach(b => b.onclick = () => {
  const inp = $(b.dataset.t);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  b.innerHTML = show ? IC.eyeOff : IC.eye;
  b.classList.toggle('on', show);
});

/* forgot password */
$('#forgot-link').onclick = () => {
  const s = openSheet(`
    <div class="sheet-title">Reset Password</div>
    <div class="sheet-sub">Enter the email you signed up with — we'll send a secure reset link right away.</div>
    <label class="field"><span>Email Address</span><input id="fp-email" type="email" placeholder="you@example.com" value="${esc($('#login-email').value.trim())}"></label>
    <div style="height:16px"></div>
    <button class="btn btn-primary btn-block" id="fp-go" type="button">Send Reset Link</button>`);
  s.querySelector('#fp-go').onclick = async () => {
    const btn = s.querySelector('#fp-go');
    const email = s.querySelector('#fp-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email address', 'err');
    btn.classList.add('loading'); btn.disabled = true;
    try { await auth.sendPasswordResetEmail(email); closeSheet(); toast('Reset link sent — check your inbox ✉️', 'ok'); }
    catch (err) { btn.classList.remove('loading'); btn.disabled = false; toast(authMsg(err), 'err'); }
  };
};

$('#form-login').onsubmit = async e => {
  e.preventDefault();
  // FIX: client-side validation BEFORE hitting Firebase — empty / malformed
  // input previously fired a network call and surfaced a raw Firebase error.
  const email = $('#login-email').value.trim(), pass = $('#login-pass').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Please enter a valid email address', 'err');
  if (!pass) return toast('Please enter your password', 'err');
  if (pass.length < 6) return toast('Password must be at least 6 characters', 'err');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    toast('Welcome back! 👋', 'ok');
  } catch (err) { toast(authMsg(err), 'err'); }
  // FIX: restore button state inside finally — previously a synchronous throw
  // left the Login button permanently disabled (spinner forever).
  finally { btn.classList.remove('loading'); btn.disabled = false; }
};

$('#form-signup').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const name = $('#su-name').value.trim(), phone = $('#su-phone').value.trim(),
        email = $('#su-email').value.trim(), pass = $('#su-pass').value,
        ref = $('#su-ref').value.trim().toUpperCase();
  // FIX: signup validation BEFORE any Firebase call (name / phone / email / password)
  if (name.length < 3) return toast('Please enter your full name', 'err');
  if (!/^\d{10}$/.test(phone.replace(/[\s-]/g, ''))) return toast('Enter a valid 10-digit phone number', 'err');
  if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Please enter a valid email address', 'err');
  if (pass.length < 6) return toast('Password must be at least 6 characters', 'err');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    const code = 'GODX' + Math.random().toString(36).slice(2, 7).toUpperCase();
    await db.collection('users').doc(cred.user.uid).set({
      name, phone, email, role: 'user', balance: 0,
      totalSaved: 0, totalCashback: 0, totalDeposits: 0, totalWithdrawn: 0,
      referralCode: code, referredBy: ref || null, bankDetails: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('Account created — welcome to GodX! 🎉', 'ok');
    confetti();
  } catch (err) {
    // FIX: orphan-account recovery — if the auth user was created but the
    // profile write failed (rules / offline), sign out so the email is not
    // stuck in "already registered" limbo with no way to log in.
    if (err && (err.code === 'permission-denied' || err.code === 'unavailable')) {
      try { await auth.signOut(); } catch (_) {}
      toast('Could not finish setup — please try again', 'err');
    } else toast(authMsg(err), 'err');
  }
  // FIX: restore button state inside finally (same stuck-spinner bug as login)
  finally { btn.classList.remove('loading'); btn.disabled = false; }
};

/* ── "How GodX works" explainer — shown on the login screen so new users
     instantly understand (and trust) the lending model before signing up ── */
$('#auth-how').onclick = () => {
  openSheet(`
    <div class="sheet-title">How GodX works</div>
    <div class="sheet-sub">Simple, transparent, and registered — here is exactly what happens to your money.</div>
    <div class="hw-steps">
      <div class="hw-step"><div class="hw-n">1</div><div><b>You add money to a savings plan</b><p>Pick a plan and deposit — every rupee is recorded in your wallet with a receipt.</p></div></div>
      <div class="hw-step"><div class="hw-n">2</div><div><b>GodX lends it to verified customers</b><p>Your deposit funds short-term loans to identity-verified, credit-checked borrowers on our platform.</p></div></div>
      <div class="hw-step"><div class="hw-n">3</div><div><b>Borrowers repay with interest</b><p>Loans are repaid on schedule with interest — that interest is the source of your earnings.</p></div></div>
      <div class="hw-step"><div class="hw-n">4</div><div><b>You earn interest every single day</b><p>Your daily share lands in your GodX wallet every 24 hours. Withdraw to your bank within 24 hours — no hidden charges, ever.</p></div></div>
    </div>
    <div class="reg-strip">
      <div class="reg-item">${IC.shield}<span><b>Registered Company</b><small>GodX operates as a registered Indian business — verifiable &amp; compliant. No scam, guaranteed.</small></span></div>
      <div class="reg-item">${IC.bank}<span><b>Real lending model</b><small>Your interest comes from real loan repayments — not from new users' deposits.</small></span></div>
      <div class="reg-item">${IC.lock}<span><b>Bank-grade security</b><small>256-bit encryption, secure Firebase auth, and full transaction history.</small></span></div>
    </div>
    <button class="btn btn-primary btn-block" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Got it — I'm ready</button>`);
};

function authMsg(err) {
  const map = {
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/invalid-credential': 'Incorrect email or password',
    'auth/invalid-login-credentials': 'Incorrect email or password',
    'auth/email-already-in-use': 'This email is already registered',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/invalid-email': 'Please enter a valid email',
    'auth/user-disabled': 'This account has been disabled — contact support',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this app',
    'auth/missing-password': 'Please enter your password',
    'auth/internal-error': 'Something went wrong — please try again',
    'auth/too-many-requests': 'Too many attempts — try again in a minute',
    'auth/network-request-failed': 'Network error — check your connection'
  };
  return map[err && err.code] || (err && err.message) || 'Something went wrong — try again';
}

/* ══════════ AUTH STATE ══════════ */
auth.onAuthStateChanged(async user => {
  unsub.forEach(u => { try { u(); } catch (e) {} }); unsub = [];
  teardownViewListeners();
  interestEngineStop();
  if (!user) {
    currentUser = null; userDoc = null; lastBalance = null;
    $('#app').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
    return;
  }
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) { await auth.signOut(); return toast('Profile not found. Contact support.', 'err'); }
    currentUser = user; userDoc = snap;
    $('#auth-view').classList.add('hidden');
    $('#app').classList.remove('hidden');
    bindUserListener();
    bindContentListeners(); // 🔴 real-time admin → user sync
    syncServerTime(true).then(() => interestEngineStart()); // daily interest, server-anchored
    renderHeader();
    switchView('home');
  } catch (e) {
    console.error('Profile load failed:', e);
    $('#app').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
    toast(e && e.code === 'permission-denied'
      ? 'Database access denied — publish firestore.rules in Firebase Console'
      : 'Could not load profile — check connection', 'err');
  }
});

function bindUserListener() {
  unsub.push(db.collection('users').doc(currentUser.uid).onSnapshot(s => {
    if (!s.exists) return;
    userDoc = s;
    if (currentView === 'home') renderHome();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'settings') renderSettings();
    renderHeader();
  }, () => {}));
}

/* ══════════ REAL-TIME CONTENT SYNC ══════════
   Plans, announcements, payment methods & home content update LIVE
   the moment the admin changes them — no app restart, and no
   Firestore composite index required (sorting done client-side). */
let livePlans = null, liveAnnouncements = null, liveContent = null, liveReferral = null, liveShareCfg = null;

function bindContentListeners() {
  // Plans (admin-edited) — live
  unsub.push(db.collection('plans').where('active', '==', true).onSnapshot(snap => {
    livePlans = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.minAmount || 0) - (b.minAmount || 0));
    if (currentView === 'home') drawFeaturedPlans();
    if (currentView === 'plans') drawPlansList();
  }, () => { livePlans = []; }));

  // Announcements — live
  unsub.push(db.collection('announcements').orderBy('createdAt', 'desc').limit(3).onSnapshot(snap => {
    liveAnnouncements = snap.docs.map(d => d.data());
    if (currentView === 'home') drawAnnouncements('#home-ann');
  }, () => {
    // orderBy fallback if an index/rules issue occurs: plain collection listen
    unsub.push(db.collection('announcements').limit(10).onSnapshot(snap => {
      liveAnnouncements = snap.docs.map(d => d.data())
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 3);
      if (currentView === 'home') drawAnnouncements('#home-ann');
    }));
  }));

  // Home screen content (trust strip, about section) — live
  unsub.push(db.collection('appContent').doc('main').onSnapshot(d => {
    liveContent = d.exists ? d.data() : {};
    if (currentView === 'home') drawAppContent();
  }));

  // Referral settings — admin-editable (amount + trigger + description) — live
  unsub.push(db.collection('appContent').doc('referral').onSnapshot(d => {
    liveReferral = d.exists ? d.data() : {};
  }));

  // Share settings — admin-editable share message + link + enabled platforms — live
  unsub.push(db.collection('appContent').doc('share').onSnapshot(d => {
    liveShareCfg = d.exists ? d.data() : {};
  }));
}

/* ══════════ REFERRAL / SHARE HELPERS ══════════ */
function refCfg() {
  const r = liveReferral || {};
  return {
    referrerAmount: Number(r.referrerAmount ?? 25),
    referredAmount: Number(r.referredAmount ?? 25),
    trigger: r.trigger || 'deposit', // 'deposit' | 'first_plan'
    minDeposit: Number(r.minDeposit ?? 0),
    title: r.title || 'Refer & Earn',
    description: r.description || 'Share your code — you both get a reward when a friend joins!',
    enabled: r.enabled !== false
  };
}
function shareCfg() {
  const s = liveShareCfg || {};
  const u = userDoc ? userDoc.data() : {};
  const code = (u && u.referralCode) || '';
  const rc = refCfg();
  const defaultMsg = `Join me on GodX — save small amounts, earn real interest! 💜\n\n🎁 Use my referral code ${code} at signup and we BOTH get ₹${rc.referredAmount}!\n\nDownload now:`;
  const link = (s.shareLink || window.location.origin || 'https://godx.app').trim();
  const rawMsg = (s.shareMessage && String(s.shareMessage).trim()) || defaultMsg;
  // token replacement: {code}, {link}, {referrerAmount}, {referredAmount}, {name}
  const msg = rawMsg
    .replace(/\{code\}/g, code)
    .replace(/\{link\}/g, link)
    .replace(/\{referrerAmount\}/g, rc.referrerAmount)
    .replace(/\{referredAmount\}/g, rc.referredAmount)
    .replace(/\{name\}/g, u.name || '');
  return {
    link, message: msg, code,
    platforms: s.platforms || { whatsapp: true, instagram: true, telegram: true, facebook: true, twitter: true, sms: true, email: true, copy: true }
  };
}
function shareOn(platform) {
  const cfg = shareCfg();
  const encMsg = encodeURIComponent(cfg.message + '\n' + cfg.link);
  const encMsgOnly = encodeURIComponent(cfg.message);
  const encLink = encodeURIComponent(cfg.link);
  const urls = {
    whatsapp: `https://wa.me/?text=${encMsg}`,
    telegram: `https://t.me/share/url?url=${encLink}&text=${encMsgOnly}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encLink}&quote=${encMsgOnly}`,
    twitter: `https://twitter.com/intent/tweet?text=${encMsg}`,
    sms: `sms:?&body=${encMsg}`,
    email: `mailto:?subject=${encodeURIComponent('Join me on GodX')}&body=${encMsg}`
  };
  if (platform === 'instagram') {
    // Instagram has no direct web share — copy the message and open Instagram
    navigator.clipboard?.writeText(cfg.message + '\n' + cfg.link);
    toast('Message copied — opening Instagram, paste in your story/DM!', 'ok');
    setTimeout(() => { try { window.open('https://www.instagram.com/', '_blank'); } catch (e) {} }, 400);
    return;
  }
  if (platform === 'copy') {
    navigator.clipboard?.writeText(cfg.message + '\n' + cfg.link);
    toast('Invite message copied — paste anywhere!', 'ok');
    return;
  }
  if (platform === 'native') {
    if (navigator.share) { try { navigator.share({ title: 'GodX', text: cfg.message, url: cfg.link }); } catch (e) {} }
    else { navigator.clipboard?.writeText(cfg.message + '\n' + cfg.link); toast('Invite copied!', 'ok'); }
    return;
  }
  if (urls[platform]) {
    try { window.open(urls[platform], '_blank'); } catch (e) { navigator.clipboard?.writeText(cfg.message + '\n' + cfg.link); toast('Copied invite — paste to share!', 'ok'); }
  }
}
function openSharePicker() {
  const cfg = shareCfg();
  const rc = refCfg();
  const p = cfg.platforms || {};
  const items = [
    { k: 'whatsapp', name: 'WhatsApp', color: '#25D366', ic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.3c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1s-1.2-.5-2.3-1.4c-.9-.7-1.4-1.7-1.6-2s0-.4.1-.5c.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5s.1-.4 0-.5-.7-1.7-1-2.3c-.3-.6-.5-.5-.7-.5H7.9c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.4s1 2.8 1.2 3c.2.2 2 3.1 4.9 4.2 2.9 1.2 2.9.8 3.4.7.5 0 1.7-.7 2-1.4.3-.7.3-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.5.8 3.1 1.3 4.8 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>' },
    { k: 'instagram', name: 'Instagram', color: '#E1306C', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.4a4 4 0 1 1-8 .1 4 4 0 0 1 8-.1z"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.5"/></svg>' },
    { k: 'telegram', name: 'Telegram', color: '#0088CC', ic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 3 2 10l7 2 3 8 3-5 6 5 3-17z"/></svg>' },
    { k: 'facebook', name: 'Facebook', color: '#1877F2', ic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5v1.8h2.6l-.4 2.9h-2.2v7A10 10 0 0 0 22 12z"/></svg>' },
    { k: 'twitter', name: 'X / Twitter', color: '#0F172A', ic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 3H22l-7.5 8.6L23 21h-6.8l-5.3-6.7L4.7 21H1.6l8-9.2L1 3h6.9l4.8 6.2zM17.7 19h1.8L6.4 4.9H4.5z"/></svg>' },
    { k: 'sms', name: 'SMS', color: '#16A34A', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
    { k: 'email', name: 'Email', color: '#2563EB', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/></svg>' },
    { k: 'copy', name: 'Copy Link', color: '#64748B', ic: IC.copy }
  ].filter(x => p[x.k] !== false);

  const s = openSheet(`
    <div class="sheet-title">Share GodX 💜</div>
    <div class="sheet-sub">You earn <b>₹${rc.referrerAmount}</b> and your friend gets <b>₹${rc.referredAmount}</b> when they ${rc.trigger === 'first_plan' ? 'complete their first plan' : 'make their first deposit'}!</div>
    <div class="share-code-box">
      <div><small>Your Referral Code</small><b>${esc(cfg.code || '—')}</b></div>
      <button class="btn btn-soft btn-sm" id="sh-cpcode" type="button">${IC.copy} Copy</button>
    </div>
    <div class="share-preview"><small>MESSAGE PREVIEW</small><p>${esc(cfg.message)}</p><a href="${esc(cfg.link)}" target="_blank">${esc(cfg.link)}</a></div>
    <div class="share-grid">
      ${items.map(x => `<button class="share-item" data-sh="${x.k}" type="button" style="--sc:${x.color}">
         <span class="share-ic" style="background:${x.color}">${x.ic}</span>
         <span>${esc(x.name)}</span></button>`).join('')}
    </div>
    ${navigator.share ? '<button class="btn btn-soft btn-block" id="sh-native" type="button" style="margin-top:10px">' + IC.share + ' More options…</button>' : ''}`);
  s.querySelector('#sh-cpcode').onclick = () => { navigator.clipboard?.writeText(cfg.code); toast('Referral code copied', 'ok'); };
  s.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => shareOn(b.dataset.sh));
  const nb = s.querySelector('#sh-native'); if (nb) nb.onclick = () => shareOn('native');
}

/* ══════════ HEADER ══════════ */
function renderHeader() {
  if (!userDoc) return;
  const u = userDoc.data();
  const titles = { home: ['Welcome back 👋', u.name || 'Saver'], plans: ['Grow your money', 'Savings Plans'],
                   wallet: ['Your money, always yours', 'My Wallet'], support: ['We are here to help', 'Support & Help'],
                   settings: ['Manage everything', 'Settings'] };
  const [sub, title] = titles[currentView];
  $('#app-header').innerHTML = `
    <div class="hd-left">
      <div class="hd-avatar">${esc((u.name || 'B')[0].toUpperCase())}</div>
      <div class="hd-title"><small>${sub}</small><b>${esc(title)}</b></div>
    </div>
    <div class="hd-right">
      <button class="hd-icon" id="hd-bell" type="button" aria-label="Notifications">${IC.bell}<span class="hd-dot"></span></button>
    </div>`;
  $('#hd-bell').onclick = showNotifications;
}

/* ══════════ NAV ══════════ */
$$('.nav-btn').forEach(b => b.onclick = () => { b.classList.remove('bounce'); void b.offsetWidth; b.classList.add('bounce'); switchView(b.dataset.view); });

/* tear down everything a view opened (chat listeners, timers) before switching */
function teardownViewListeners() {
  viewUnsub.forEach(u => { try { u(); } catch (e) {} });
  viewUnsub = [];
  CountdownRegistry.clear();
}

function switchView(v) {
  if (v === currentView && $('#view-' + v).innerHTML) {
    // re-tap on same tab just scrolls up
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  teardownViewListeners();
  currentView = v;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  ['home','plans','wallet','support','settings'].forEach(x => $('#view-' + x).classList.toggle('hidden', x !== v));
  renderHeader();
  ({ home: renderHome, plans: renderPlans, wallet: renderWallet, support: renderSupport, settings: renderSettings })[v]();
  window.scrollTo({ top: 0 });
}

/* ══════════ HOME ══════════ */
async function renderHome() {
  const u = userDoc.data();
  const el = $('#view-home');
  el.innerHTML = `
    <div class="balance-hero">
      <div class="bh-label">Total Balance <span id="bal-eye" role="button">${balanceVisible ? IC.eye : IC.eyeOff}</span></div>
      <div class="bh-amount" id="bh-amt">${balanceVisible ? inr(u.balance) : '₹ ••••••'}</div>
      <div class="bh-row">
        <div class="bh-stat"><small>Total Saved</small><b>${balanceVisible ? inr(u.totalSaved) : '•••'}</b></div>
        <div class="bh-stat"><small>Interest</small><b>${balanceVisible ? inr(u.totalCashback) : '•••'}</b></div>
        <div class="bh-stat"><small>Active Plans</small><b id="bh-plans">…</b></div>
      </div>
    </div>

    <div class="card">
      <div class="quick-grid">
        <button class="quick-item" data-q="save"><div class="quick-ic qi-1">${IC.plus}</div><span>Add Money</span></button>
        <button class="quick-item" data-q="plans"><div class="quick-ic qi-2">${IC.target}</div><span>Plans</span></button>
        <button class="quick-item" data-q="withdraw"><div class="quick-ic qi-3">${IC.upRight}</div><span>Withdraw</span></button>
        <button class="quick-item" data-q="refer"><div class="quick-ic qi-4">${IC.gift}</div><span>Refer</span></button>
      </div>
    </div>

    <div id="home-ann"></div>

    <!-- How your money earns — the lending loop, made crystal clear -->
    <div class="sec-head"><h3>How your money earns</h3></div>
    <div class="card"><div class="hw-steps">
      <div class="hw-step"><div class="hw-n">1</div><div><b>You add money</b><p>Deposit into any savings plan — tracked with receipts.</p></div></div>
      <div class="hw-step"><div class="hw-n">2</div><div><b>We lend to verified borrowers</b><p>Funds go out as short-term loans to identity &amp; credit-verified customers.</p></div></div>
      <div class="hw-step"><div class="hw-n">3</div><div><b>Borrowers repay with interest</b><p>Loan repayments generate the interest — a real, registered lending business.</p></div></div>
      <div class="hw-step"><div class="hw-n">4</div><div><b>Interest hits your wallet daily</b><p>Credited every 24 hours. Withdraw to your bank within 24 hours.</p></div></div>
    </div></div>

    <!-- Registered &amp; trusted — proof, not promises -->
    <div class="reg-card">
      <div class="reg-head">${IC.shield}<div><b>Registered &amp; 100% Legitimate</b><small>GodX is a registered Indian company — verified, compliant, zero scam.</small></div></div>
      <div class="reg-strip">
        <div class="reg-item">${IC.bank}<span><b>Regulated lending model</b><small>Earnings come from real borrower interest — never from new deposits.</small></span></div>
        <div class="reg-item">${IC.doc}<span><b>Full paper trail</b><small>Every deposit, plan and payout has a receipt in your wallet history.</small></span></div>
        <div class="reg-item">${IC.zap}<span><b>24-hour withdrawals</b><small>Your money stays yours — request a payout anytime after plan maturity.</small></span></div>
      </div>
    </div>

    <div id="home-trust"></div>
    <div id="home-about"></div>

    <div class="sec-head"><h3>Featured Plans</h3><button id="see-plans" type="button">See all ›</button></div>
    <div id="home-featured">${livePlans === null ? '<div class="skel skel-card"></div><div class="skel skel-card"></div>' : ''}</div>`;

  if (balanceVisible) countUp($('#bh-amt'), Number(u.balance || 0));
  $('#bal-eye').onclick = () => { balanceVisible = !balanceVisible; store.set('bgBal', balanceVisible ? 'on' : 'off'); renderHome(); };
    $$('#view-home .quick-item').forEach(b => b.onclick = () => {
    ({ save: () => openDeposit(), plans: () => switchView('plans'),
       withdraw: () => openWithdraw(), refer: () => openSharePicker() })[b.dataset.q]();
  });
  $('#see-plans').onclick = () => switchView('plans');
  tilt3D('.balance-hero');

  try {
    const act = await db.collection('investments').where('uid', '==', currentUser.uid)
      .where('status', '==', 'active').get();
    const bp = $('#bh-plans'); if (bp) bp.textContent = act.size;
  } catch (e) { const bp = $('#bh-plans'); if (bp) bp.textContent = '0'; }

  drawFeaturedPlans();
  drawAnnouncements('#home-ann');
  drawAppContent();
}

/* ── Featured plans (driven by the live plans listener) ── */
function drawFeaturedPlans() {
  const el = $('#home-featured');
  if (!el || livePlans === null) return;
  if (!livePlans.length) { el.innerHTML = `<div class="card empty">${IC.target}<p>No plans live yet — check back soon!</p></div>`; return; }
  el.innerHTML = '';
  livePlans.slice(0, 2).forEach(p => el.appendChild(planCard(p)));
}

/* ══════════ TRUST & ABOUT (admin-editable, live) ══════════ */
const TRUST_ICONS = [IC.shield, IC.zap, IC.bank, IC.checkCircle];
function drawAppContent() {
  const trustEl = $('#home-trust'), aboutEl = $('#home-about');
  if (!trustEl || !aboutEl) return;
  const c = liveContent || {};
  const trust = c.trustPoints && c.trustPoints.length ? c.trustPoints : [
    { t: 'Registered Company', d: 'Verified & compliant' },
    { t: 'Real Lending Model', d: 'Interest from loans' },
    { t: '24h Withdrawals', d: 'Money in 24 hrs' },
    { t: 'Zero Hidden Fees', d: '100% transparent' }
  ];
  trustEl.innerHTML = `
    <div class="card"><div class="trust-strip">
      ${trust.map((x, i) => `<div class="trust-item"><div class="trust-ic">${TRUST_ICONS[i % TRUST_ICONS.length]}</div><span>${esc(x.t)}</span></div>`).join('')}
    </div></div>`;

  const about = c.aboutPoints && c.aboutPoints.length ? c.aboutPoints : [
    { t: 'Your deposits fund real loans', d: 'GodX lends your savings to verified customers and passes the loan interest back to you — daily.' },
    { t: 'Registered & scam-free', d: 'We operate as a registered Indian business with full compliance — your money is never at risk of vanishing.' },
    { t: 'Your money stays liquid', d: 'Withdraw anytime after your plan duration. No lock-in tricks, no penalties.' },
    { t: 'Fully transparent', d: 'Every transaction is visible in your wallet history with receipts and status.' }
  ];
  aboutEl.innerHTML = `
    <div class="sec-head"><h3>${esc(c.aboutTitle || 'Why thousands trust GodX')}</h3></div>
    <div class="card"><div class="about-list">
      ${about.map(a => `<div class="about-row"><div class="about-ic">${IC.checkCircle}</div>
        <div><b>${esc(a.t)}</b><p>${esc(a.d)}</p></div></div>`).join('')}
    </div></div>`;
}

/* ══════════ ANNOUNCEMENTS (live) ══════════ */
function drawAnnouncements(sel) {
  const el = $(sel);
  if (!el || !liveAnnouncements || !liveAnnouncements.length) return;
  let h = `<div class="sec-head"><h3>Announcements</h3></div><div class="card" style="padding:6px 18px">`;
  liveAnnouncements.forEach(a => {
    h += `<div class="ann-item"><div class="dot"></div><div>
      <b>${esc(a.title)}</b><p>${esc(a.body)}</p><time>${fdate(a.createdAt)}</time></div></div>`;
  });
  el.innerHTML = h + '</div>';
}

/* ══════════════════════════════════════════════════════════
   DAILY INTEREST ENGINE
   ──────────────────────────────────────────────────────────
   Model (all anchored to the investment's createdAt server timestamp):
     dailyAmount (paise) = floor(amountPaise × cashbackPct / 100 / durationDays)
     with the rounding remainder folded into the FINAL day so the total
     always equals exactly cashbackAmount.
     Period N becomes due at createdAt + N×86400s — the exact activation
     time, every day. Never midnight.
   Payout is a single Firestore transaction per investment:
     · guarded by a lock doc  locks/<invId>  (multi-tab / refresh safe)
     · reads the investment fresh inside the transaction → idempotent
     · catch-up: pays ALL elapsed unpaid periods in one credit
     · writes ONE interest transaction (per-day breakdown in `days`)
     · stops automatically when interestPaid reaches durationDays
     · principal release stays with admin Plan Payouts
   ══════════════════════════════════════════════════════════ */

const DAY_MS = 86400000;

function invStartMs(i) {
  return i.createdAt && i.createdAt.toMillis ? i.createdAt.toMillis()
       : i.createdAt && i.createdAt.seconds ? i.createdAt.seconds * 1000
       : nowMs();
}
/* per-day interest in paise (day 1-based; final day absorbs rounding) */
function dayPaise(i, day) {
  const amt = paise(i.amount);
  const totalCb = paise(i.cashbackAmount);
  const days = Math.max(1, i.durationDays || 1);
  const base = Math.floor(amt * (i.cashbackPct || 0) / 100 / days);
  if (totalCb > 0) return day === days ? Math.max(0, totalCb - base * (days - 1)) : base;
  return base;
}
/* how many daily periods have fully elapsed (server-corrected time) */
function periodsElapsed(i) {
  const days = Math.max(1, i.durationDays || 1);
  const n = Math.floor((nowMs() - invStartMs(i)) / DAY_MS);
  return Math.max(0, Math.min(days, n));
}
/* ms timestamp when period N falls due */
function periodDueAt(i, n) { return invStartMs(i) + n * DAY_MS; }
function isMatured(i) { return nowMs() >= periodDueAt(i, Math.max(1, i.durationDays || 1)); }
function interestDone(i) { return (i.interestPaid || 0) >= Math.max(1, i.durationDays || 1); }

/* ── Reconcile one investment: credit every due & unpaid daily period ── */
async function reconcileInvestment(invId) {
  const invRef = db.collection('investments').doc(invId);
  const lockRef = db.collection('locks').doc('int_' + invId);
  try {
    const creditedPaise = await db.runTransaction(async tx => {
      // Lock first — a second tab / device fails fast instead of double-crediting
      const lock = await tx.get(lockRef);
      const now = nowMs();
      if (lock.exists) {
        const t = lock.data().t;
        const lockMs = t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0);
        if (now - lockMs < 45000) throw 'locked';
      }
      const snap = await tx.get(invRef);
      if (!snap.exists) throw 'gone';
      const i = snap.data();
      if (i.status !== 'active' || i.uid !== currentUser.uid) throw 'inactive';

      const days = Math.max(1, i.durationDays || 1);
      const paid = i.interestPaid || 0;
      const due = periodsElapsed(i);
      if (due <= paid) return 0; // nothing to do — most common path

      let sum = 0;
      for (let d = paid + 1; d <= due; d++) sum += dayPaise(i, d);
      if (sum <= 0) {
        // zero-interest plan — still advance the counter so we don't re-scan daily
        tx.set(lockRef, { t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.update(invRef, {
          interestPaid: due,
          lastInterestAt: firebase.firestore.FieldValue.serverTimestamp(),
          dailyAmount: fromPaise(dayPaise(i, 1)),
          dailyRate: (i.cashbackPct || 0) / days
        });
        return 0;
      }

      const userRef = db.collection('users').doc(currentUser.uid);
      const txRef = db.collection('transactions').doc();
      const nDays = due - paid;
      const rupees = fromPaise(sum);
      const accrued = Math.round(((i.accruedInterest || 0) + rupees) * 100) / 100;

      tx.set(lockRef, { t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.update(invRef, {
        interestPaid: due,
        accruedInterest: accrued,
        lastInterestAt: firebase.firestore.FieldValue.serverTimestamp(),
        dailyAmount: fromPaise(dayPaise(i, 1)),
        dailyRate: (i.cashbackPct || 0) / days
      });
      tx.update(userRef, {
        balance: firebase.firestore.FieldValue.increment(rupees),
        totalCashback: firebase.firestore.FieldValue.increment(rupees)
      });
      tx.set(txRef, {
        uid: currentUser.uid, type: 'interest', amount: rupees, status: 'completed',
        invId,
        days: { from: paid + 1, to: due },
        note: nDays === 1
          ? `Daily interest · ${i.planName} (day ${due}/${days})`
          : `Daily interest · ${i.planName} (days ${paid + 1}–${due}/${days})`,
        userName: (userDoc && userDoc.data().name) || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return sum;
    });
    return creditedPaise;
  } catch (e) {
    if (e !== 'locked' && e !== 'inactive' && e !== 'gone' && !(e && e.code === 'permission-denied'))
      console.warn('interest reconcile failed:', invId, e);
    return -1;
  }
}

/* ── Engine loop: reconcile all active investments, then schedule the next run ── */
let _engineTimer = null, _engineRunning = false;
function interestEngineStart() {
  interestEngineStop();
  interestEngineRun();
}
function interestEngineStop() {
  if (_engineTimer) { clearTimeout(_engineTimer); _engineTimer = null; }
}
async function interestEngineRun() {
  if (_engineRunning || !currentUser) return;
  _engineRunning = true;
  try {
    const snap = await db.collection('investments')
      .where('uid', '==', currentUser.uid).where('status', '==', 'active').get();
    let creditedTotal = 0, nextDue = Infinity;
    for (const d of snap.docs) {
      const i = d.data();
      const paid = i.interestPaid || 0, due = periodsElapsed(i);
      if (due > paid) {
        const got = await reconcileInvestment(d.id);
        if (got > 0) creditedTotal += got;
      } else if (!interestDone(i)) {
        nextDue = Math.min(nextDue, periodDueAt(i, paid + 1));
      }
      if (!interestDone(i)) nextDue = Math.min(nextDue, periodDueAt(i, (i.interestPaid || 0) + 1));
    }
    if (creditedTotal > 0) {
      confetti(18);
      toast(`Daily interest credited: +${inr2(fromPaise(creditedTotal))} 🎉`, 'ok');
      if (currentView === 'plans') renderPlans();
      if (currentView === 'wallet') renderWallet();
      if (currentView === 'home') renderHome();
    }
    // Wake up exactly when the next period falls due (+2s margin), or re-check hourly
    const delay = nextDue === Infinity ? 3600000 : Math.min(Math.max(nextDue - nowMs() + 2000, 60000), 3600000);
    _engineTimer = setTimeout(interestEngineRun, delay);
  } catch (e) {
    _engineTimer = setTimeout(interestEngineRun, 5 * 60000); // back off on failure
  } finally {
    _engineRunning = false;
  }
}
// Reconcile promptly when the tab regains focus (covers missed periods)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) { syncServerTime(); interestEngineRun(); }
});

/* ══════════ COUNTDOWN REGISTRY ══════════
   Timestamp-derived countdowns — never a naive decrement. One rAF-driven
   1s interval updates every registered chip; zero → reconcile + re-render. */
const CountdownRegistry = {
  items: new Map(),
  timer: null,
  add(key, getTargetMs, el, onZero) {
    if (!el) return;
    this.items.set(key, { getTargetMs, el, onZero, fired: false });
    this.start();
    this.tick();
  },
  remove(key) { this.items.delete(key); },
  clear() { this.items.clear(); if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  },
  tick() {
    if (!this.items.size) return;
    const now = nowMs();
    this.items.forEach((it, key) => {
      if (!document.body.contains(it.el)) { this.items.delete(key); return; }
      const target = it.getTargetMs();
      let ms = target - now;
      if (ms <= 0) {
        it.el.querySelector('.cd-val').textContent = 'crediting…';
        it.el.classList.add('cd-flip');
        if (!it.fired) {
          it.fired = true;
          setTimeout(() => { if (it.onZero) it.onZero(); }, 1200);
        }
        return;
      }
      const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
      const txt = (h > 0 ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
      const v = it.el.querySelector('.cd-val');
      if (v && v.textContent !== txt) v.textContent = txt;
      it.el.classList.toggle('cd-soon', ms < 60000);
    });
  }
};

/* ══════════ PLANS ══════════ */
async function renderPlans() {
  const el = $('#view-plans');
  el.innerHTML = `<div class="banner banner-purple">${IC.spark}
      <div><h4>Savings Plans with Daily Interest</h4>
      <p>Interest lands in your wallet every 24 hours from the exact moment you join. Full terms on every plan.</p></div>
    </div>
    <div id="plans-list">${livePlans === null ? '<div class="skel skel-card"></div><div class="skel skel-card"></div>' : ''}</div>
    <div class="sec-head"><h3>My Active Plans</h3></div>
    <div id="my-plans"><div class="skel skel-card" style="height:130px"></div></div>`;

  drawPlansList();

  try {
    const mine = await db.collection('investments').where('uid', '==', currentUser.uid).get();
    const myEl = $('#my-plans'); if (!myEl) return;
    myEl.innerHTML = '';
    CountdownRegistry.clear();
    const docs = mine.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
    if (!docs.length) myEl.innerHTML = `<div class="card empty">${IC.doc}<p>You haven't joined a plan yet.</p></div>`;
    docs.forEach(d => {
      const i = d.data();
      const chipCls = i.status === 'active' ? 'chip-green' : i.status === 'completed' ? 'chip-blue' : 'chip-amber';
      const started = invStartMs(i);
      const days = Math.max(1, i.durationDays || 1);
      const maturesAt = new Date(periodDueAt(i, days));
      const mdate = maturesAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const isDue = i.status === 'active' && isMatured(i);
      const pct = i.status === 'completed' ? 100
        : Math.max(3, Math.min(100, Math.round((nowMs() - started) / (days * DAY_MS) * 100)));
      const dayNow = Math.max(1, Math.min(days, Math.ceil((nowMs() - started) / DAY_MS)));
      const accrued = i.accruedInterest || 0;
      const paidN = i.interestPaid || 0;
      const rightMeta = i.status === 'completed' ? 'Paid out 🎉'
        : i.status === 'cancelled' ? 'Refunded'
        : isDue ? '✨ Ready for payout'
        : 'Day ' + dayNow + ' / ' + days;

      const div = document.createElement('div');
      div.className = 'card inv-card';
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0"><b style="font-size:.94rem">${esc(i.planName)}</b>
          <div class="muted">Started ${fdt(i.createdAt)} · ${days} days</div></div>
          <span class="chip ${chipCls}">${esc(i.status)}</span></div>
        <div class="divider"></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:.8rem;flex-wrap:wrap">
          <span class="muted">Saved: <b style="color:var(--ink)">${inr(i.amount)}</b></span>
          <span class="muted">Total interest: <b style="color:var(--green)">+${inr2(i.cashbackAmount)}</b></span></div>
        ${i.status === 'active' ? `
        <div class="interest-strip">
          <div class="is-cell"><small>Daily interest</small><b>+${inr2(fromPaise(dayPaise(i, 1)))}</b></div>
          <div class="is-cell"><small>Credited so far</small><b class="is-acc">+${inr2(accrued)}</b><span class="is-days">${paidN}/${days} days paid</span></div>
          ${interestDone(i)
            ? `<div class="is-cell"><small>Interest</small><b style="color:var(--green)">Complete ✓</b></div>`
            : `<div class="cd-chip" id="cd-${d.id}">
                 <span class="cd-ic">${IC.timer}</span>
                 <span class="cd-txt"><small>Next Interest</small><b class="cd-val">—</b></span>
               </div>`}
        </div>` : ''}
        <div class="mp-progress"><i style="width:${pct}%"></i></div>
        <div class="mp-meta"><span>${i.status === 'active' ? 'Matures ' + mdate : pct + '% of duration'}</span><span>${rightMeta}</span></div>
        ${i.status === 'active' ? `<button class="btn btn-danger btn-sm btn-block inv-cancel" id="cancel-${d.id}" type="button" style="margin-top:10px">${IC.alert} Cancel Plan · Refund ${inr(i.amount)}</button>` : ''}
        ${isDue ? `<div class="upi-note" style="margin:10px 0 0">${IC.spark} <b>Plan matured!</b> All interest is paid — your ${inr(i.amount)} principal is being released to your wallet shortly.</div>` : ''}`;
      myEl.appendChild(div);

      // user-initiated plan cancellation (admin can disable via Wallet Limits)
      if (i.status === 'active') {
        const cancelBtn = div.querySelector('#cancel-' + d.id);
        if (cancelBtn) cancelBtn.onclick = () => confirmCancelInvestment(d.id, i);
      }

      // live countdown → exact timestamp of the next unpaid period
      if (i.status === 'active' && !interestDone(i)) {
        const chipEl = div.querySelector('#cd-' + d.id);
        CountdownRegistry.add('cd-' + d.id,
          () => periodDueAt(i, (i.interestPaid || 0) + 1),
          chipEl,
          async () => { await syncServerTime(); await reconcileInvestment(d.id); renderPlans(); });
      }
    });
  } catch (e) {
    const myEl = $('#my-plans');
    if (myEl) myEl.innerHTML = `<div class="card empty">${IC.info}<p>Couldn't load your plans — check connection and reopen this tab.</p></div>`;
  }
}

/* ── Plans list (driven by the live plans listener) ── */
function drawPlansList() {
  const list = $('#plans-list');
  if (!list || livePlans === null) return;
  list.innerHTML = '';
  if (!livePlans.length) { list.innerHTML = `<div class="card empty">${IC.target}<p>No plans available right now.</p></div>`; return; }
  livePlans.forEach(p => list.appendChild(planCard(p)));
}

const PLAN_COLORS = [['#16A34A', '#4ADE80'], ['#2563EB', '#60A5FA'], ['#1D4ED8', '#60A5FA'], ['#0D9488', '#5EEAD4']];
const PLAN_ICONS = [IC.spark, IC.star, IC.zap, IC.gift];
function planCard(p) {
  const idx = (p.minAmount || 0) % 97 % PLAN_COLORS.length;
  const [c1, c2] = PLAN_COLORS[idx];
  const perks = p.perks && p.perks.length ? p.perks : ['Interest credited every 24 hours', 'Withdraw anytime after maturity', 'Full transaction receipts'];
  const dailyPct = p.durationDays ? (p.cashbackPct / p.durationDays) : 0;
  const div = document.createElement('div');
  div.className = 'plan-card';
  div.innerHTML = `
    ${p.popular ? '<div class="ribbon">POPULAR</div>' : ''}
    <div class="pc-head">
      <div><div class="pc-name">${esc(p.name)}</div><div class="pc-sub">${esc(p.tagline || 'Savings plan')}</div></div>
      <div class="pc-badge" style="background:linear-gradient(135deg,${c1},${c2})">${PLAN_ICONS[idx]}</div>
    </div>
    <div class="pc-row">
      <div class="pc-cell"><small>Start with</small><b>${inr(p.minAmount)}</b></div>
      <div class="pc-cell"><small>Total Interest</small><b style="color:var(--green)">${p.cashbackPct}%</b></div>
      <div class="pc-cell"><small>Daily</small><b style="color:var(--green)">${dailyPct.toFixed(2)}%</b></div>
      <div class="pc-cell"><small>Duration</small><b>${p.durationDays}d</b></div>
    </div>
    <div class="pc-perks">${perks.map(k => `<div class="pc-perk">${IC.check}<span>${esc(k)}</span></div>`).join('')}</div>
    <button class="btn btn-primary btn-block" type="button">Start Saving ${inr(p.minAmount)}</button>`;
  div.querySelector('.btn').onclick = () => joinPlan(p.id, p);
  return div;
}

function joinPlan(planId, p) {
  const u = userDoc.data();
  const sheet = openSheet(`
    <div class="sheet-title">Join ${esc(p.name)}</div>
    <div class="sheet-sub">${p.cashbackPct}% interest over ${p.durationDays} days — credited <b>daily</b> to your wallet · balance ${inr(u.balance)}</div>
    <div class="amount-input"><span>₹</span><input id="join-amt" type="number" inputmode="numeric" placeholder="${p.minAmount}" min="${p.minAmount}"></div>
    <div class="amount-quick">${[p.minAmount, p.minAmount * 2, p.minAmount * 5].map(a => `<button type="button" data-a="${a}">${inr(a)}</button>`).join('')}</div>
    <div class="upi-note"><b>How it works:</b> the amount moves from your wallet into the plan.
    Every 24 hours from now, <b>${(p.cashbackPct / p.durationDays).toFixed(2)}%</b> of your amount lands back in your wallet as interest.
    At maturity your principal is released too. Early exit returns your principal — already-paid interest is yours to keep.</div>
    <button class="btn btn-primary btn-block" id="join-go" type="button">Confirm & Start Plan</button>`);
  sheet.querySelectorAll('.amount-quick button').forEach(b => b.onclick = () => sheet.querySelector('#join-amt').value = b.dataset.a);
  let _joinInFlight = false; // idempotency flag — prevents double-tap double-debit
  sheet.querySelector('#join-go').onclick = async () => {
    if (_joinInFlight) return; // hard guard: ignore every tap while a commit is in-flight
    const btn = sheet.querySelector('#join-go');
    const amt = Number(sheet.querySelector('#join-amt').value);
    if (!amt || amt < p.minAmount) return toast(`Minimum for this plan is ${inr(p.minAmount)}`, 'err');
    _joinInFlight = true;
    btn.classList.add('loading'); btn.disabled = true;
    try {
      const interest = Math.round(amt * p.cashbackPct / 100 * 100) / 100;
      const userRef = db.collection('users').doc(currentUser.uid);
      const invRef = db.collection('investments').doc();
      const txRef = db.collection('transactions').doc();
      const days = Math.max(1, p.durationDays || 1);
      // ATOMIC transaction: balance is re-read inside → stale-cache exploits and
      // negative balances are structurally impossible (rules also cap self-debits).
      await db.runTransaction(async tx => {
        const uSnap = await tx.get(userRef);
        const liveBalance = uSnap.exists ? (uSnap.data().balance || 0) : 0;
        if (amt > liveBalance) throw 'insufficient';
        tx.set(invRef, { uid: currentUser.uid, planId, planName: p.name, amount: amt,
          cashbackPct: p.cashbackPct, cashbackAmount: interest, durationDays: p.durationDays,
          dailyAmount: Math.round(amt * p.cashbackPct / 100 / days * 100) / 100,
          dailyRate: Math.round(p.cashbackPct / days * 10000) / 10000,
          interestPaid: 0, accruedInterest: 0, lastInterestAt: null,
          status: 'active', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        tx.update(userRef, {
          balance: firebase.firestore.FieldValue.increment(-amt),
          totalSaved: firebase.firestore.FieldValue.increment(amt) });
        tx.set(txRef, {
          uid: currentUser.uid, type: 'invest', amount: amt, status: 'completed',
          note: `Joined ${p.name}`, userName: u.name || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      closeSheet();
      confetti(34);
      toast(`You're in! First interest credit in 24h — ${inr2(interest)} total 🎉`, 'ok');
      interestEngineRun(); // schedule the wake-up for this new plan
      if (currentView === 'plans') renderPlans();
      if (currentView === 'home') renderHome();
    } catch (e) {
      _joinInFlight = false;
      btn.classList.remove('loading'); btn.disabled = false;
      if (e === 'insufficient') { closeSheet(); toast('Insufficient balance — add money first', 'err'); }
      else toast('Could not join plan — try again', 'err');
    }
  };
}

/* ══════════ USER PLAN CANCELLATION — instant principal refund ══════════
   Mirrors the admin cancel: one atomic Firestore transaction that re-reads
   the investment inside, flips it to 'cancelled', refunds the principal to
   the wallet, reverses totalSaved, and writes a 'refund' receipt. Any daily
   interest due so far is reconciled (credited) FIRST so the user keeps
   everything already earned. Double-tap / multi-tab safe via an in-flight
   flag + the status check inside the transaction. */
let _cancelInFlight = {};

function confirmCancelInvestment(invId, i) {
  const s = openSheet(`
    <div class="sheet-title">Cancel ${esc(i.planName)}?</div>
    <div class="sheet-sub">Your principal of <b>${inr(i.amount)}</b> returns to your wallet immediately.
    Daily interest already credited (${inr2(i.accruedInterest || 0)}) stays yours — no fees, no penalty.</div>
    <div class="upi-note"><b>This can't be undone.</b> The plan stops earning interest from the moment you confirm.</div>
    <div style="height:14px"></div>
    <button class="btn btn-danger btn-block" id="cx-yes" type="button">Yes, Cancel & Refund ${inr(i.amount)}</button>
    <div style="height:8px"></div>
    <button class="btn btn-ghost btn-block" id="cx-no" type="button">Keep My Plan</button>`);
  s.querySelector('#cx-no').onclick = closeSheet;
  s.querySelector('#cx-yes').onclick = () => { closeSheet(); cancelInvestment(invId, i); };
}

async function cancelInvestment(invId, i) {
  if (_cancelInFlight[invId]) return;
  _cancelInFlight[invId] = true;
  showLoader('Cancelling plan…');
  try {
    const cfg = await walletCfg(true); // fresh — admin may have just toggled it
    if (!cfg.allowCancel) throw 'disabled';
    await reconcileInvestment(invId); // credit every due daily interest first — user keeps it
    const invRef = db.collection('investments').doc(invId);
    const userRef = db.collection('users').doc(currentUser.uid);
    const txRef = db.collection('transactions').doc();
    await db.runTransaction(async tx => {
      const snap = await tx.get(invRef);
      if (!snap.exists) throw 'gone';
      const inv = snap.data();
      if (inv.status !== 'active' || inv.uid !== currentUser.uid) throw 'already';
      tx.update(invRef, { status: 'cancelled', cancelReason: 'user',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp() });
      tx.update(userRef, {
        balance: firebase.firestore.FieldValue.increment(inv.amount || 0),
        totalSaved: firebase.firestore.FieldValue.increment(-(inv.amount || 0)) });
      tx.set(txRef, {
        uid: currentUser.uid, type: 'refund', amount: inv.amount, status: 'completed',
        invId, note: `${inv.planName} cancelled by you — principal refunded`,
        userName: (userDoc && userDoc.data().name) || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    hideLoader();
    confetti(18);
    toast(`Plan cancelled — ${inr(i.amount)} refunded to your wallet ✓`, 'ok');
    if (currentView === 'plans') renderPlans();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'home') renderHome();
  } catch (e) {
    hideLoader();
    if (e === 'disabled') toast('Plan cancellation is currently disabled by admin', 'err');
    else if (e === 'already') { toast('This plan was already settled or cancelled', ''); if (currentView === 'plans') renderPlans(); }
    else toast('Cancel failed — check connection & retry', 'err');
  } finally {
    _cancelInFlight[invId] = false;
  }
}

/* ══════════ WALLET ══════════ */
async function renderWallet() {
  const u = userDoc.data();
  const el = $('#view-wallet');
  el.innerHTML = `
    <div class="wallet-hero">
      <div class="wh-top"><span class="wh-label">Available Balance</span>
        <span class="wh-chip">${IC.shield} Verified</span></div>
      <div class="wh-bal">${balanceVisible ? inr(u.balance) : '₹ ••••••'}</div>
      <div class="wh-growth" role="status" aria-label="Interest earned so far">
        <span class="wh-up-arrow" aria-hidden="true">${IC.up}</span>
        <span>${balanceVisible ? '+' + inr2(u.totalCashback || 0) : '+₹ •••'} earned · your money is growing daily</span>
      </div>
      <div class="wh-btns">
        <button class="btn" id="w-dep" type="button">${IC.downLeft} Add Money</button>
        <button class="btn" id="w-wd" type="button">${IC.upRight} Withdraw</button>
      </div>
    </div>

    <div class="sec-head"><h3>My Bank Account</h3></div>
    <div id="bank-slot"></div>

    <div class="stat-grid">
      <div class="stat-cell"><div class="stat-ic" style="background:linear-gradient(135deg,#16A34A,#4ADE80)">${IC.downLeft}</div>
        <div><small>Total Deposits</small><b>${inr(u.totalDeposits || 0)}</b></div></div>
      <div class="stat-cell"><div class="stat-ic" style="background:linear-gradient(135deg,#DC2626,#F87171)">${IC.upRight}</div>
        <div><small>Total Withdrawn</small><b>${inr(u.totalWithdrawn || 0)}</b></div></div>
      <div class="stat-cell"><div class="stat-ic" style="background:linear-gradient(135deg,#2563EB,#60A5FA)">${IC.target}</div>
        <div><small>Total Saved</small><b>${inr(u.totalSaved || 0)}</b></div></div>
      <div class="stat-cell"><div class="stat-ic" style="background:linear-gradient(135deg,#0D9488,#5EEAD4)">${IC.gift}</div>
        <div><small>Interest Earned</small><b>${inr2(u.totalCashback || 0)}</b></div></div>
    </div>
    <div class="sec-head"><h3>Transaction History</h3></div>
    <div class="card" style="padding:6px 18px" id="tx-list"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div>`;

  $('#w-dep').onclick = openDeposit;
  $('#w-wd').onclick = openWithdraw;
  tilt3D('.wallet-hero');
  renderBankSlot();

  try {
    const tx = await db.collection('transactions').where('uid', '==', currentUser.uid).limit(60).get();
    const list = $('#tx-list'); if (!list) return;
    const docs = tx.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)).slice(0, 30);
    if (!docs.length) { list.innerHTML = `<div class="empty">${IC.doc}<p>No transactions yet. Add money to get started!</p></div>`; return; }
    list.innerHTML = '';
    docs.forEach((d, i) => {
      const t = d.data();
      const isIn = ['deposit', 'interest', 'maturity', 'cashback', 'refund'].includes(t.type);
      const cls = (t.type === 'interest' || t.type === 'cashback') ? 'tx-cb' : isIn ? 'tx-in' : 'tx-out';
      const icon = t.type === 'interest' ? IC.timer : t.type === 'cashback' ? IC.gift : t.type === 'maturity' ? IC.party : isIn ? IC.downLeft : IC.upRight;
      const labels = { deposit: 'Wallet Deposit', withdraw: t.note || 'Withdrawal', invest: t.note || 'Plan Investment',
                       interest: t.note || 'Daily Interest', maturity: t.note || 'Plan Maturity Payout',
                       cashback: t.note || 'Cashback Reward', refund: t.note || 'Refund' };
      const chipCls = t.status === 'pending' ? 'chip-amber' : t.status === 'completed' ? 'chip-green' : 'chip-red';
      const row = document.createElement('div');
      row.className = 'tx-item';
      row.style.animationDelay = Math.min(i * 40, 400) + 'ms';
      row.innerHTML = `
        <div class="tx-ic ${cls}">${icon}</div>
        <div class="tx-mid"><b>${esc(labels[t.type] || t.type)}</b><small>${fdt(t.createdAt)} · #${d.id.slice(0, 8).toUpperCase()}${t.utr ? ' · UTR ' + esc(t.utr) : ''}</small></div>
        <div class="tx-right"><b class="${isIn ? 'tx-amt-in' : 'tx-amt-out'}">${isIn ? '+' : '−'}${inr2(t.amount)}</b>
        <span class="chip ${chipCls}" style="margin-top:3px">${esc(t.status)}</span></div>`;
      list.appendChild(row);
    });
  } catch (e) {
    const list = $('#tx-list');
    if (list) list.innerHTML = `<div class="empty">${IC.info}<p>Couldn't load transactions.</p></div>`;
  }
}

/* ── My bank account slot in wallet ── */
function renderBankSlot() {
  const u = userDoc.data();
  const bd = u.bankDetails;
  const slot = $('#bank-slot');
  if (!slot) return;
  if (bd && bd.accountNumber) {
    slot.innerHTML = `
      <div class="bank-card" style="margin-bottom:12px">
        <button class="bc-edit" id="bd-edit" type="button" aria-label="Edit bank details">${IC.edit}</button>
        <div class="bc-chip"></div>
        <div class="bc-num">•••• ${esc(String(bd.accountNumber).slice(-4))}</div>
        <div class="bc-row">
          <div><small>Account Holder</small><b>${esc(bd.holderName)}</b></div>
          <div><small>Bank</small><b>${esc(bd.bankName)}</b></div>
          <div><small>IFSC</small><b>${esc(bd.ifsc)}</b></div>
        </div>
      </div>
      <button class="btn btn-ghost btn-block btn-sm" id="bd-open" type="button" style="margin-bottom:14px">${IC.bank} View / Edit Full Details</button>
      <div style="height:2px"></div>`;
    $('#bd-edit').onclick = () => bankEditor(bd);
    $('#bd-open').onclick = () => bankEditor(bd);
  } else {
    slot.innerHTML = `
      <button class="bank-empty btn-block" id="bd-add" type="button" style="margin-bottom:14px">
        <div class="be-ic">${IC.bank}</div>
        <div style="flex:1;min-width:0"><b>Add your bank account</b>
        <p>Needed to receive withdrawals — takes 30 seconds</p></div>
        ${IC.arrowR}
      </button>`;
    $('#bd-add').onclick = () => bankEditor(null);
  }
  tilt3D('.bank-card'); // 3D tilt applies whether or not a bank card exists yet
}

/* ── Bank details add / edit ── */
function bankEditor(bd) {
  bd = bd || {};
  const s = openSheet(`
    <div class="sheet-title">${bd.accountNumber ? 'Edit Bank Details' : 'Add Bank Account'}</div>
    <div class="sheet-sub">Withdrawals are paid to this account · verified before every payout</div>
    <label class="field"><span>Account Holder Name</span><input id="bk-name" value="${esc(bd.holderName || userDoc.data().name || '')}" placeholder="As per bank records"></label>
    <div style="height:12px"></div>
    <label class="field"><span>Bank Name</span><input id="bk-bank" value="${esc(bd.bankName || '')}" placeholder="e.g. State Bank of India"></label>
    <div style="height:12px"></div>
    <label class="field"><span>Account Number</span><input id="bk-acc" inputmode="numeric" value="${esc(bd.accountNumber || '')}" placeholder="e.g. 50100234567890"></label>
    <div style="height:12px"></div>
    <label class="field"><span>IFSC Code</span><input id="bk-ifsc" value="${esc(bd.ifsc || '')}" placeholder="e.g. SBIN0001234" style="text-transform:uppercase"></label>
    <div style="height:12px"></div>
    <label class="field"><span>UPI ID <em>(optional)</em></span><input id="bk-upi" value="${esc(bd.upiId || '')}" placeholder="yourname@upi"></label>
    <div style="height:18px"></div>
    <div class="upi-note"><b>🔒 Safe & private.</b> Your bank details are encrypted, visible only to you and the payout team, and used solely for withdrawals you request.</div>
    <button class="btn btn-primary btn-block" id="bk-save" type="button">Save Bank Details</button>`);
  s.querySelector('#bk-save').onclick = async () => {
    const btn = s.querySelector('#bk-save');
    const holderName = s.querySelector('#bk-name').value.trim();
    const bankName = s.querySelector('#bk-bank').value.trim();
    const accountNumber = s.querySelector('#bk-acc').value.replace(/\s/g, '');
    const ifsc = s.querySelector('#bk-ifsc').value.trim().toUpperCase();
    const upiId = s.querySelector('#bk-upi').value.trim();
    if (holderName.length < 3) return toast('Enter the account holder name', 'err');
    if (!bankName) return toast('Enter your bank name', 'err');
    if (!/^\d{8,18}$/.test(accountNumber)) return toast('Account number must be 8–18 digits', 'err');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return toast('Enter a valid IFSC (e.g. SBIN0001234)', 'err');
    if (upiId && !/^\S+@\S+$/.test(upiId)) return toast('UPI ID looks invalid (e.g. name@upi)', 'err');
    btn.classList.add('loading'); btn.disabled = true;
    try {
      await db.collection('users').doc(currentUser.uid).update({
        bankDetails: { holderName, bankName, accountNumber, ifsc, upiId: upiId || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() } });
      closeSheet();
      confetti(20);
      toast(bd.accountNumber ? 'Bank details updated ✓' : 'Bank account added ✓', 'ok');
    } catch (e) {
      btn.classList.remove('loading'); btn.disabled = false;
      toast('Could not save — try again', 'err');
    }
  };
}

/* ══════════ DEPOSIT — admin payment method → UTR + screenshot proof ══════════ */
async function openDeposit() {
  const cfg = await walletCfg(); // admin-set minimum, live
  const sheet = openSheet(`
    <div class="sheet-title">Add Money to Wallet</div>
    <div class="sheet-sub">Pay via UPI / bank transfer · verified & credited by our team · minimum ${inr(cfg.minDeposit)}</div>
    <div class="amount-input"><span>₹</span><input id="dep-amt" type="number" inputmode="numeric" placeholder="${Math.max(500, cfg.minDeposit)}" min="${cfg.minDeposit}"></div>
    <div class="amount-quick">${[100, 300, 500, 1000].map(a => `<button type="button" data-a="${a}">₹${a}</button>`).join('')}</div>
    <div class="upi-note"><b>How deposits work:</b> choose an amount, pay to the official account shown next,
    then enter your <b>UTR / reference number</b> and upload a <b>payment screenshot</b>.
    Your wallet is credited after verification (usually under 30 minutes).</div>
    <button class="btn btn-primary btn-block" id="dep-go" type="button">Continue</button>`);
  sheet.querySelectorAll('.amount-quick button').forEach(b => b.onclick = () => sheet.querySelector('#dep-amt').value = b.dataset.a);
  sheet.querySelector('#dep-go').onclick = async () => {
    const cfg = await walletCfg();
    const amt = Number(sheet.querySelector('#dep-amt').value);
    if (!amt || amt < cfg.minDeposit) return toast(`Minimum deposit is ${inr(cfg.minDeposit)}`, 'err');
    if (!Number.isFinite(amt) || amt > 1000000) return toast('Enter a valid amount', 'err');
    depositStepMethod(amt);
  };
}

/* step 2: pick an admin-published payment method */
async function depositStepMethod(amt) {
  const sheet = openSheet(`
    <div class="sheet-title">Pay ${inr(amt)}</div>
    <div class="sheet-sub">Use any UPI app (GPay / PhonePe / Paytm) or net banking, then tap "I've Paid"</div>
    <div id="dep-methods"><div class="skel skel-row"></div><div class="skel skel-row"></div></div>`);
  let methods = [];
  try {
    const snap = await db.collection('paymentMethods').where('active', '==', true).get();
    methods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {}
  const box = sheet.querySelector('#dep-methods');
  if (!methods.length) {
    box.innerHTML = `<div class="empty">${IC.info}<p>Deposits aren't open right now.<br>Please try again shortly or contact support.</p></div>`;
    return;
  }
  let sel = methods[0];
  /* per-field copyable detail row — copy button sits on the RIGHT of each value */
  const cpRow = (label, val) => `
    <div class="cp-row">
      <div class="cp-mid"><small>${esc(label)}</small><b>${esc(val || '—')}</b></div>
      <button class="cp-btn" type="button" data-cpv="${esc(val || '')}" data-cpl="${esc(label)}" aria-label="Copy ${esc(label)}">${IC.copy}</button>
    </div>`;
  const draw = () => {
    box.innerHTML = methods.map(m => `
      <div class="paym ${m.id === sel.id ? 'sel' : ''}" data-id="${m.id}">
        <div class="paym-head">
          <span class="chip ${m.type === 'upi' ? 'chip-blue' : 'chip-green'}">${m.type === 'upi' ? 'UPI' : 'BANK'}</span>
          <b>${esc(m.label || (m.type === 'upi' ? 'UPI Payment' : 'Bank Transfer'))}</b>
        </div>
        ${m.type === 'upi'
          ? `<div class="upi-id-pill upi-id-pill-row"><span>${esc(m.upiId)}</span>
               <button class="cp-btn cp-btn-pill" type="button" data-cpv="${esc(m.upiId)}" data-cpl="UPI ID" aria-label="Copy UPI ID">${IC.copy}</button>
             </div>`
          : `<div class="cp-list">
              ${cpRow('Account Name', m.accountName)}
              ${cpRow('Account Number', m.accountNumber)}
              ${cpRow('IFSC Code', m.ifsc)}
              ${cpRow('Bank Name', m.bankName)}
            </div>`}
        ${m.note ? `<p class="muted" style="margin-top:8px">${esc(m.note)}</p>` : ''}
        <button class="btn btn-soft btn-sm" type="button" data-copy="${m.id}">${IC.copy} Copy All Details</button>
      </div>`).join('') +
      `<div style="height:6px"></div>
       <button class="btn btn-primary btn-block" id="dep-paid" type="button">${IC.check} I've Paid — Submit Proof</button>`;
    box.querySelectorAll('.paym').forEach(pm => pm.onclick = e => {
      if (e.target.closest('[data-copy]') || e.target.closest('[data-cpv]')) return;
      sel = methods.find(x => x.id === pm.dataset.id); draw();
    });
    /* individual field copy buttons (name, account no, IFSC, bank, UPI id) */
    box.querySelectorAll('[data-cpv]').forEach(b => b.onclick = () => {
      navigator.clipboard?.writeText(b.dataset.cpv);
      b.classList.add('cp-done');
      setTimeout(() => b.classList.remove('cp-done'), 1200);
      toast(b.dataset.cpl + ' copied', 'ok');
    });
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const m = methods.find(x => x.id === b.dataset.copy);
      const txt = m.type === 'upi' ? `Pay to UPI: ${m.upiId}` :
        `Bank: ${m.bankName}\nA/C Name: ${m.accountName}\nA/C No: ${m.accountNumber}\nIFSC: ${m.ifsc}`;
      navigator.clipboard?.writeText(txt);
      toast('Payment details copied', 'ok');
    });
    box.querySelector('#dep-paid').onclick = () => depositStepProof(amt, sel);
  };
  draw();
}

/* step 3: UTR + screenshot */
function depositStepProof(amt, method) {
  let proofData = null;
  const sheet = openSheet(`
    <div class="sheet-title">Verify Your Payment</div>
    <div class="sheet-sub">${inr(amt)} paid to <b>${esc(method.label || 'official account')}</b> · find the 12-digit UTR in your UPI app's payment details</div>
    <label class="field"><span>UTR / Reference Number</span><input id="dep-utr" inputmode="numeric" maxlength="22" placeholder="e.g. 418723456789"></label>
    <div style="height:14px"></div>
    <input type="file" id="dep-proof" accept="image/*" hidden>
    <label class="file-drop" for="dep-proof" id="dep-drop">
      ${IC.upload}<b>Upload payment screenshot</b><small>JPG / PNG · auto-compressed</small>
    </label>
    <img id="dep-preview" class="proof-preview hidden" alt="Payment proof preview">
    <div style="height:6px"></div>
    <button class="btn btn-primary btn-block" id="dep-submit" type="button">Submit for Verification</button>
    <p class="muted" style="text-align:center;margin-top:10px">Fake or mismatched proofs lead to account review. One deposit per payment.</p>`);

  sheet.querySelector('#dep-proof').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('Please choose an image file', 'err');
    try {
      proofData = await readImageCompressed(file, 900, .72);
      if (proofData.length > 750000) return toast('Screenshot too large — please crop it and retry', 'err');
      const pv = sheet.querySelector('#dep-preview');
      pv.src = proofData; pv.classList.remove('hidden');
      sheet.querySelector('#dep-drop').innerHTML = `${IC.checkCircle}<b>Screenshot attached ✓</b><small>Tap to replace</small>`;
    } catch (err) { toast('Could not read image — try another', 'err'); }
  };

  let _depInFlight = false;
  sheet.querySelector('#dep-submit').onclick = async () => {
    if (_depInFlight) return;
    const btn = sheet.querySelector('#dep-submit');
    const utr = sheet.querySelector('#dep-utr').value.trim().toUpperCase();
    if (!/^[A-Za-z0-9]{8,22}$/.test(utr)) return toast('Enter a valid UTR / reference number (8–22 characters)', 'err');
    if (!proofData) return toast('Please upload your payment screenshot', 'err');
    _depInFlight = true;
    btn.classList.add('loading'); btn.disabled = true;
    showLoader('Submitting proof…');
    try {
      // ── Duplicate-UTR guard: the deterministic doc id dep_<UTR> makes the same
      //    payment impossible to submit twice (across users, tabs and retries).
      //    NOTE: a collection-wide where('utr') query is denied by the security
      //    rules for non-admins, so the doc-id check below is the authoritative guard ──
      const depositRef = db.collection('transactions').doc('dep_' + utr);
      const existing = await depositRef.get();
      if (existing.exists) {
        hideLoader(); _depInFlight = false;
        btn.classList.remove('loading'); btn.disabled = false;
        return toast('This deposit was already submitted — check Transaction History.', 'err');
      }
      await depositRef.set({
        uid: currentUser.uid, type: 'deposit', amount: amt, status: 'pending',
        utr, proof: proofData,
        payMethod: { id: method.id, label: method.label || '', type: method.type,
          upiId: method.upiId || null, accountNumber: method.accountNumber || null },
        note: 'Awaiting payment verification',
        userName: (userDoc && userDoc.data().name) || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      hideLoader();
      const ok = openSheet(`
        <div class="success-check">${IC.check}</div>
        <div class="sheet-title" style="text-align:center">Deposit Submitted!</div>
        <div class="sheet-sub" style="text-align:center">We're verifying your payment of <b>${inr(amt)}</b> (UTR ${esc(utr)}).
        Your wallet will be credited shortly — watch the status in Transaction History.</div>
        <button class="btn btn-primary btn-block" id="ok-done" type="button">Done</button>`);
      ok.querySelector('#ok-done').onclick = () => { closeSheet(); if (currentView === 'wallet') renderWallet(); };
      confetti(30);
      if (currentView === 'wallet') renderWallet();
    } catch (e) {
      hideLoader(); _depInFlight = false;
      btn.classList.remove('loading'); btn.disabled = false;
      toast('Submission failed — check connection & retry', 'err');
    }
  };
}

/* compress an image file to a data URL (max dimension, jpeg quality) */
function readImageCompressed(file, maxDim, quality) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = rej;
      img.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ══════════ WITHDRAW — to saved bank account / UPI ══════════ */
async function openWithdraw() {
  const cfg = await walletCfg(); // admin-set minimum, live
  const u = userDoc.data();
  const bd = u.bankDetails;
  const hasBank = bd && bd.accountNumber;
  const hasUpi = bd && bd.upiId;
  let dest = hasBank ? 'bank' : (hasUpi ? 'upi' : null);
  let _wdInFlight = false; // idempotency flag — prevents double-tap double-debit
  const sheet = openSheet(`
    <div class="sheet-title">Withdraw Funds</div>
    <div class="sheet-sub">Available: ${inr(u.balance)} · paid within 24 hrs after review</div>
    <div class="amount-input"><span>₹</span><input id="wd-amt" type="number" inputmode="numeric" placeholder="${cfg.minWithdraw}" min="${cfg.minWithdraw}"></div>
    <div style="height:8px"></div>
    <div class="sheet-sub" style="margin-bottom:8px;font-weight:800;color:var(--ink)">Receive money in</div>
    <div id="wd-dests">
      ${hasBank ? `
      <div class="dest ${dest === 'bank' ? 'sel' : ''}" data-d="bank">
        <div class="dest-ic">${IC.bank}</div>
        <div><b>${esc(bd.bankName)} •••• ${esc(String(bd.accountNumber).slice(-4))}</b>
        <small>${esc(bd.holderName)} · IFSC ${esc(bd.ifsc)}</small></div>
        ${IC.checkCircle.replace('<svg', '<svg class="dest-ck"')}
      </div>` : ''}
      ${hasUpi ? `
      <div class="dest ${dest === 'upi' ? 'sel' : ''}" data-d="upi">
        <div class="dest-ic">${IC.zap}</div>
        <div><b>${esc(bd.upiId)}</b><small>UPI transfer</small></div>
        ${IC.checkCircle.replace('<svg', '<svg class="dest-ck"')}
      </div>` : ''}
      ${!hasBank && !hasUpi ? `
      <button class="bank-empty btn-block" id="wd-addbank" type="button">
        <div class="be-ic">${IC.bank}</div>
        <div style="flex:1;min-width:0"><b>Add a bank account first</b>
        <p>Withdrawals need a verified destination</p></div>${IC.arrowR}
      </button>` : ''}
    </div>
    <div style="height:6px"></div>
    <div class="upi-note"><b>No lock-in, no fees.</b> Withdrawals are reviewed for security and paid out
    within 24 hours. Money in active plans becomes available when the plan completes.</div>
    ${(hasBank || hasUpi) ? '<button class="btn btn-primary btn-block" id="wd-go" type="button">Request Withdrawal</button>' : ''}`);

  const addBtn = sheet.querySelector('#wd-addbank');
  if (addBtn) addBtn.onclick = () => bankEditor(null);
  sheet.querySelectorAll('.dest').forEach(d => d.onclick = () => {
    dest = d.dataset.d;
    sheet.querySelectorAll('.dest').forEach(x => x.classList.toggle('sel', x.dataset.d === dest));
  });
  const go = sheet.querySelector('#wd-go');
  if (!go) return;
  go.onclick = async () => {
    if (_wdInFlight) return; // hard guard: ignore every tap while a commit is in-flight
    const btn = go;
    const amt = Number(sheet.querySelector('#wd-amt').value);
    if (!amt || amt < cfg.minWithdraw) return toast(`Minimum withdrawal is ${inr(cfg.minWithdraw)}`, 'err');
    if (!Number.isFinite(amt)) return toast('Enter a valid amount', 'err');
    if (!dest) return toast('Choose where to receive the money', 'err');
    _wdInFlight = true;
    btn.classList.add('loading'); btn.disabled = true;
    try {
      const destInfo = dest === 'bank'
        ? { method: 'bank', holderName: bd.holderName, bankName: bd.bankName, accountNumber: bd.accountNumber, ifsc: bd.ifsc }
        : { method: 'upi', upiId: bd.upiId };
      const userRef = db.collection('users').doc(currentUser.uid);
      const txRef = db.collection('transactions').doc();
      // ATOMIC: balance re-read & validated inside the transaction — the hold can
      // never exceed the real balance, even with two tabs racing.
      await db.runTransaction(async tx => {
        const uSnap = await tx.get(userRef);
        const liveBalance = uSnap.exists ? (uSnap.data().balance || 0) : 0;
        if (amt > liveBalance) throw 'insufficient';
        tx.set(txRef, {
          uid: currentUser.uid, type: 'withdraw', amount: amt, status: 'pending',
          withdrawTo: destInfo,
          note: dest === 'bank' ? `To ${bd.bankName} •••• ${String(bd.accountNumber).slice(-4)}` : 'To UPI: ' + bd.upiId,
          userName: u.name || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        tx.update(userRef, { balance: firebase.firestore.FieldValue.increment(-amt) });
      });
      closeSheet();
      toast('Withdrawal requested — paid within 24 hrs', 'ok');
      if (currentView === 'wallet') renderWallet();
    } catch (e) {
      _wdInFlight = false;
      btn.classList.remove('loading'); btn.disabled = false;
      if (e === 'insufficient') toast('Amount exceeds available balance', 'err');
      else toast('Request failed — try again', 'err');
    }
  };
}

/* ══════════ REFER ══════════ */
function showRefer() {
  const u = userDoc.data();
  const rc = refCfg();
  const triggerText = rc.trigger === 'first_plan' ? 'completes their first plan' : 'makes their first deposit';
  const s = openSheet(`
    <div class="sheet-title">${esc(rc.title)} 🎁</div>
    <div class="sheet-sub">${esc(rc.description)}<br><br><b>You earn ₹${rc.referrerAmount}</b> and <b>they get ₹${rc.referredAmount}</b> when they ${triggerText}${rc.minDeposit > 0 ? ' (min ₹' + rc.minDeposit + ')' : ''}.</div>
    <div class="ref-box" style="margin-top:0"><b>${esc(u.referralCode || '—')}</b>
      <div>
        <button class="btn btn-soft btn-sm" id="cp-ref2" type="button">${IC.copy} Copy</button>
        <button class="btn btn-green btn-sm" id="sh-ref2" type="button">${IC.share} Share</button>
      </div></div>`);
  s.querySelector('#cp-ref2').onclick = () => { navigator.clipboard?.writeText(u.referralCode); toast('Referral code copied', 'ok'); };
  s.querySelector('#sh-ref2').onclick = () => { closeSheet(); openSharePicker(); };
}

/* ══════════ SETTINGS ══════════ */
async function renderSettings() {
  const u = userDoc.data();
  const el = $('#view-settings');
  el.innerHTML = `
    <div class="pf-hero">
      <div class="pf-orb pf-orb-1"></div>
      <div class="pf-orb pf-orb-2"></div>
      <div class="pf-av"><span>${esc((u.name || 'B')[0].toUpperCase())}</span></div>
      <div class="pf-info">
        <b>${esc(u.name)}</b>
        <p>${esc(u.email)}</p>
        ${u.phone ? `<span class="pf-phone">${IC.phone} ${esc(u.phone)}</span>` : ''}
      </div>
      <button class="pf-edit" id="pf-edit" type="button" aria-label="Edit profile">${IC.edit}</button>
    </div>

    <div class="ref-card">
      <div class="ref-head">
        <div class="ref-ic">${IC.gift}</div>
        <div><b>${esc(refCfg().title)} ₹${refCfg().referrerAmount}</b><p>${esc(refCfg().description)}</p></div>
      </div>
      <div class="ref-code">
        <div class="ref-code-val"><small>Your code</small><b>${esc(u.referralCode || '—')}</b></div>
        <div class="ref-actions">
          <button class="ref-btn" id="cp-ref" type="button">${IC.copy} Copy</button>
          <button class="ref-btn ref-btn-gold" id="sh-ref" type="button">${IC.share} Share</button>
        </div>
      </div>
    </div>

    <div class="set-group"><h4>Account</h4>
      <button class="set-item" data-s="edit" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#2563EB,#60A5FA)">${IC.user}</div>
        <div class="set-mid"><b>Edit Profile</b><small>Name &amp; phone number</small></div>${IC.arrowR}</button>
      <button class="set-item" data-s="bank" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#4F46E5,#818CF8)">${IC.bank}</div>
        <div class="set-mid"><b>Bank Details</b><small>${u.bankDetails && u.bankDetails.accountNumber ? esc(u.bankDetails.bankName) + ' •••• ' + esc(String(u.bankDetails.accountNumber).slice(-4)) : 'Add account for withdrawals'}</small></div>${IC.arrowR}</button>
      <button class="set-item" data-s="kyc" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#16A34A,#4ADE80)">${IC.lock}</div>
        <div class="set-mid"><b>Security</b><small>Change password, sessions</small></div>${IC.arrowR}</button>
      <button class="set-item" data-s="tx" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#0D9488,#5EEAD4)">${IC.doc}</div>
        <div class="set-mid"><b>Statements</b><small>Full transaction history</small></div>${IC.arrowR}</button>
    </div>

    <div class="set-group"><h4>Preferences</h4>
      <div class="set-item"><div class="set-ic" style="background:linear-gradient(135deg,#4F46E5,#818CF8)">${IC.bell}</div>
        <div class="set-mid"><b>Notifications</b><small>Interest &amp; plan alerts</small></div>
        <div class="switch ${store.get('bgNotif', 'on') !== 'off' ? 'on' : ''}" id="sw-notif" role="switch"></div></div>
      <div class="set-item"><div class="set-ic" style="background:linear-gradient(135deg,#0D9488,#2DD4BF)">${IC.eye}</div>
        <div class="set-mid"><b>Show Balances</b><small>Hide amounts on screen</small></div>
        <div class="switch ${balanceVisible ? 'on' : ''}" id="sw-bal" role="switch"></div></div>
    </div>

    <div class="set-group"><h4>Support & Legal</h4>
      <button class="set-item" data-s="faq" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#2563EB,#60A5FA)">${IC.chat}</div>
        <div class="set-mid"><b>Help & FAQ</b><small>Answers in one tap</small></div>${IC.arrowR}</button>
      <button class="set-item" data-s="terms" type="button"><div class="set-ic" style="background:linear-gradient(135deg,#64748B,#94A3B8)">${IC.doc}</div>
        <div class="set-mid"><b>Terms &amp; Privacy</b><small>Plain-language, no fine print tricks</small></div>${IC.arrowR}</button>
      <button class="set-item" data-s="about" type="button"><div class="set-ic" style="background:var(--grad-btn)">${IC.info}</div>
        <div class="set-mid"><b>About GodX</b><small>v8.0 · Made in India 🇮🇳</small></div>${IC.arrowR}</button>
    </div>

    <button class="set-logout" id="btn-logout" type="button">${IC.logout} <span>Log Out</span></button>
    <p class="set-ver">GodX v8.0 · daily-interest micro-savings</p>`;

  $('#cp-ref').onclick = () => { navigator.clipboard?.writeText(u.referralCode); toast('Referral code copied', 'ok'); };
  $('#sh-ref').onclick = () => openSharePicker();
  $('#sw-notif').onclick = e => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); store.set('bgNotif', on ? 'on' : 'off'); toast(on ? 'Notifications on' : 'Notifications off'); };
  $('#sw-bal').onclick = e => { balanceVisible = !balanceVisible; store.set('bgBal', balanceVisible ? 'on' : 'off'); e.currentTarget.classList.toggle('on', balanceVisible); };
  $('#pf-edit').onclick = () => settingsSheet('edit');
  $('#btn-logout').onclick = () => auth.signOut();
  $$('#view-settings .set-item[data-s]').forEach(b => b.onclick = () => settingsSheet(b.dataset.s));
}

function settingsSheet(key) {
  const u = userDoc.data();
  if (key === 'edit') {
    const s = openSheet(`
      <div class="sheet-title">Edit Profile</div><div class="sheet-sub">Keep your details up to date</div>
      <label class="field"><span>Full Name</span><input id="ep-name" value="${esc(u.name)}"></label>
      <div style="height:12px"></div>
      <label class="field"><span>Phone</span><input id="ep-phone" value="${esc(u.phone || '')}"></label>
      <div style="height:18px"></div>
      <button class="btn btn-primary btn-block" id="ep-save" type="button">Save Changes</button>`);
    s.querySelector('#ep-save').onclick = async () => {
      const btn = s.querySelector('#ep-save');
      const nm = s.querySelector('#ep-name').value.trim();
      if (!nm) return toast('Name cannot be empty', 'err');
      btn.classList.add('loading'); btn.disabled = true;
      try {
        await db.collection('users').doc(currentUser.uid).update({
          name: nm, phone: s.querySelector('#ep-phone').value.trim() });
        closeSheet(); toast('Profile updated ✨', 'ok');
      } catch (e) {
        btn.classList.remove('loading'); btn.disabled = false;
        toast('Update failed — try again', 'err');
      }
    };
  }
  if (key === 'bank') bankEditor(u.bankDetails || null);
  if (key === 'kyc') {
    const s = openSheet(`
      <div class="sheet-title">Security</div><div class="sheet-sub">Signed in as ${esc(u.email)}</div>
      <div class="about-list">
        <div class="about-row"><div class="about-ic">${IC.lock}</div><div><b>Change password</b><p>We'll email you a secure reset link.</p></div></div>
      </div>
      <div style="height:16px"></div>
      <button class="btn btn-primary btn-block" id="pw-reset" type="button">Email Me a Reset Link</button>`);
    s.querySelector('#pw-reset').onclick = async () => {
      const btn = s.querySelector('#pw-reset');
      btn.classList.add('loading'); btn.disabled = true;
      try { await auth.sendPasswordResetEmail(u.email); closeSheet(); toast('Reset link sent to your email', 'ok'); }
      catch (e) { btn.classList.remove('loading'); btn.disabled = false; toast(e.message, 'err'); }
    };
  }
  if (key === 'tx') { switchView('wallet'); }
  if (key === 'faq') {
    const faqs = [
      ['Is GodX an investment app?', 'No. GodX is a micro-savings and interest rewards app. Your savings stay yours — interest comes from merchant partnerships, clearly shown on every plan. We never promise guaranteed high returns.'],
      ['How do deposits work?', 'Add money from the Wallet, pay to the official UPI/bank account shown in the app, then submit your UTR number and payment screenshot. Our team verifies and credits your wallet, usually within 30 minutes.'],
      ['How does daily interest work?', 'Each plan shows a total interest % and duration. The total is split into equal daily slices, and every 24 hours from the exact moment you joined, one slice is credited to your wallet automatically. Missed a day offline? It catches up the moment you open the app — never paid twice.'],
      ['When can I withdraw?', 'Wallet balance can be withdrawn anytime, to your saved bank account or UPI ID. Requests are paid within 24 hours, with live status tracking.'],
      ['Is my money safe?', 'Deposits are processed by RBI-regulated payment partners, and all data is encrypted. Full receipts for every rupee.'],
      ['Are there any fees?', 'No joining fees, no withdrawal fees, no hidden charges. What you see is exactly what you get.']
    ];
    const s = openSheet(`<div class="sheet-title">Help & FAQ</div><div class="sheet-sub">Straight answers, no jargon</div>
      ${faqs.map((f, i) => `<div class="faq-item" data-i="${i}"><button class="faq-q" type="button">${esc(f[0])} ${IC.chevD}</button>
      <div class="faq-a">${esc(f[1])}</div></div>`).join('')}`);
    s.querySelectorAll('.faq-q').forEach(q => q.onclick = () => q.parentElement.classList.toggle('open'));
  }
  if (key === 'terms') openSheet(`
    <div class="sheet-title">Terms & Privacy</div><div class="sheet-sub">The short, honest version</div>
    <div class="about-list">
      <div class="about-row"><div class="about-ic">${IC.checkCircle}</div><div><b>Your money is yours</b><p>Savings can be withdrawn per each plan's terms. We never lock funds beyond the stated duration.</p></div></div>
      <div class="about-row"><div class="about-ic">${IC.checkCircle}</div><div><b>Interest, not "returns"</b><p>Rewards are interest credited daily on active plans, funded by our partners — never promised investment yields.</p></div></div>
      <div class="about-row"><div class="about-ic">${IC.checkCircle}</div><div><b>Your data stays private</b><p>We never sell personal data. Payments run over encrypted, regulated rails.</p></div></div>
    </div>`);
  if (key === 'about') openSheet(`
    <div class="sheet-title">About GodX</div><div class="sheet-sub">Save smart. Earn interest daily.</div>
    <div class="success-pop" style="background:var(--grad-soft)"><svg viewBox="0 0 48 48" style="width:42px;height:42px"><rect x="4" y="4" width="40" height="40" rx="12" fill="rgba(37,99,235,.12)"/><path d="M24 9l11 10-11 20L13 19z" fill="#2563EB"/><path d="M13 19h22M24 9l-5 10 5 20M24 9l5 10-5 20" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" opacity=".9"/></svg></div>
    <p class="muted" style="line-height:1.7;text-align:center">GodX helps you build a savings habit with small, flexible plans
    and real daily interest rewards. Built with transparency at its core — every fee, reward and transaction is visible
    in the app.<br><br><b style="color:var(--ink)">Made with 💜 in India · v8.0</b></p>`);
}

/* ══════════ NOTIFICATIONS ══════════ */
async function showNotifications() {
  const s = openSheet(`<div class="sheet-title">Notifications</div><div class="sheet-sub">Latest updates</div><div id="notif-body"><div class="spinner"></div></div>`);
  try {
    const [ann, tx] = await Promise.all([
      db.collection('announcements').orderBy('createdAt', 'desc').limit(3).get(),
      db.collection('transactions').where('uid', '==', currentUser.uid).where('status', '==', 'completed').limit(4).get()
    ]);
    let h = '<div class="about-list">';
    tx.forEach(d => { const t = d.data();
      h += `<div class="about-row"><div class="about-ic">${t.type === 'interest' ? IC.timer : IC.checkCircle}</div><div><b style="text-transform:capitalize">${esc(t.note || t.type)}</b><p>${inr2(t.amount)} · ${fdt(t.createdAt)}</p></div></div>`; });
    ann.forEach(d => { const a = d.data();
      h += `<div class="about-row"><div class="about-ic">${IC.bell}</div><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div></div>`; });
    if (h === '<div class="about-list">') h += `<div class="empty" style="padding:20px 0">${IC.bell}<p>No notifications yet — you're all caught up!</p></div>`;
    s.querySelector('#notif-body').innerHTML = h + '</div>';
  } catch (e) {
    s.querySelector('#notif-body').innerHTML = `<div class="empty" style="padding:20px 0">${IC.info}<p>Couldn't load notifications.</p></div>`;
  }
}

/* ══════════ SUPPORT — FAQ center + live chat with admin ══════════ */
const SUPPORT_FAQS = [
  { c: 'Getting Started', q: 'What is GodX?', a: 'GodX is a micro-savings and interest rewards app. You save small amounts in flexible plans, and interest is credited to your wallet daily. No false promises — full terms on every plan.' },
  { c: 'Getting Started', q: 'How do I create an account?', a: 'Tap Sign Up on the login screen, enter your name, phone, email and a password (min 6 characters). If a friend gave you a referral code, add it — you both earn ₹25 after your first plan completes.' },
  { c: 'Getting Started', q: 'Is there a minimum balance to start?', a: 'No minimum to open an account. Each plan shows its own starting amount (e.g. ₹300) on the plan card — that is all you need in your wallet to join it.' },
  { c: 'Plans & Interest', q: 'How do savings plans work?', a: 'Pick a plan, choose an amount, and it moves from your wallet into the plan for the stated duration. Interest is split into daily slices and credited to your wallet every 24 hours from the exact time you joined. At maturity your principal is released too.' },
  { c: 'Plans & Interest', q: 'When exactly is my daily interest credited?', a: 'Exactly 24 hours after you joined, and every 24 hours after that. Joined at 2:00 PM? Your interest lands at 2:00 PM each day — never at midnight. Every active plan shows a live "Next Interest" countdown.' },
  { c: 'Plans & Interest', q: 'What if I don\'t open the app for a few days?', a: 'Nothing is lost. The moment you open the app (or the admin panel runs its daily pass), every missed daily credit is caught up in one go — safely, and never twice.' },
  { c: 'Plans & Interest', q: 'Can I exit a plan before it completes?', a: 'Plans run for their stated duration. If you have an emergency, start a support chat and we will review an early exit — you always get your principal back; already-paid daily interest is yours to keep.' },
  { c: 'Plans & Interest', q: 'Where do I see my active plans?', a: 'Open the Plans tab and scroll to "My Active Plans" — each card shows the amount saved, daily interest, total credited so far, a live countdown to the next credit, a progress bar, and the maturity date.' },
  { c: 'Deposits', q: 'How do I add money to my wallet?', a: 'Tap Add Money on Home or Wallet → enter an amount (min ₹50) → pay to the official UPI ID or bank account shown → enter your UTR / reference number and upload the payment screenshot. We verify and credit your wallet.' },
  { c: 'Deposits', q: 'How long does a deposit take to reflect?', a: 'Usually under 30 minutes after you submit the UTR and screenshot. Watch the status live in Wallet → Transaction History — it flips from pending to completed the moment it is verified.' },
  { c: 'Deposits', q: 'What is a UTR number and where do I find it?', a: 'UTR is the unique 12-digit reference for your payment. In GPay / PhonePe / Paytm, open the payment details of the transaction you made — the UTR / UPI Ref No is listed there. Copy it exactly into the deposit form.' },
  { c: 'Withdrawals', q: 'How do I withdraw my money?', a: 'First add your bank account or UPI ID in Wallet → My Bank Account. Then tap Withdraw, enter an amount (min ₹100), pick your destination and submit. Requests are reviewed for security and paid within 24 hours.' },
  { c: 'Withdrawals', q: 'Why was my withdrawal rejected?', a: 'Most rejections are due to a bank detail mismatch (wrong IFSC or account number). The full amount is instantly refunded to your wallet — fix your bank details in Wallet and request again, or chat with us below.' },
  { c: 'Account & Security', q: 'Is my money and data safe?', a: 'Yes. All data is encrypted, deposits are processed via regulated payment partners, and every rupee has a visible receipt in your transaction history. We never sell personal data.' },
  { c: 'Account & Security', q: 'How do I change my password?', a: 'Go to Settings → Security → "Email Me a Reset Link". We send a secure password-reset link to your registered email. You can also use "Forgot password?" on the login screen.' },
  { c: 'Referrals', q: 'How does the referral reward work?', a: 'Share your code from Settings or the Refer button on Home. When a friend signs up with your code and completes their first plan, you BOTH receive a ₹25 reward in your wallets automatically.' }
];

/* ══════════ QUICK ANSWERS — tap-to-reply buttons in live chat ══════════
   Tapping a chip sends the question as the user's message; a typing
   indicator plays and the pre-written solution arrives as a Support
   bubble (autoReply path — same rule-compatible trick as the welcome
   bot messages). The admin sees the question and knows it was answered. */
const CHAT_QUICK_REPLIES = [
  { icon: 'zap', label: 'Add Money', q: 'How do I add money to my wallet?',
    a: '💳 Adding money is easy:\n1. Tap Add Money on Home or Wallet (min ₹50)\n2. Pay to the official UPI ID / bank account shown\n3. Submit your UTR / reference number + payment screenshot\n\nYour wallet is credited after verification — usually under 30 minutes. Track it live in Wallet → Transaction History.' },
  { icon: 'timer', label: 'Daily Interest', q: 'When is my daily interest credited?',
    a: '⏰ Interest lands every 24 hours from the EXACT time you joined a plan — never at midnight. Joined at 2:00 PM? It credits at 2:00 PM daily, automatically. Every active plan shows a live "Next Interest" countdown. Missed days catch up in one credit when you open the app.' },
  { icon: 'upRight', label: 'Withdraw', q: 'How do I withdraw my money?',
    a: '🏦 Withdrawals:\n1. Add your bank account or UPI ID in Wallet → My Bank Account\n2. Tap Withdraw, enter an amount (min ₹100), pick your destination\n3. Requests are reviewed for security and paid within 24 hours\n\nWallet balance can be withdrawn anytime; money in active plans becomes available when the plan completes.' },
  { icon: 'checkCircle', label: 'Deposit Pending', q: 'Why is my deposit still pending?',
    a: '🔎 Deposits stay pending while our team verifies your UTR and payment screenshot — usually under 30 minutes. If it\'s been longer, check that the UTR you entered exactly matches your UPI app\'s payment details, and that the screenshot clearly shows the amount and reference number. Still stuck? Send us your UTR here and we\'ll check it right away.' },
  { icon: 'alert', label: 'Withdrawal Rejected', q: 'Why was my withdrawal rejected?',
    a: '⚠️ Most rejections are a bank-detail mismatch — a wrong IFSC or account number. The full amount is instantly refunded to your wallet. Fix your details in Wallet → My Bank Account, then request again. If it happens twice, chat with us here and we\'ll sort it out.' },
  { icon: 'target', label: 'How Plans Work', q: 'How do savings plans work?',
    a: '📦 Pick a plan, choose an amount, and it moves from your wallet into the plan for the stated duration. The total interest is split into daily slices credited every 24 hours from the moment you joined. At maturity your principal is released back to your wallet. Full terms are shown on every plan card before you join.' },
  { icon: 'gift', label: 'Referral Reward', q: 'How does the referral reward work?',
    a: '🎁 Share your referral code (Home → Refer or Settings). When a friend signs up with your code and completes their first plan, you BOTH get ₹25 in your wallets — automatically. There\'s no limit: every friend who joins with your code earns you another reward.' },
  { icon: 'clock', label: 'UTR Number', q: 'What is a UTR number and where do I find it?',
    a: '🔢 UTR is the unique 12-digit reference for your payment. In GPay / PhonePe / Paytm, open the transaction you made and tap its details — the UTR / UPI Ref No is listed there. Copy it exactly into the deposit form so we can verify your payment instantly.' }
];

function renderSupport() {
  const el = $('#view-support');
  el.innerHTML = `
    <div class="sup-hero">
      <div class="sup-orb sup-orb-1"></div>
      <div class="sup-orb sup-orb-2"></div>
      <div class="sup-hero-top">
        <div class="sup-hero-ic">${IC.headset}</div>
        <div class="sup-hero-txt">
          <b>Help & Support</b>
          <span>Always available — replies in minutes</span>
        </div>
      </div>
      <p class="sup-hero-sub">Instant answers below — or chat live with us. Send messages, photos &amp; files.</p>
      <button class="sup-start" id="chat-new" type="button">${IC.chat} <span>Start Live Chat</span></button>
    </div>

    <div id="chat-list"></div>

    <div class="sec-head"><h3>Frequently Asked Questions</h3></div>
    <div class="card faq-card">
      <div class="sup-search"><input id="faq-q" placeholder="Search a question… (e.g. withdraw, UTR)"></div>
      <div class="sup-cats" id="faq-cats"></div>
      <div id="faq-list"></div>
    </div>`;

  $('#chat-new').onclick = startSupportChat;
  renderChatList();

  let curCat = 'All', curQ = '';
  const cats = ['All', ...new Set(SUPPORT_FAQS.map(f => f.c))];
  const draw = () => {
    const q = curQ.toLowerCase();
    const list = SUPPORT_FAQS.filter(f =>
      (curCat === 'All' || f.c === curCat) &&
      (!q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)));
    $('#faq-cats').innerHTML = cats.map(c =>
      `<button class="sup-cat ${c === curCat ? 'on' : ''}" data-c="${esc(c)}" type="button">${esc(c)}</button>`).join('');
    $$('#faq-cats .sup-cat').forEach(b => b.onclick = () => { curCat = b.dataset.c; draw(); });
    $('#faq-list').innerHTML = list.length ? list.map(f => `
      <div class="faq-item"><button class="faq-q" type="button">${esc(f.q)} ${IC.chevD}</button>
      <div class="faq-a"><span class="faq-tag">${esc(f.c)}</span><br>${esc(f.a)}</div></div>`).join('')
      : `<div class="empty" style="padding:24px 10px">${IC.info}<p>No answers match — try different words, or start a chat above.</p></div>`;
    $$('#faq-list .faq-q').forEach(x => x.onclick = () => x.parentElement.classList.toggle('open'));
  };
  $('#faq-q').oninput = e => { curQ = e.target.value; draw(); };
  draw();
}

/* live list of the user's own support chats — view-scoped listener (no leaks)
   v15: ONE chat per user. If ANY chat exists (open or closed) the "Start
   Live Chat" button turns into either "Open Active Chat" (open) or a locked
   "Waiting for admin to delete previous chat" (closed). A new chat is only
   possible after admin deletes/wipes the old thread. */
function renderChatList() {
  const q = db.collection('supportChats').where('uid', '==', currentUser.uid);
  viewUnsub.push(q.onSnapshot(snap => {
    const box = $('#chat-list');
    if (!box) return;
    const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const hero = $('#chat-new');
    const open = chats.find(c => c.status === 'open');
    const closed = !open && chats.length ? chats[0] : null;
    if (hero) {
      hero.disabled = !!closed;
      if (open) {
        hero.innerHTML = `${IC.clock} <span>Chat Active — Tap to Open</span>`;
        hero.onclick = () => openChatView(open.id);
      } else if (closed) {
        hero.innerHTML = `${IC.lock} <span>Previous Chat Ended — Waiting for Admin</span>`;
        hero.onclick = () => {
          toast('Your previous chat is closed. It must be deleted by admin before a new chat can be started.', 'err');
          openChatView(closed.id);
        };
      } else {
        hero.innerHTML = `${IC.chat} <span>Start Live Chat</span>`;
        hero.onclick = startSupportChat;
      }
    }
    if (!chats.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sec-head" style="margin-top:18px"><h3>Your Chat</h3></div>` + chats.slice(0, 5).map(c => `
      <button class="card chat-card" data-c="${c.id}" type="button">
        <div class="cc-ic ${c.status}">${IC.chat}${c.status === 'open' ? '<i class="cc-live-dot"></i>' : ''}</div>
        <div class="cc-mid">
          <b>Support Chat ${c.status === 'open' ? '<span class="chip chip-green">Live</span>' : '<span class="chip chip-red">Ended — Waiting for admin to delete</span>'}</b>
          <small>${c.lastKind === 'image' ? '📷 Photo' : c.lastKind === 'file' ? '📎 ' + esc(c.lastText || 'File') : esc(c.lastText || 'Chat started')} · ${fdate(c.lastAt || c.createdAt)}</small>
        </div>
        ${c.userUnread ? `<span class="cc-unread">${c.userUnread > 9 ? '9+' : c.userUnread}</span>` : ''}
        ${IC.arrowR}
      </button>`).join('');
    $$('#chat-list .chat-card').forEach(x => x.onclick = () => openChatView(x.dataset.c));
  }, () => {}));
}

async function startSupportChat() {
  showLoader('Opening chat…');
  /* ── v15 SPAM FIX: a user can hold ONLY ONE support chat at a time. If any
     chat still exists for this user (open OR closed-but-not-deleted), we
     REUSE it instead of creating a new one. A truly fresh chat is only
     possible after the admin deletes the previous thread. ── */
  try {
    const u = userDoc.data();
    let chatId = null;
    /* Reuse ANY existing chat for this user (open or closed).
       Prefer 'open' if multiple exist. */
    try {
      const existing = await db.collection('supportChats')
        .where('uid', '==', currentUser.uid).get();
      if (!existing.empty) {
        const open = existing.docs.find(d => d.data().status === 'open');
        chatId = open ? open.id : existing.docs[0].id;
      }
    } catch (e) { /* listing unavailable — proceed to create a fresh chat */ }
    if (chatId) {
      /* If the chat exists but is closed, tell the user they must wait for
         admin to delete it before a new one can start. Otherwise open it. */
      try {
        const snap = await db.collection('supportChats').doc(chatId).get();
        if (snap.exists && snap.data().status !== 'open') {
          hideLoader();
          toast('Your previous chat is closed. Wait for admin to delete it before starting a new chat.', 'err');
          openChatView(chatId);
          return;
        }
      } catch (e) {}
    }
    if (!chatId) {
      const ref = await db.collection('supportChats').add({
        uid: currentUser.uid, userName: u.name || 'User', userEmail: u.email || '',
        status: 'open', userUnread: 0, adminUnread: 0,
        lastText: '', lastKind: 'text',
        lastAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      chatId = ref.id;
      /* ── Pre-written auto-replies — FIRE-AND-FORGET (never block opening).
         Firestore rules only allow chat owners to create messages with
         sender == 'user'. Asking the ADMIN to write these bot messages costs
         one extra message-read per chat in the admin panel; asking the USER
         to write sender:'admin' messages is blocked by the security rules.
         Compromise: the user client posts them as sender:'user' flagged with
         autoReply:true, and BOTH sides render those flagged bubbles as
         "Support" messages — zero rule changes, zero extra admin reads. ── */
      (async () => {
        try {
          const msgs = db.collection('supportChats').doc(chatId).collection('messages');
          const bot = text => ({
            sender: 'user', kind: 'text', autoReply: true, text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await msgs.add(bot(
            `👋 Hi ${u.name || 'there'}! Welcome to GodX Support.\n\n` +
            `You're chatting with our official support team. Tell us your issue — you can attach screenshots or files too. We typically reply within a few minutes.`));
          await msgs.add(bot(
            `🎁 Refer & Earn: share your referral code ${u.referralCode || ''} with friends — you BOTH get ₹25 in your wallet when they complete their first plan. Find it anytime in Home → Refer or Settings.`));
          await msgs.add(bot(
            `💡 Quick answers:\n` +
            `• Add Money — Home / Wallet → Add Money (min ₹50), pay to the official UPI/bank shown, then submit your UTR + screenshot. Credited after verification, usually under 30 min.\n` +
            `• Daily Interest — credited every 24 hours from the exact time you joined a plan, automatically.\n` +
            `• Withdraw — min ₹100 to your saved bank account / UPI, paid within 24 hours.\n\n` +
            `Type your question below and our team will take it from here 🙌`));
          await db.collection('supportChats').doc(chatId).update({
            lastText: 'Welcome to GodX Support 👋', lastKind: 'text',
            lastAt: firebase.firestore.FieldValue.serverTimestamp(),
            userUnread: 3
          });
        } catch (e) { /* cosmetic only — the room is already open and usable */ }
      })();
    }
    hideLoader();
    openChatView(chatId);
  } catch (e) {
    hideLoader();
    toast('Could not start chat — check connection & try again', 'err');
  }
}

/* ══════════ PREMIUM CHAT ROOM (user side) ══════════
   Controlled logo, Inter/Manrope typography, distinct bubbles,
   support badge, timestamps, entrance animations, loading / error /
   retry states, dedupe-safe sending, unread sync. */
function openChatView(cid) {
  const room = document.createElement('div');
  room.className = 'chat-room';
  room.innerHTML = `
    <div class="chat-head">
      <button class="chat-back" id="ch-back" type="button" aria-label="Back">${IC.chevL}</button>
      <div class="chat-head-logo">
        <svg viewBox="0 0 48 48" width="18" height="18"><rect x="4" y="4" width="40" height="40" rx="12" fill="rgba(255,255,255,.16)"/><path d="M24 9l11 10-11 20L13 19z" fill="#fff"/><path d="M13 19h22M24 9l-5 10 5 20M24 9l5 10-5 20" fill="none" stroke="#5EEAD4" stroke-width="1.7" stroke-linejoin="round" opacity=".9"/></svg>
      </div>
      <div class="chat-head-info"><b>GodX Support <span class="sup-badge">${IC.badge} Official</span></b>
        <small id="ch-status">Typically replies within a few minutes</small></div>
    </div>
    <div class="chat-msgs" id="ch-msgs">
      <div class="chat-loading"><div class="cl-dots"><i></i><i></i><i></i></div><span>Loading conversation…</span></div>
    </div>
    <div class="chat-quick" id="ch-quick"></div>
    <div class="chat-closed-bar hidden" id="ch-closedbar">
      <span>This chat was ended by support. A new chat can only be started after admin deletes this one.</span>
    </div>
    <div class="chat-compose" id="ch-compose">
      <input type="file" id="ch-file" hidden>
      <div class="chat-compose-inner">
        <button class="chat-attach" id="ch-attach" type="button" aria-label="Attach a file">${IC.paperclip}</button>
        <input class="chat-input" id="ch-text" placeholder="Type a message…" autocomplete="off" maxlength="800">
        <button class="chat-send" id="ch-send" type="button" aria-label="Send">${IC.send}</button>
      </div>
    </div>`;
  document.body.appendChild(room);
  let roomDead = false, firstPaint = true, pendingEcho = 0;
  const seenMsgIds = new Set(); // bubbles already on screen — never re-animate them (anti-blink)
  let adminTyping = false;   // live flag from supportChats/{cid}.adminTyping
  const kill = () => {
    if (roomDead) return;
    roomDead = true;
    roomUnsub.forEach(u => { try { u(); } catch (e) {} });
    /* stop broadcasting that the user is typing when the room closes */
    try { db.collection('supportChats').doc(cid).update({ userTyping: false }); } catch (e) {}
    room.classList.add('chat-room-out');
    setTimeout(() => room.remove(), 220);
  };
  const roomUnsub = [];

  /* ── Typing indicator bubble — appended/removed at the tail of the
     messages list so the live messages render never fights it ── */
  const typingHTML = `<div class="chat-msg theirs typing" id="ch-typing" aria-label="Support is typing"><i></i><i></i><i></i></div>`;
  const syncTypingBubble = () => {
    if (roomDead) return;
    const box = room.querySelector('#ch-msgs');
    if (!box || box.querySelector('.chat-loading')) return;
    const existing = box.querySelector('#ch-typing');
    if (adminTyping && !existing) {
      box.insertAdjacentHTML('beforeend', typingHTML);
      box.scrollTop = box.scrollHeight;
    } else if (!adminTyping && existing) existing.remove();
    const st = room.querySelector('#ch-status');
      if (st && st.dataset.open !== '0')
      st.innerHTML = adminTyping
        ? '<span class="online-dot"></span> <span class="typing-txt">Support is typing…</span>'
        : 'Typically replies within a few minutes';
    const ty = box.querySelector('#ch-typing');
    if (ty) box.scrollTop = box.scrollHeight;
  };
  room.querySelector('#ch-back').onclick = kill;

  /* live chat doc — detects admin ending / deleting the chat + admin typing */
  roomUnsub.push(db.collection('supportChats').doc(cid).onSnapshot(s => {
    if (roomDead) return;
    if (!s.exists) { kill(); toast('This chat was deleted by support'); if (currentView === 'support') renderSupport(); return; }
    const c = s.data();
    const closed = c.status !== 'open';
    room.querySelector('#ch-compose').classList.toggle('hidden', closed);
    room.querySelector('#ch-closedbar').classList.toggle('hidden', !closed);
    const quick = room.querySelector('#ch-quick');
    if (quick) quick.classList.toggle('hidden', closed);
    const st = room.querySelector('#ch-status');
    if (st) st.dataset.open = closed ? '0' : '1';
    adminTyping = !closed && !!c.adminTyping;
    syncTypingBubble();
    if (st && closed) st.innerHTML = 'Chat ended';
    if ((c.userUnread || 0) > 0) db.collection('supportChats').doc(cid).update({ userUnread: 0 }).catch(() => {});
  }, () => {}));

  /* messages — live, deduped, with error state + retry */
  roomUnsub.push(db.collection('supportChats').doc(cid).collection('messages').limit(300).onSnapshot(snap => {
    if (roomDead) return;
    const box = room.querySelector('#ch-msgs');
    if (!box) return;
    const seen = new Set();
    const msgs = snap.docs.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
      .map(d => ({ id: d.id, ...d.data() }))
      /* ── v14 BLINK FIX ①: pending messages (serverTimestamp not yet
         resolved) sort as Infinity, i.e. they stay at the BOTTOM in send
         order. Before, they sorted as time 0 — the freshly-sent bubble was
         flung to the TOP of the chat and then jumped back down when the
         server timestamp arrived, which users saw as a "blink/jump". ── */
      .sort((a, b) => {
        const as = (a.createdAt && a.createdAt.seconds != null) ? a.createdAt.seconds : Infinity;
        const bs = (b.createdAt && b.createdAt.seconds != null) ? b.createdAt.seconds : Infinity;
        if (as !== bs) return as - bs;
        return ((a.createdAt && a.createdAt.nanoseconds) || 0) - ((b.createdAt && b.createdAt.nanoseconds) || 0);
      });
    if (!msgs.length) {
      box.innerHTML = `<div class="chat-empty">
        <div class="ce-logo"><svg viewBox="0 0 48 48" width="34" height="34"><rect x="4" y="4" width="40" height="40" rx="12" fill="rgba(37,99,235,.1)"/><path d="M24 9l11 10-11 20L13 19z" fill="#2563EB"/></svg></div>
        <b>Say hello 👋</b><p>Describe your issue — you can attach screenshots or files too. We typically reply within minutes.</p></div>`;
      return;
    }
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.innerHTML = msgs.map((m, ix) => {
      /* autoReply messages are user-written (rules require sender:'user') but
         are pre-written SUPPORT messages — render them on the support side */
      const mine = m.sender === 'user' && !m.autoReply;
      let body = '';
      if (m.kind === 'image' && m.fileData)
        body += `<img class="chat-img" src="${m.fileData}" alt="Shared image">`;
      else if (m.kind === 'file' && m.fileData)
        body += `<a class="chat-file" href="${m.fileData}" download="${esc(m.fileName || 'file')}">${IC.file}<span>${esc(m.fileName || 'Attachment')}</span></a>`;
      if (m.text) body += esc(m.text);
      const pending = !m.createdAt;
      /* ── v14 BLINK FIX ②: every live snapshot re-renders the list; messages
         already on screen (and the just-sent pending one, whose optimistic
         echo already animated) skip the entrance animation — no more
         whole-conversation replay on every send. ── */
      const seenCls = (seenMsgIds.has(m.id) || pending) ? ' seen' : '';
      return `<div class="chat-msg ${mine ? 'mine' : 'theirs'} ${pending ? 'pending' : ''}${seenCls}" style="animation-delay:${firstPaint ? Math.min(ix * 30, 240) : 0}ms">${body}
        <span class="chat-time">${mine ? 'You' : (m.autoReply ? 'Support · Auto' : 'Support')} · ${pending ? 'sending…' : ftime(m.createdAt)}${mine && !pending ? ' ✓' : ''}</span></div>`;
    }).join('');
    msgs.forEach(m => seenMsgIds.add(m.id));
    firstPaint = false;
    syncTypingBubble(); // typing bubble rides the tail of the messages render
    if (atBottom || pendingEcho > 0 || adminTyping) { box.scrollTop = box.scrollHeight; pendingEcho = 0; }
  }, () => {
    if (roomDead) return;
    const box = room.querySelector('#ch-msgs');
    if (box) box.innerHTML = `<div class="chat-empty">${IC.alert}<b>Couldn't load messages</b>
      <p>Check your connection.</p><button class="btn btn-primary btn-sm" id="ch-retry" type="button">${IC.refresh} Retry</button></div>`;
    const r = box && box.querySelector('#ch-retry');
    if (r) r.onclick = () => { kill(); openChatView(cid); };
  }));

  /* ── SEND — hardened against the reported "user messages" bugs:
     ① optimistic bubble shows INSTANTLY (before: nothing appeared until the
        server round-trip, so on slow networks users thought the send failed,
        tapped again, and sent duplicates);
     ② the send button locks for the round-trip (double-tap proof);
     ③ on failure the text is RESTORED to the input (before: it was wiped);
     ④ userTyping is cleared on the same batch write so the admin panel
        never gets stuck showing "typing…". ── */
  let _sendInFlight = false;
  const sendMsg = async payload => {
    if (_sendInFlight) return false;
    _sendInFlight = true;
    pendingEcho++;
    const sendBtn = room.querySelector('#ch-send');
    if (sendBtn) sendBtn.disabled = true;
    /* optimistic echo — visible immediately, replaced by the live snapshot */
    const box = room.querySelector('#ch-msgs');
    if (box && !box.querySelector('.chat-loading')) {
      const echo = document.createElement('div');
      echo.className = 'chat-msg mine pending';
      echo.innerHTML = (payload.kind === 'image' && payload.fileData ? `<img class="chat-img" src="${payload.fileData}" alt="Shared image">` : '')
        + (payload.text ? esc(payload.text) : (payload.fileName ? '📎 ' + esc(payload.fileName) : ''))
        + '<span class="chat-time">You · sending…</span>';
      const ty = box.querySelector('#ch-typing');
      box.insertBefore(echo, ty || null);
      box.scrollTop = box.scrollHeight;
    }
    try {
      const batch = db.batch();
      batch.set(db.collection('supportChats').doc(cid).collection('messages').doc(), {
        sender: 'user', createdAt: firebase.firestore.FieldValue.serverTimestamp(), ...payload });
      batch.update(db.collection('supportChats').doc(cid), {
        lastText: payload.text || payload.fileName || (payload.kind === 'image' ? '📷 Photo' : '📎 File'),
        lastKind: payload.kind || 'text',
        lastAt: firebase.firestore.FieldValue.serverTimestamp(),
        userTyping: false,
        adminUnread: firebase.firestore.FieldValue.increment(1) });
      await batch.commit();
      return true;
    } catch (e) {
      pendingEcho = 0;
      const echoList = box ? box.querySelectorAll('.chat-msg.mine.pending') : [];
      if (echoList.length) echoList[echoList.length - 1].remove();
      toast('Message failed — check connection', 'err');
      return false;
    } finally {
      _sendInFlight = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  };
  const doSend = async () => {
    if (_sendInFlight) return; // double-tap / Enter-spam guard
    const inp = room.querySelector('#ch-text');
    const t = inp.value.trim();
    if (!t) return;
    if (sendBtn()) sendBtn().disabled = true;
    const ok = await sendMsg({ kind: 'text', text: t });
    if (ok) { inp.value = ''; pingTyping(false, true); }
    else { inp.value = t; } // restore the draft on failure — never lose the user's text
    inp.focus();
    function sendBtn() { return room.querySelector('#ch-send'); }
  };
  room.querySelector('#ch-send').onclick = doSend;
  room.querySelector('#ch-text').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });

  /* ── broadcast userTyping to the admin (debounced, auto-clears) ── */
  let _typingState = false, _typingClear = null;
  const pingTyping = (on, force) => {
    if (!force && on === _typingState) return;
    _typingState = on;
    db.collection('supportChats').doc(cid).update({ userTyping: on }).catch(() => {});
    if (_typingClear) { clearTimeout(_typingClear); _typingClear = null; }
    if (on) _typingClear = setTimeout(() => pingTyping(false, true), 3500);
  };
  room.querySelector('#ch-text').addEventListener('input', e => pingTyping(!!e.target.value.trim()));
  room.querySelector('#ch-text').addEventListener('blur', () => pingTyping(false, true));

  /* ── QUICK ANSWERS — tappable buttons; tap = question bubble + typing
     animation + the pre-written solution arrives as a Support bubble ── */
  const quickBox = room.querySelector('#ch-quick');
  const quickBtn = (r, ix) => `<button class="cq-chip" type="button" data-qr="${ix}">${IC[r.icon] || IC.spark}<span>${esc(r.label)}</span></button>`;
  quickBox.innerHTML = '<span class="chat-quick-label">Quick answers</span>'
    + CHAT_QUICK_REPLIES.slice(0, 4).map(quickBtn).join('')
    + `<button class="cq-chip cq-more" type="button" id="cq-more">${IC.chevD}<span>More</span></button>`;
  let _qrBusy = false;
  const fireQuickReply = async r => {
    if (_qrBusy || _sendInFlight) return;
    _qrBusy = true;
    const ok = await sendMsg({ kind: 'text', text: r.q });
    if (ok) {
      /* fake the support-side typing indicator locally, then post the
         pre-written solution through the rule-safe autoReply path */
      adminTyping = true; syncTypingBubble();
      setTimeout(async () => {
        adminTyping = false; syncTypingBubble();
        if (roomDead) return;
        try {
          await db.collection('supportChats').doc(cid).collection('messages').add({
            sender: 'user', kind: 'text', autoReply: true, text: r.a,
            createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          /* note: userUnread is intentionally NOT incremented — this is a
             self-service answer, not a real support message */
          db.collection('supportChats').doc(cid).update({
            lastText: r.a.slice(0, 80), lastKind: 'text',
            lastAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        } catch (e) {}
        _qrBusy = false;
      }, 1500 + Math.random() * 900);
    } else _qrBusy = false;
  };
  quickBox.querySelectorAll('[data-qr]').forEach(b => b.onclick = () => fireQuickReply(CHAT_QUICK_REPLIES[Number(b.dataset.qr)]));
  quickBox.querySelector('#cq-more').onclick = () => {
    const s = openSheet(`<div class="sheet-title">Quick Answers</div>
      <div class="sheet-sub">Tap any question — the solution posts instantly in the chat.</div>
      ${CHAT_QUICK_REPLIES.map((r, i) => `<button class="qr-item" type="button" data-qrs="${i}">
        <span class="qr-ic">${IC[r.icon] || IC.spark}</span>
        <span style="flex:1;min-width:0"><b>${esc(r.label)}</b><small>${esc(r.q)}</small></span>${IC.arrowR}</button>`).join('')}`);
    s.querySelectorAll('[data-qrs]').forEach(b => b.onclick = () => { closeSheet(); fireQuickReply(CHAT_QUICK_REPLIES[Number(b.dataset.qrs)]); });
  };

  room.querySelector('#ch-attach').onclick = () => room.querySelector('#ch-file').click();
  room.querySelector('#ch-file').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    showLoader('Attaching…');
    try {
      if (/^image\//.test(f.type)) {
        const data = await readImageCompressed(f, 800, .7);
        if (data.length > 700000) { hideLoader(); return toast('Image too large — crop it smaller and retry', 'err'); }
        await sendMsg({ kind: 'image', fileData: data, fileName: f.name, fileSize: f.size, mime: 'image/jpeg' });
      } else {
        if (f.size > 700 * 1024) { hideLoader(); return toast('File too large — max ~700 KB', 'err'); }
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        await sendMsg({ kind: 'file', fileData: data, fileName: f.name, fileSize: f.size, mime: f.type || 'file' });
      }
      hideLoader();
    } catch (err) { hideLoader(); toast('Could not attach — try again', 'err'); }
  };
  // auto-focus input on desktop
  setTimeout(() => { try { if (window.innerWidth > 640) room.querySelector('#ch-text').focus(); } catch (e) {} }, 350);
}
