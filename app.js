'use strict';

/* G検定ドリル
 * - 解答の記録はこの端末（localStorage）に保存し、GitHubの秘密Gistに同期する
 * - 記録は「いつ・どの問題を・正解したか」のログとして持ち、端末間ではログを足し合わせる
 */
(() => {
  const APP_VERSION = '1.1.0';
  const KEY = {
    state: 'gk.state.v1',
    dev: 'gk.dev',
    sync: 'gk.sync.v1',
    settings: 'gk.settings.v1',
    session: 'gk.session.v1',
    pack: 'gk.pack.v1',
  };
  const GIST_FILE = 'g-kentei-drill-progress.json';
  // 本などから取り込んだ問題。公開リポジトリには置かず、この端末と秘密Gistだけに保存する
  const PACK_FILE = 'g-kentei-drill-book.json';
  const LETTERS = 'ABCDEF';
  const MASTER_STREAK = 2;
  const WEAK_RATE = 0.7;

  const SHORT = {
    c01: 'AIとは', c02: 'AIの動向', c03: '機械学習', c04: 'DLの概要', c05: '要素技術',
    c06: '応用例', c07: '社会実装', c08: '数理・統計', c09: '法律・契約', c10: 'AI倫理',
  };

  // 2027年の日程（JDLA 2026-09-11 発表）。onsite は会場試験の日程（申込は受験日の3日前まで）
  const EXAMS = [
    { id: '2027-1', name: '2027年 第1回', days: ['2027-01-16'], applyFrom: '2026-11-13', applyTo: '2027-01-08', onsite: '1月15日〜17日', result: '2月上旬' },
    { id: '2027-2', name: '2027年 第2回', days: ['2027-03-05', '2027-03-06'], applyFrom: '2027-01-22', applyTo: '2027-02-25', onsite: null, result: '3月下旬' },
    { id: '2027-3', name: '2027年 第3回', days: ['2027-05-08'], applyFrom: '2027-03-12', applyTo: '2027-04-27', onsite: '5月7日〜9日', result: '5月下旬' },
    { id: '2027-4', name: '2027年 第4回', days: ['2027-07-02', '2027-07-03'], applyFrom: '2027-05-14', applyTo: '2027-06-24', onsite: null, result: '7月下旬' },
    { id: '2027-5', name: '2027年 第5回', days: ['2027-09-04'], applyFrom: '2027-07-09', applyTo: '2027-08-27', onsite: '9月3日〜5日', result: '9月下旬' },
    { id: '2027-6', name: '2027年 第6回', days: ['2027-11-05', '2027-11-06'], applyFrom: '2027-09-10', applyTo: '2027-10-28', onsite: null, result: '11月下旬' },
  ];
  const DEFAULT_EXAM = '2027-2';

  const MODES = {
    m: '卒業モード',
    u: 'まだ解いていない問題',
    w: '苦手な問題',
    f: '要対策フラグ',
    r: '全問からランダム',
    t: '模擬テスト',
    x: '間違えた問題をもう一度',
    k: '印刷用の仕分け',
  };

  /* ---------- 小さな道具 ---------- */

  const app = document.getElementById('app');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const WD = '日月火水木金土';
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  const fmtMD = (d) => `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
  const fmtAgo = (t) => {
    const s = Math.round((now() - t) / 1000);
    if (s < 60) return 'たった今';
    if (s < 3600) return `${Math.floor(s / 60)}分前`;
    if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const FLAG_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13M3 2.5h9l-2 3 2 3H3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  let toastTimer = 0;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* ---------- 端末ID・記録 ---------- */

  let DEV = '';
  try { DEV = localStorage.getItem(KEY.dev) || ''; } catch { /* noop */ }
  if (!DEV) { DEV = Math.random().toString(36).slice(2, 8); try { localStorage.setItem(KEY.dev, DEV); } catch { /* noop */ } }

  const emptyState = () => ({ log: [], flags: {}, kp: {}, notes: {}, masterReset: 0, wipedAt: 0, prefs: {} });

  function normalize(s) {
    const e = emptyState();
    if (!s || typeof s !== 'object') return e;
    if (Array.isArray(s.log)) e.log = s.log.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number');
    if (s.flags && typeof s.flags === 'object') {
      for (const [k, v] of Object.entries(s.flags)) if (Array.isArray(v) && typeof v[1] === 'number') e.flags[k] = [v[0] ? 1 : 0, v[1]];
    }
    // 印刷用カンペ：1＝入れる、0＝入れない、null＝未判断（おすすめに従う）
    if (s.kp && typeof s.kp === 'object') {
      for (const [k, v] of Object.entries(s.kp)) if (Array.isArray(v) && typeof v[1] === 'number') e.kp[k] = [v[0] === 1 ? 1 : v[0] === 0 ? 0 : null, v[1]];
    }
    if (s.notes && typeof s.notes === 'object') {
      for (const [k, v] of Object.entries(s.notes)) if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number') e.notes[k] = [v[0].slice(0, 400), v[1]];
    }
    e.masterReset = Number(s.masterReset) || 0;
    e.wipedAt = Number(s.wipedAt) || 0;
    if (s.prefs && typeof s.prefs === 'object') {
      for (const [k, v] of Object.entries(s.prefs)) if (Array.isArray(v) && typeof v[1] === 'number') e.prefs[k] = v;
    }
    return e;
  }

  const cmpLog = (a, b) => (a[1] - b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (String(a[5]) < String(b[5]) ? -1 : String(a[5]) > String(b[5]) ? 1 : 0);

  function canonical(s) {
    const flags = {}; Object.keys(s.flags).sort().forEach((k) => { flags[k] = s.flags[k]; });
    const prefs = {}; Object.keys(s.prefs).sort().forEach((k) => { prefs[k] = s.prefs[k]; });
    const kp = {}; Object.keys(s.kp).sort().forEach((k) => { kp[k] = s.kp[k]; });
    const notes = {}; Object.keys(s.notes).sort().forEach((k) => { notes[k] = s.notes[k]; });
    return { app: 'g-kentei-drill', v: 1, wipedAt: s.wipedAt, masterReset: s.masterReset, prefs, flags, kp, notes, log: [...s.log].sort(cmpLog) };
  }
  const serialize = (s) => JSON.stringify(canonical(s));

  function mergeStates(a, b) {
    const wipedAt = Math.max(a.wipedAt || 0, b.wipedAt || 0);
    const seen = new Set();
    const log = [];
    for (const e of [...a.log, ...b.log]) {
      if (e[1] < wipedAt) continue;
      const k = `${e[0]}|${e[1]}|${e[5]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      log.push(e);
    }
    log.sort(cmpLog);
    const latest = (x, y) => {
      const out = {};
      for (const src of [x || {}, y || {}]) {
        for (const [k, v] of Object.entries(src)) {
          if (v[1] < wipedAt) continue;
          if (!out[k] || v[1] > out[k][1]) out[k] = v;
        }
      }
      return out;
    };
    const flags = latest(a.flags, b.flags);
    const kp = latest(a.kp, b.kp);
    const notes = latest(a.notes, b.notes);
    const prefs = {};
    for (const src of [a.prefs, b.prefs]) {
      for (const [k, v] of Object.entries(src)) if (!prefs[k] || v[1] > prefs[k][1]) prefs[k] = v;
    }
    return { log, flags, kp, notes, prefs, wipedAt, masterReset: Math.max(a.masterReset || 0, b.masterReset || 0) };
  }

  let state = normalize(lsGet(KEY.state));
  state.log.sort(cmpLog);

  function saveState() {
    if (!lsSet(KEY.state, state)) toast('この端末に保存できませんでした。空き容量を確認してください');
  }

  const settings = Object.assign({ count: 20, cats: [], shuffle: true, src: 'all', kpSuggest: true, kpFilter: 'all' }, lsGet(KEY.settings, {}));
  const saveSettings = () => lsSet(KEY.settings, settings);

  /* ---------- 問題と集計 ---------- */

  let Q = [];
  let QMAP = {};
  let CATS = [];
  let CATNAME = {};
  let idx = {};
  let BASE = null; // data/questions.json の中身
  let pack = normalizePack(lsGet(KEY.pack, null));

  /* 取り込んだ問題（本の問題など）。
     { app, v, updated, q: [{ id, cat, s, q, c, a, e, k, src }] } の形で、id ごとに上書き・追加する */
  function normalizePack(p) {
    const out = { app: 'g-kentei-drill-pack', v: 1, updated: 0, q: [] };
    if (!p || typeof p !== 'object' || !Array.isArray(p.q)) return out;
    out.updated = Number(p.updated) || 0;
    const seen = new Set();
    for (const x of p.q) {
      if (!x || typeof x.id !== 'string' || !x.id || seen.has(x.id)) continue;
      if (typeof x.q !== 'string' || !Array.isArray(x.c) || x.c.length < 2 || x.c.length > LETTERS.length) continue;
      const a = Number(x.a);
      if (!Number.isInteger(a) || a < 0 || a >= x.c.length) continue;
      seen.add(x.id);
      out.q.push({
        id: x.id,
        cat: /^c(0[1-9]|10)$/.test(x.cat) ? x.cat : 'c01',
        s: String(x.s || ''),
        q: x.q,
        c: x.c.map(String),
        a,
        e: String(x.e || ''),
        k: x.k ? 1 : 0,
        src: String(x.src || '本'),
      });
    }
    return out;
  }

  function buildQuestions() {
    if (!BASE) return;
    CATS = BASE.cats;
    CATNAME = Object.fromEntries(CATS.map((c) => [c.id, c.name]));
    const own = new Set(BASE.q.map((q) => q.id));
    Q = [...BASE.q, ...pack.q.filter((q) => !own.has(q.id))];
    QMAP = Object.fromEntries(Q.map((q) => [q.id, q]));
  }

  function computeIndex() {
    idx = {};
    for (const q of Q) idx[q.id] = { n: 0, ok: 0, wrong: 0, last: null, lastT: 0, since: [] };
    for (const e of state.log) {
      const r = idx[e[0]];
      if (!r) continue;
      r.n++;
      if (e[2]) r.ok++; else r.wrong++;
      r.last = !!e[2];
      r.lastT = e[1];
      if (e[1] >= state.masterReset) r.since.push(!!e[2]);
    }
    for (const id in idx) {
      const r = idx[id];
      let k = 0;
      for (let i = r.since.length - 1; i >= 0 && r.since[i]; i--) k++;
      r.streak = k;
      r.mastered = k >= MASTER_STREAK;
    }
  }

  const isFlag = (id) => !!(state.flags[id] && state.flags[id][0] === 1);
  const isWeak = (r) => r.wrong > 0 && (r.last === false || r.ok / r.n < WEAK_RATE);
  const weakScore = (r) => (r.last === false ? 1 : 0) + (1 - r.ok / r.n) + Math.min(r.wrong, 5) * 0.05;
  const cellState = (r) => (r.mastered ? 'g' : r.streak === 1 ? 'a' : r.since.length ? 's' : 'u');
  const countMastered = () => Q.reduce((n, q) => n + (idx[q.id].mastered ? 1 : 0), 0);
  const isBook = (q) => !!q.src;
  const inCats = (q) => (!settings.cats.length || settings.cats.includes(q.cat))
    && (settings.src === 'all' || !pack.q.length || (settings.src === 'book') === isBook(q));

  /* 印刷用カンペ */
  const kpMine = (id) => (state.kp[id] ? state.kp[id][0] : null); // 1 / 0 / null
  const kpIn = (q) => { const m = kpMine(q.id); return m === 1 || (m === null && settings.kpSuggest && q.k === 1); };
  const noteOf = (id) => (state.notes[id] ? state.notes[id][0] : '');

  function pool(mode) {
    const qs = Q.filter(inCats);
    if (mode === 'm') return qs.filter((q) => !idx[q.id].mastered);
    if (mode === 'u') return qs.filter((q) => idx[q.id].n === 0);
    if (mode === 'w') return qs.filter((q) => isWeak(idx[q.id])).sort((a, b) => weakScore(idx[b.id]) - weakScore(idx[a.id]));
    if (mode === 'f') return qs.filter((q) => isFlag(q.id));
    if (mode === 'k') return qs.filter((q) => kpMine(q.id) === null);
    return qs;
  }

  function examPref() {
    const id = (state.prefs.exam && state.prefs.exam[0]) || DEFAULT_EXAM;
    return EXAMS.find((e) => e.id === id) || EXAMS.find((e) => e.id === DEFAULT_EXAM);
  }

  /* ---------- 出題セッション ---------- */

  let session = lsGet(KEY.session, null);
  let lastResult = null;
  let timerId = 0;

  const saveSession = () => { if (session) lsSet(KEY.session, session); };
  const clearSession = () => { session = null; lsDel(KEY.session); };

  function mockPick(n) {
    const byCat = {};
    for (const q of Q) (byCat[q.cat] = byCat[q.cat] || []).push(q.id);
    const quotas = CATS.map((c) => {
      const size = (byCat[c.id] || []).length;
      const exact = (n * size) / Q.length;
      return { id: c.id, k: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    let left = n - quotas.reduce((s, x) => s + x.k, 0);
    quotas.sort((a, b) => b.rem - a.rem).forEach((x) => { if (left > 0) { x.k++; left--; } });
    const ids = [];
    for (const x of quotas) ids.push(...shuffle([...(byCat[x.id] || [])]).slice(0, x.k));
    return shuffle(ids);
  }

  function startSession(mode, opts = {}) {
    let ids;
    if (mode === 't') {
      ids = mockPick(opts.n);
    } else if (mode === 'x') {
      ids = shuffle([...opts.ids]);
    } else {
      const p = pool(mode).map((q) => q.id);
      const n = settings.count === 0 ? p.length : settings.count;
      ids = mode === 'w' ? shuffle(p.slice(0, n)) : shuffle(p).slice(0, n);
    }
    if (!ids.length) { toast('この条件で出せる問題はありません'); return; }
    const orders = {};
    if (settings.shuffle) for (const id of ids) orders[id] = shuffle(QMAP[id].c.map((_, i) => i));
    session = {
      mode, ids, i: 0, res: {}, orders,
      started: now(),
      limit: mode === 't' ? Math.round((ids.length * 100 * 60) / 145) : 0,
      mastered0: countMastered(),
    };
    saveSession();
    go('quiz');
  }

  function answer(k) {
    const s = session;
    const id = s.ids[s.i];
    if (s.res[id]) return;
    const q = QMAP[id];
    const ok = k === q.a;
    const t = Math.max(now(), (state.log.length ? state.log[state.log.length - 1][1] + 1 : 0));
    state.log.push([id, t, ok ? 1 : 0, k, s.mode, DEV]);
    saveState();
    computeIndex();
    s.res[id] = { k, ok };
    saveSession();
    Sync.soon(4000);
    if (s.mode === 't') {
      const btn = app.querySelector(`.choice[data-k="${k}"]`);
      if (btn) btn.classList.add('picked');
      setTimeout(next, 160);
    } else {
      renderQuiz();
      const v = app.querySelector('.verdict');
      if (v && v.getBoundingClientRect().top > window.innerHeight * 0.75) v.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function next() {
    if (!session) return;
    if (session.i >= session.ids.length - 1) { finish(false); return; }
    session.i++;
    saveSession();
    renderQuiz();
    window.scrollTo(0, 0);
  }

  function finish(timeUp) {
    clearInterval(timerId);
    const s = session;
    if (!s) { go(''); return; }
    lastResult = {
      mode: s.mode, ids: s.ids, res: s.res, orders: s.orders, timeUp,
      gain: countMastered() - s.mastered0,
      elapsed: now() - s.started,
    };
    clearSession();
    Sync.soon(300);
    go('result');
  }

  function quit() {
    if (!session) { go(''); return; }
    const answered = Object.keys(session.res).length;
    if (!answered) { clearSession(); go(''); return; }
    if (confirm('ここで終わりにしますか？ 解いた分の記録は残ります。')) finish(false);
  }

  function setFlag(id, on) {
    state.flags[id] = [on ? 1 : 0, now()];
    saveState();
    Sync.soon(3000);
  }

  function setKp(id, v) {
    state.kp[id] = [v, now()];
    saveState();
    Sync.soon(3000);
  }

  function setNote(id, text) {
    const t = text.trim().slice(0, 400);
    if (t === noteOf(id)) return;
    state.notes[id] = [t, now()];
    saveState();
    Sync.soon(3000);
  }

  // 問題画面・結果画面に出す「印刷用カンペ」の欄
  function kpBlock(q) {
    const m = kpMine(q.id);
    const hint = m === null
      ? `未判断（おすすめ：${q.k ? '入れる' : '入れない'}${settings.kpSuggest ? '。このままなら' + (q.k ? '入ります' : '入りません') : ''}）`
      : m === 1 ? '印刷用に入れます' : '印刷用には入れません';
    const note = noteOf(q.id);
    return `<div class="kp" data-id="${esc(q.id)}">
      <div class="kp-row">
        <span class="kp-lab">印刷用カンペ</span>
        <div class="seg kp-seg" role="group" aria-label="印刷用カンペに入れるか">
          <button data-act="kp" data-id="${esc(q.id)}" data-v="1" aria-pressed="${m === 1}">入れる</button>
          <button data-act="kp" data-id="${esc(q.id)}" data-v="0" aria-pressed="${m === 0}">入れない</button>
        </div>
      </div>
      <p class="kp-hint">${hint}</p>
      <label class="kp-note-lab" for="note-${esc(q.id)}">カンペに書いておきたいこと（任意）</label>
      <textarea class="kp-note" id="note-${esc(q.id)}" data-note="${esc(q.id)}" rows="2" maxlength="400" placeholder="例：AlexNet＝2012年・ヒントン／ReLU・ドロップアウト">${esc(note)}</textarea>
    </div>`;
  }

  function paintKp(id) {
    const q = QMAP[id];
    if (!q) return;
    document.querySelectorAll(`.kp[data-id="${CSS.escape(id)}"]`).forEach((el) => {
      const ta = el.querySelector('textarea');
      const text = ta ? ta.value : '';
      const tmp = document.createElement('div');
      tmp.innerHTML = kpBlock(q);
      const fresh = tmp.firstElementChild;
      fresh.querySelector('textarea').value = text;
      el.replaceWith(fresh);
    });
    document.querySelectorAll(`.kitem[data-id="${CSS.escape(id)}"]`).forEach((el) => {
      const m = kpMine(id);
      el.dataset.in = kpIn(q) ? '1' : '0';
      el.querySelectorAll('[data-act="kp"]').forEach((b) => b.setAttribute('aria-pressed', String(String(m) === b.dataset.v)));
      const st = el.querySelector('.kstate');
      if (st) st.textContent = kpStateLabel(q);
    });
    const sum = document.getElementById('kpSummary');
    if (sum) sum.innerHTML = kpSummary();
  }

  const kpStateLabel = (q) => {
    const m = kpMine(q.id);
    if (m === 1) return '入れる';
    if (m === 0) return '入れない';
    return settings.kpSuggest && q.k ? 'おすすめで入る' : '未判断';
  };

  /* ---------- 同期（GitHub Gist） ---------- */

  const Sync = {
    cfg: lsGet(KEY.sync, {}),
    status: 'off',
    message: '',
    running: false,
    again: false,
    timer: 0,

    get connected() { return !!(this.cfg.token && this.cfg.gistId); },
    save() { lsSet(KEY.sync, this.cfg); },

    set(status, message = '') {
      this.status = status;
      this.message = message;
      document.querySelectorAll('.sync-chip').forEach(paintChip);
      const line = document.getElementById('syncStatus');
      if (line) { line.textContent = syncStatusText(); line.className = 'status-line' + (status === 'err' ? ' err' : ''); }
    },

    async api(path, opts = {}) {
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (opts.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(`https://api.github.com${path}`, { ...opts, headers, cache: 'no-store' });
      if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
      return res.status === 204 ? null : res.json();
    },

    async connect(token) {
      this.cfg = { token: token.trim() };
      this.set('busy');
      try {
        const user = await this.api('/user');
        this.cfg.login = user.login;
        let gistId = null;
        for (let page = 1; page <= 10 && !gistId; page++) {
          const list = await this.api(`/gists?per_page=100&page=${page}`);
          const hit = list.find((g) => g.files && g.files[GIST_FILE]);
          if (hit) gistId = hit.id;
          if (list.length < 100) break;
        }
        if (!gistId) {
          const files = { [GIST_FILE]: { content: serialize(state) } };
          if (pack.updated) files[PACK_FILE] = { content: JSON.stringify(pack) };
          const g = await this.api('/gists', {
            method: 'POST',
            body: JSON.stringify({
              description: 'G検定ドリルの学習記録（アプリが自動で更新します）',
              public: false,
              files,
            }),
          });
          gistId = g.id;
        }
        this.cfg.gistId = gistId;
        this.save();
        await this.run();
        return true;
      } catch (e) {
        this.cfg = {};
        this.save();
        this.fail(e);
        return false;
      }
    },

    disconnect() {
      clearTimeout(this.timer);
      this.cfg = {};
      this.save();
      this.set('off');
    },

    async readFile(f) {
      if (!f) return null;
      let content = f.content;
      if (f.truncated) {
        const r = await fetch(f.raw_url, { cache: 'no-store' });
        content = await r.text();
      }
      return JSON.parse(content);
    },

    async pull() {
      const g = await this.api(`/gists/${this.cfg.gistId}`);
      const files = g.files || {};
      const st = await this.readFile(files[GIST_FILE]);
      const pk = await this.readFile(files[PACK_FILE]);
      return { state: st ? normalize(st) : null, pack: pk ? normalizePack(pk) : null };
    },

    soon(delay = 3000) {
      if (!this.connected) return;
      this.cfg.dirty = true;
      this.save();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), delay);
    },

    async run() {
      if (!this.connected) return;
      if (this.running) { this.again = true; return; }
      this.running = true;
      this.set('busy');
      try {
        const pulled = await this.pull();
        const remote = pulled.state;
        // 取り込んだ問題は、更新時刻が新しいほうを採用する
        let packChanged = false;
        let packUpload = false;
        if (pulled.pack && pulled.pack.updated > pack.updated) {
          pack = pulled.pack;
          lsSet(KEY.pack, pack);
          buildQuestions();
          packChanged = true;
        } else if (pack.updated && (!pulled.pack || pack.updated > pulled.pack.updated)) {
          packUpload = true;
        }
        const before = serialize(state);
        const merged = remote ? mergeStates(state, remote) : state;
        const mergedText = serialize(merged);
        const changedHere = mergedText !== before;
        if (changedHere) {
          state = merged;
          saveState();
        }
        if (changedHere || packChanged) computeIndex();
        const files = {};
        if (!remote || mergedText !== serialize(remote)) files[GIST_FILE] = { content: mergedText };
        if (packUpload) files[PACK_FILE] = { content: JSON.stringify(pack) };
        if (Object.keys(files).length) {
          await this.api(`/gists/${this.cfg.gistId}`, {
            method: 'PATCH',
            body: JSON.stringify({ files }),
          });
        }
        this.cfg.last = now();
        this.cfg.dirty = false;
        this.save();
        this.set('ok');
        if ((changedHere || packChanged) && ['', 'stats', 'settings'].includes(route())) render();
      } catch (e) {
        this.fail(e);
      } finally {
        this.running = false;
        if (this.again) { this.again = false; this.run(); }
      }
    },

    fail(e) {
      if (e && (e.status === 401 || e.status === 403)) this.set('err', 'GitHubのトークンが無効か、期限が切れています。設定から接続し直してください');
      else if (e && e.status === 404) this.set('err', '同期先のGistが見つかりません。設定から接続し直してください');
      else if (!navigator.onLine || e instanceof TypeError) this.set('offline', 'オフラインです。つながったら自動で同期します');
      else this.set('err', `同期に失敗しました（${e && e.message ? e.message : '不明なエラー'}）`);
    },
  };

  function paintChip(el) {
    const s = Sync.connected ? Sync.status : 'off';
    const label = { off: '同期オフ', ok: '同期済み', busy: '同期中', err: '同期エラー', offline: 'オフライン' }[s] || '同期オフ';
    el.dataset.s = s;
    el.innerHTML = `<i></i>${label}`;
  }

  function syncStatusText() {
    if (!Sync.connected) return '';
    if (Sync.status === 'busy') return '同期しています…';
    if (Sync.message) return Sync.message;
    return Sync.cfg.last ? `最後に同期した時刻：${fmtAgo(Sync.cfg.last)}` : 'まだ同期していません';
  }

  /* ---------- 画面 ---------- */

  const route = () => location.hash.replace(/^#\/?/, '');
  const go = (r) => { if (route() === r) render(); else location.hash = `#/${r}`; };

  function render() {
    clearInterval(timerId);
    if (!Q.length) return;
    const r = route();
    if (r === 'quiz') { if (session) renderQuiz(); else go(''); return; }
    if (r === 'result') { if (lastResult) renderResult(); else go(''); return; }
    if (r === 'stats') return renderStats();
    if (r === 'settings') return renderSettings();
    if (r === 'help') return renderHelp();
    if (r === 'kanpe') return renderKanpe();
    renderHome();
  }

  function examBlock() {
    const ex = examPref();
    const today = new Date();
    const first = parseDay(ex.days[0]);
    const daysLabel = ex.days.length > 1
      ? `${first.getMonth() + 1}月${first.getDate()}日・${parseDay(ex.days[1]).getDate()}日`
      : `${first.getMonth() + 1}月${first.getDate()}日`;
    const d = diffDays(today, first);
    const lastDay = parseDay(ex.days[ex.days.length - 1]);
    const from = parseDay(ex.applyFrom);
    const to = parseDay(ex.applyTo);
    const dFrom = diffDays(today, from);
    const dTo = diffDays(today, to);
    let line1;
    if (d > 0) line1 = `${esc(ex.name)}（${daysLabel}）まで あと<strong class="num">${d}</strong>日`;
    else if (diffDays(today, lastDay) >= 0) line1 = `${esc(ex.name)}は<strong>今日</strong>です`;
    else line1 = `${esc(ex.name)}は終わりました。設定から次の回を選べます`;
    let line2 = '';
    let urgent = false;
    if (d > 0) {
      if (dFrom > 0) line2 = `申込（オンライン試験）は${fmtMD(from)}〜${fmtMD(to)}。受付開始まであと${dFrom}日`;
      else if (dTo >= 0) { line2 = `申込の締め切りは${fmtMD(to)}。あと${dTo}日です`; urgent = dTo <= 14; }
      else line2 = ex.onsite ? 'オンライン試験の申込は締め切りました。会場試験は受験日の3日前まで申し込めます' : '申込は締め切りました';
    }
    return `<section class="exam">
      <p class="exam-days">${line1}</p>
      ${line2 ? `<p class="exam-apply${urgent ? ' urgent' : ''}">${line2}</p>` : ''}
    </section>`;
  }

  function mapBlock() {
    const total = Q.length;
    const done = countMastered();
    const rows = CATS.map((c) => {
      const qs = Q.filter((q) => q.cat === c.id);
      const order = { g: 0, a: 1, s: 2, u: 3 };
      const cells = qs.map((q) => cellState(idx[q.id])).sort((x, y) => order[x] - order[y]);
      const g = cells.filter((x) => x === 'g').length;
      const off = settings.cats.length && !settings.cats.includes(c.id);
      return `<div class="map-row${off ? ' off' : ''}">
        <button class="lab" data-act="cat" data-cat="${c.id}" aria-pressed="${!off}" title="${esc(c.name)}">${esc(SHORT[c.id] || c.name)}</button>
        <div class="strip" aria-hidden="true">${cells.map((x) => `<span class="${x}"></span>`).join('')}</div>
        <span class="cnt num">${g}/${qs.length}</span>
      </div>`;
    }).join('');
    return `<section class="map" aria-label="卒業マップ">
      <div class="map-head">
        <p class="map-total"><strong class="num">${done}</strong>問 卒業 <span class="muted">／ ${total}問</span></p>
        <span class="map-pct num">${Math.round((done / total) * 100)}%</span>
      </div>
      <div class="map-rows">${rows}</div>
      <div class="legend"><span>未挑戦</span><span class="s">挑戦中</span><span class="a">あと1回で卒業</span><span class="g">卒業</span></div>
    </section>`;
  }

  let mockOpen = false;

  /* 3月の回（2027年第2回）に向けた土日中心の段取り */
  const PLAN = {
    exam: '2027-2',
    steps: [
      { to: '2026-12-31', name: '基礎固め', todo: 'テキスト第2版の4〜6章（DLの概要・要素技術・応用例）を1周。アプリは卒業モード。本の問題の写真を少しずつClaudeへ' },
      { to: '2027-01-31', name: '演習', todo: '本の問題とアプリの「苦手な問題」を回す。解いたら印刷用の「入れる／入れない」を付ける。1月22日から受験申し込み' },
      { to: '2027-02-14', name: '模試', todo: '模擬テスト145問（100分）で8割を目指す。終わったら「印刷用カンペ」から書き出してClaudeへ' },
      { to: '2027-03-04', name: '仕上げ', todo: 'Claudeが作った印刷用を印刷し、横に置いて模擬テストを1回。引きやすさを確かめて直す' },
      { to: '2027-03-06', name: '本番', todo: '3月5日・6日。8割に届かなければ、2日前までに5月の回へ移せる' },
    ],
  };

  function planBlock() {
    if (examPref().id !== PLAN.exam) return '';
    const today = dayKey(now());
    let cur = PLAN.steps.findIndex((st) => today <= st.to);
    if (cur < 0) return '';
    const fmt = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    let from = null;
    const rows = PLAN.steps.map((st, i) => {
      const range = `${from ? fmt(from) + '〜' : '〜'}${fmt(st.to)}`;
      const d = new Date(st.to + 'T00:00:00'); d.setDate(d.getDate() + 1);
      from = dayKey(d.getTime());
      return `<li class="${i === cur ? 'now' : i < cur ? 'done' : ''}"><b>${st.name}</b><span class="muted num">${range}</span><p>${st.todo}</p></li>`;
    }).join('');
    return `<details class="plan">
        <summary><span>いまは「${PLAN.steps[cur].name}」</span><span class="muted">${PLAN.steps[cur].todo.split('。')[0]}</span></summary>
        <ol>${rows}</ol>
      </details>`;
  }

  function renderHome() {
    const cnt = { m: pool('m').length, u: pool('u').length, w: pool('w').length, f: pool('f').length, r: pool('r').length, k: pool('k').length };
    const take = (n) => (settings.count === 0 ? n : Math.min(settings.count, n));
    const filtered = settings.cats.length > 0;
    const resume = session ? `<div class="resume">
        <p>解きかけの問題があります（${esc(MODES[session.mode])}・${session.i + (session.res[session.ids[session.i]] ? 1 : 0)}／${session.ids.length}問）</p>
        <button class="btn primary" data-act="resume">続きから</button>
        <button class="btn ghost" data-act="discard">やめる</button>
      </div>` : '';
    const modeRow = (m, name, desc) => `<li><button class="mode" data-act="start" data-mode="${m}" ${cnt[m] ? '' : 'disabled'}>
        <span class="name">${name}</span>
        <span class="desc">${desc}</span>
        <span class="count num">${cnt[m]}<small>問</small></span>
      </button></li>`;
    const counts = [10, 20, 30, 0];
    app.innerHTML = `
      <header class="topbar">
        <h1 class="brand"><b>G</b>検定ドリル</h1>
        <button class="sync-chip" data-act="nav" data-to="settings" aria-label="同期の設定"></button>
      </header>
      ${examBlock()}
      ${planBlock()}
      ${resume}
      ${mapBlock()}
      <button class="btn primary block start-main" data-act="start" data-mode="m" ${cnt.m ? '' : 'disabled'}>
        ${cnt.m ? `卒業モードで${take(cnt.m)}問解く` : (filtered ? '選んだ分野はすべて卒業しました' : 'すべての問題を卒業しました')}
        <span class="sub">${cnt.m ? `未卒業${cnt.m}問から出題。2回続けて正解すると出なくなります` : '設定から卒業の記録をリセットすると、2周目を始められます'}</span>
      </button>
      <h2 class="section-title">ほかの解き方</h2>
      <ul class="modes">
        ${modeRow('u', 'まだ解いていない問題', '一度も解いたことがない問題だけ')}
        ${modeRow('w', '苦手な問題', `間違えたことがあり、直近で間違えたか正答率${Math.round(WEAK_RATE * 100)}%未満のもの。苦手な順に出題`)}
        ${modeRow('f', '要対策フラグを付けた問題', '問題画面の「要対策」で自分で印を付けたもの')}
        ${modeRow('r', '全問からランダム', '卒業済みも含めてまんべんなく')}
        ${modeRow('k', '印刷用カンペの仕分け', '印刷用に入れるかをまだ決めていない問題。解いた後に「入れる／入れない」を選ぶ')}
        <li>
          <button class="mode" data-act="mock" aria-expanded="${mockOpen}">
            <span class="name">模擬テスト</span>
            <span class="desc">本番と同じ1問あたり約41秒の制限時間。答え合わせは最後にまとめて。分野の絞り込みは使いません</span>
            <span class="count num">${mockOpen ? '−' : '＋'}</span>
          </button>
          ${mockOpen ? `<div class="mock-pick">
            <button class="btn" data-act="mockstart" data-n="30">30問<span class="sub">21分</span></button>
            <button class="btn" data-act="mockstart" data-n="60">60問<span class="sub">41分</span></button>
            <button class="btn" data-act="mockstart" data-n="145">145問<span class="sub">100分（本番と同じ）</span></button>
          </div>` : ''}
        </li>
      </ul>
      <h2 class="section-title">出題の設定</h2>
      <div class="setgroup">
        <p class="small muted">1回に解く問題数</p>
        <div class="seg" role="group" aria-label="1回に解く問題数">
          ${counts.map((n) => `<button data-act="count" data-n="${n}" aria-pressed="${settings.count === n}">${n === 0 ? '全部' : `${n}問`}</button>`).join('')}
        </div>
      </div>
      ${pack.q.length ? `<div class="setgroup">
        <p class="small muted">問題の出どころ（アプリ ${Q.length - pack.q.length}問・取り込んだ問題 ${pack.q.length}問）</p>
        <div class="seg" role="group" aria-label="問題の出どころ">
          ${[['all', 'すべて'], ['app', 'アプリの問題'], ['book', '取り込んだ問題']].map(([v, l]) => `<button data-act="src" data-v="${v}" aria-pressed="${settings.src === v}">${l}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="setgroup">
        <p class="small muted">分野で絞る（卒業マップの分野名を押しても切り替わります）</p>
        <div class="chips">
          <button class="chip" data-act="allcats" aria-pressed="${!filtered}">すべて</button>
          ${CATS.map((c) => `<button class="chip" data-act="cat" data-cat="${c.id}" aria-pressed="${settings.cats.includes(c.id)}">${esc(SHORT[c.id] || c.name)}</button>`).join('')}
        </div>
      </div>
      <nav class="footer-nav" aria-label="そのほか">
        <a class="btn ghost" href="#/kanpe">印刷用カンペ</a>
        <a class="btn ghost" href="#/stats">成績</a>
        <a class="btn ghost" href="#/settings">設定と同期</a>
        <a class="btn ghost" href="#/help">使い方</a>
      </nav>`;
    document.querySelectorAll('.sync-chip').forEach(paintChip);
  }

  function qHistory(id) {
    const r = idx[id];
    if (!r.n) return '';
    const base = `この問題は通算${r.n}回中${r.ok}回正解。`;
    if (r.mastered) return `${base}2回続けて正解したので卒業です。`;
    if (r.streak === 1) return `${base}次も正解すれば卒業です。`;
    return `${base}卒業まであと2回続けて正解が必要です。`;
  }

  function renderQuiz() {
    clearInterval(timerId);
    const s = session;
    const id = s.ids[s.i];
    const q = QMAP[id];
    if (!q) { // 問題が削除された場合は飛ばす
      if (s.i < s.ids.length - 1) { s.i++; saveSession(); renderQuiz(); } else finish(false);
      return;
    }
    const r = s.res[id];
    const order = s.orders[id] || q.c.map((_, i) => i);
    const isMock = s.mode === 't';
    const reveal = r && !isMock;
    const letters = LETTERS;
    const correctPos = order.indexOf(q.a);
    const choices = order.map((k, pos) => {
      let cls = 'choice';
      if (reveal) {
        if (k === q.a) cls += ' correct';
        else if (k === r.k) cls += ' wrong';
        else cls += ' dim';
      }
      return `<li><button class="${cls}" data-act="answer" data-k="${k}" ${r ? 'disabled' : ''}>
        <span class="key">${letters[pos]}</span><span>${esc(q.c[k])}</span></button></li>`;
    }).join('');
    const flagged = isFlag(id);
    const last = s.i === s.ids.length - 1;
    const pct = Math.round(((s.i + (r ? 1 : 0)) / s.ids.length) * 100);
    app.innerHTML = `
      <div class="qbar">
        <div class="qbar-row">
          <button class="icon-btn" data-act="quit" aria-label="終わりにする">×</button>
          <p class="title">${esc(MODES[s.mode])}<span class="muted num">${s.i + 1} / ${s.ids.length}問</span></p>
          ${isMock ? '<span class="timer num" id="timer"></span>' : ''}
          <button class="flag-btn" data-act="flag" data-id="${id}" aria-pressed="${flagged}">${FLAG_SVG}要対策</button>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>
      <p class="qmeta">${q.src ? `<span class="srctag">${esc(q.src)}</span>` : ''}${esc(CATNAME[q.cat])}　${esc(q.s)}</p>
      <p class="qtext">${esc(q.q)}</p>
      <ol class="choices">${choices}</ol>
      ${reveal ? `<section class="verdict ${r.ok ? 'ok' : 'ng'}">
        <h3>${r.ok ? '正解' : `不正解。正解は ${letters[correctPos]}`}</h3>
        <p>${esc(q.e)}</p>
        <p class="hist">${qHistory(id)}</p>
      </section>
      ${kpBlock(q)}` : ''}
      ${r ? `<div class="dock"><div class="dock-inner">
        <button class="btn primary" data-act="next">${last ? '結果を見る' : '次の問題へ'}</button>
      </div></div>
      <p class="kbd-hint">キーボード：Enterで次へ、Fで要対策、Kで印刷用に入れる</p>` : `<p class="kbd-hint">キーボード：1〜${q.c.length}（またはA〜${LETTERS[q.c.length - 1]}）で解答、Fで要対策</p>`}`;
    if (isMock) startTimer();
  }

  function startTimer() {
    const el = document.getElementById('timer');
    const tick = () => {
      if (!session) return;
      const left = Math.round((session.started + session.limit * 1000 - now()) / 1000);
      if (left <= 0) { clearInterval(timerId); toast('時間切れです'); finish(true); return; }
      if (el) { el.textContent = fmtClock(left); el.classList.toggle('low', left <= 60); }
    };
    tick();
    timerId = setInterval(tick, 1000);
  }

  function renderResult() {
    const R = lastResult;
    const letters = LETTERS;
    const answered = R.ids.filter((id) => R.res[id]);
    const right = answered.filter((id) => R.res[id].ok).length;
    const wrongIds = R.ids.filter((id) => R.res[id] && !R.res[id].ok);
    const pct = answered.length ? Math.round((right / R.ids.length) * 100) : 0;
    const mins = Math.max(1, Math.round(R.elapsed / 60000));
    const items = R.ids.map((id, i) => {
      const q = QMAP[id];
      if (!q) return '';
      const r = R.res[id];
      const mark = !r ? '<span class="mark na">－</span>' : r.ok ? '<span class="mark ok">○</span>' : '<span class="mark ng">×</span>';
      const order = R.orders[id] || q.c.map((_, k) => k);
      return `<li data-i="${i}">
        <button class="ritem" data-act="toggle" aria-expanded="false">${mark}<span class="qline">${esc(q.q)}</span></button>
        <div class="rdetail hidden">
          <p class="ans">正解：<b>${letters[order.indexOf(q.a)]}　${esc(q.c[q.a])}</b></p>
          ${r && !r.ok ? `<p class="yours">あなたの答え：${letters[order.indexOf(r.k)]}　${esc(q.c[r.k])}</p>` : ''}
          ${!r ? '<p class="yours">時間切れで未回答</p>' : ''}
          <p>${esc(q.e)}</p>
          <button class="flag-btn" data-act="flag" data-id="${id}" aria-pressed="${isFlag(id)}">${FLAG_SVG}要対策</button>
          ${kpBlock(q)}
        </div>
      </li>`;
    }).join('');
    app.innerHTML = `
      <section class="result-head">
        <h1>${R.ids.length}問中 <span class="num">${right}</span>問正解</h1>
        <p class="pct num">正答率${pct}%、かかった時間は${mins}分${R.timeUp ? '（時間切れ）' : ''}。${R.mode === 't' ? '合格ラインは公表されていませんが、正答率7割前後が目安といわれます。' : ''}</p>
        <p class="gain">${R.gain > 0 ? `今回 <strong>${R.gain}問</strong> 卒業しました。` : ''}いまの卒業は${countMastered()}／${Q.length}問です。</p>
      </section>
      <div class="actions">
        ${wrongIds.length ? `<button class="btn primary block" data-act="retry">間違えた${wrongIds.length}問をもう一度解く</button>` : ''}
        <button class="btn block" data-act="nav" data-to="">ホームに戻る</button>
      </div>
      <h2 class="section-title">解いた問題（押すと解説が開きます）</h2>
      <ul class="rlist">${items}</ul>`;
  }

  function renderStats() {
    const log = state.log.filter((e) => QMAP[e[0]]);
    const ok = log.filter((e) => e[2]).length;
    const days = new Set(log.map((e) => dayKey(e[1])));
    const todayKey = dayKey(now());
    const today = log.filter((e) => dayKey(e[1]) === todayKey).length;
    const rows = CATS.map((c) => {
      const qs = Q.filter((q) => q.cat === c.id);
      let n = 0, okc = 0, touched = 0, m = 0;
      for (const q of qs) { const r = idx[q.id]; n += r.n; okc += r.ok; if (r.n) touched++; if (r.mastered) m++; }
      return `<tr><td>${esc(c.name)}</td><td class="num">${touched}/${qs.length}</td><td class="num">${n ? Math.round((okc / n) * 100) + '%' : '－'}</td><td class="num">${m}</td></tr>`;
    }).join('');
    const bars = [];
    const perDay = {};
    for (const e of log) { const k = dayKey(e[1]); perDay[k] = (perDay[k] || 0) + 1; }
    let max = 1;
    const list = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const v = perDay[dayKey(d.getTime())] || 0;
      max = Math.max(max, v);
      list.push({ d, v });
    }
    for (const x of list) bars.push(`<div class="${x.v ? '' : 'zero'}" style="height:${x.v ? Math.max(6, (x.v / max) * 100) : 3}%" title="${x.d.getMonth() + 1}/${x.d.getDate()}：${x.v}問"></div>`);
    app.innerHTML = `
      <header class="page-head"><a class="icon-btn" href="#/" aria-label="ホームに戻る">←</a><h1>成績</h1></header>
      <section class="panel">
        <div class="kv">
          <div><strong class="num">${log.length}</strong><span>解いた回数</span></div>
          <div><strong class="num">${log.length ? Math.round((ok / log.length) * 100) : 0}%</strong><span>正答率</span></div>
          <div><strong class="num">${days.size}</strong><span>勉強した日数</span></div>
        </div>
      </section>
      <section class="panel">
        <h2>この2週間（今日は${today}問）</h2>
        <div class="days" role="img" aria-label="直近14日の解答数">${bars.join('')}</div>
        <div class="days-axis"><span>${list[0].d.getMonth() + 1}/${list[0].d.getDate()}</span><span>今日</span></div>
      </section>
      <section class="panel">
        <h2>分野別</h2>
        <table class="cat">
          <thead><tr><th>分野</th><th>解いた問題</th><th>正答率</th><th>卒業</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  function renderSettings() {
    const ex = examPref();
    const syncPanel = Sync.connected
      ? `<p>GitHubアカウント <b>${esc(Sync.cfg.login || '')}</b> の秘密Gistに記録を保存しています。ほかの端末でも同じトークンで接続すると、記録がまとまります。</p>
         <p class="status-line${Sync.status === 'err' ? ' err' : ''}" id="syncStatus">${esc(syncStatusText())}</p>
         <button class="btn primary block" data-act="syncnow">今すぐ同期する</button>
         <button class="btn block ghost" data-act="disconnect">この端末の同期を解除する</button>`
      : `<p>GitHubの秘密Gistに記録を保存して、スマホとPCなど端末をまたいで記録を共有できます。最初に1回、端末ごとにトークンを入力してください。</p>
         <ol class="steps">
           <li>PCで <a href="https://github.com/settings/tokens/new?scopes=gist&description=G%E6%A4%9C%E5%AE%9A%E3%83%89%E3%83%AA%E3%83%AB" target="_blank" rel="noopener">GitHubのトークン作成ページ</a> を開く（「gist」にチェックが入った状態で開きます）</li>
           <li>Expiration（有効期限）を受験後の日付にして、ほかのチェックは付けずに「Generate token」を押す</li>
           <li>表示された <code>ghp_</code> で始まる文字列をコピーして、下に貼り付ける</li>
         </ol>
         <div class="field" style="margin-top:12px">
           <label for="tok">トークン</label>
           <input id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_…">
         </div>
         <p class="status-line${Sync.status === 'err' ? ' err' : ''}" id="syncStatus">${esc(Sync.message)}</p>
         <button class="btn primary block" data-act="connect">接続する</button>
         <p class="note" style="margin-top:10px">トークンはこの端末の中だけに保存され、GitHub以外には送られません。gistだけの権限なので、リポジトリなどほかのデータには触れません。</p>`;
    app.innerHTML = `
      <header class="page-head"><a class="icon-btn" href="#/" aria-label="ホームに戻る">←</a><h1>設定と同期</h1></header>
      <section class="panel">
        <h2>受ける回</h2>
        <div class="field">
          <label for="exam">ホームに残り日数と申込期間を表示します</label>
          <select id="exam" data-act="exam">
            ${EXAMS.map((e) => {
              const f = parseDay(e.days[0]);
              const lab = e.days.length > 1 ? `${f.getMonth() + 1}月${f.getDate()}日・${parseDay(e.days[1]).getDate()}日` : `${f.getMonth() + 1}月${f.getDate()}日`;
              return `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${e.name}（${lab}）</option>`;
            }).join('')}
          </select>
        </div>
        <p class="note">オンライン試験の申込期間：${fmtMD(parseDay(ex.applyFrom))}〜${fmtMD(parseDay(ex.applyTo))}。合否発表は${ex.result}。${ex.onsite ? `会場試験は${ex.onsite}（受験日の3日前まで申込可）。` : 'この回は会場試験はありません。'}</p>
      </section>
      <section class="panel">
        <h2>端末をまたいだ同期</h2>
        ${syncPanel}
      </section>
      <section class="panel">
        <h2>取り込んだ問題（本の問題など）</h2>
        <p>Claudeが作った問題ファイル（.json）を読み込むと、アプリの問題と同じように解けます。取り込んだ問題はこの端末と秘密Gistだけに保存され、公開ページには載りません。同期していれば、ほかの端末にも自動で入ります。</p>
        <p class="note">${pack.q.length ? `いま${pack.q.length}問を取り込んでいます。同じ問題IDの問題は、新しいファイルの内容で上書きされます。` : 'まだ取り込んだ問題はありません。'}</p>
        <button class="btn primary block" data-act="packpick" style="margin-top:10px">問題ファイルを読み込む</button>
        <input type="file" id="packFile" accept="application/json,.json" class="hidden">
        ${pack.q.length ? '<button class="btn block danger" data-act="packclear">取り込んだ問題を消す</button>' : ''}
      </section>
      <section class="panel">
        <h2>問題の表示</h2>
        <label class="toggle"><span>選択肢の順番を毎回入れ替える</span><input type="checkbox" data-act="shuffle" ${settings.shuffle ? 'checked' : ''}></label>
        <p class="note">位置で答えを覚えてしまうのを防ぎます。</p>
      </section>
      <section class="panel">
        <h2>記録</h2>
        <p class="note">卒業の記録だけを消して、すべての問題をもう一度卒業モードに出します。正答率や苦手の判定に使う解答の履歴は残ります。</p>
        <button class="btn block" data-act="resetmaster" style="margin-top:10px">卒業モードを最初からやり直す</button>
        <p class="note" style="margin-top:14px">記録をファイルに書き出したり、書き出したファイルを取り込んだりできます。取り込んだ記録は今の記録に足し合わされます。</p>
        <button class="btn block" data-act="export" style="margin-top:10px">記録を書き出す</button>
        <button class="btn block" data-act="importpick">記録を取り込む</button>
        <input type="file" id="importFile" accept="application/json,.json" class="hidden">
        <button class="btn block danger" data-act="wipe" style="margin-top:18px">すべての記録を消す</button>
      </section>
      <p class="note" style="text-align:center">G検定ドリル ${APP_VERSION}・問題 ${Q.length}問（アプリ ${Q.length - pack.q.length}問＋取り込み ${pack.q.length}問、データ版 ${esc(DATA_VERSION)}）</p>`;
  }

  /* ---------- 印刷用カンペ ---------- */

  function kpCounts() {
    let mine = 0, sug = 0, no = 0, und = 0, notes = 0;
    for (const q of Q) {
      const m = kpMine(q.id);
      if (m === 1) mine++;
      else if (m === 0) no++;
      else { und++; if (settings.kpSuggest && q.k) sug++; }
      if (noteOf(q.id)) notes++;
    }
    return { mine, sug, no, und, notes, total: mine + sug };
  }

  function kpSummary() {
    const c = kpCounts();
    return `<div class="kv">
        <div><strong class="num">${c.total}</strong><span>印刷に入る問題</span></div>
        <div><strong class="num">${c.mine}</strong><span>自分で「入れる」</span></div>
        <div><strong class="num">${c.und}</strong><span>未判断${settings.kpSuggest ? `（うち${c.sug}問はおすすめで入る）` : ''}</span></div>
      </div>
      <p class="note" style="margin-top:10px">「入れない」${c.no}問・メモ付き${c.notes}問</p>`;
  }

  const openCats = new Set();
  const KP_FILTERS = [['all', 'すべて'], ['in', '入る'], ['und', '未判断'], ['no', '入れない'], ['memo', 'メモ付き']];

  function kpMatch(q) {
    const f = settings.kpFilter;
    const m = kpMine(q.id);
    if (f === 'in') return kpIn(q);
    if (f === 'und') return m === null;
    if (f === 'no') return m === 0;
    if (f === 'memo') return !!noteOf(q.id);
    return true;
  }

  function renderKanpe() {
    const sections = CATS.map((c) => {
      const qs = Q.filter((q) => q.cat === c.id);
      const shown = qs.filter(kpMatch);
      const inN = qs.filter(kpIn).length;
      if (!shown.length) return '';
      const items = shown.map((q) => {
        const m = kpMine(q.id);
        const r = idx[q.id];
        return `<li class="kitem" data-id="${esc(q.id)}" data-in="${kpIn(q) ? 1 : 0}">
          <p class="kq">${q.src ? `<span class="srctag">${esc(q.src)}</span>` : ''}<span class="muted">${esc(q.s)}</span>　${esc(q.q)}</p>
          <p class="ka">正解：<b>${esc(q.c[q.a])}</b>${r.n ? `<span class="muted">（${r.n}回中${r.ok}回正解）</span>` : ''}</p>
          ${noteOf(q.id) ? `<p class="kmemo">メモ：${esc(noteOf(q.id))}</p>` : ''}
          <div class="krow">
            <span class="kstate">${kpStateLabel(q)}</span>
            <div class="seg kp-seg" role="group" aria-label="印刷用に入れるか">
              <button data-act="kp" data-id="${esc(q.id)}" data-v="1" aria-pressed="${m === 1}">入れる</button>
              <button data-act="kp" data-id="${esc(q.id)}" data-v="0" aria-pressed="${m === 0}">入れない</button>
            </div>
          </div>
        </li>`;
      }).join('');
      return `<details class="kcat" data-cat="${c.id}" ${openCats.has(c.id) ? 'open' : ''}>
        <summary><span>${esc(c.name)}</span><span class="muted num">${inN}／${qs.length}問が入る</span></summary>
        <ul class="klist">${items}</ul>
      </details>`;
    }).join('');
    app.innerHTML = `
      <header class="page-head"><a class="icon-btn" href="#/" aria-label="ホームに戻る">←</a><h1>印刷用カンペ</h1></header>
      <section class="panel">
        <p>本番の横に置く印刷物に、どの問題の内容を入れるかを決めます。問題を解いた後の「印刷用カンペ」欄か、この画面で「入れる／入れない」を選んでください。もう一度押すと未判断に戻ります。</p>
        <p class="note">未判断の問題は、Claudeのおすすめ（人名・年・法律やガイドラインの名前・用語・計算式など、知っていれば答えられるもの）に従います。理解を問う問題は、本番でカンペを引くより考えて解くほうが速いので、おすすめから外しています。</p>
        <div id="kpSummary" style="margin-top:14px">${kpSummary()}</div>
        <label class="toggle" style="margin-top:6px"><span>未判断の問題はおすすめに従う</span><input type="checkbox" data-act="kpsuggest" ${settings.kpSuggest ? 'checked' : ''}></label>
      </section>
      <section class="panel">
        <h2>Claudeに渡す</h2>
        <p class="note">印刷に入る問題の「問題・正解・解説・メモ・正答回数」をまとめます。Claudeとのチャットに貼り付けるかファイルで渡すと、それをもとに、本番中にすぐ引ける印刷用の資料を作ります。</p>
        <div class="kp-actions">
          <button class="btn primary block" data-act="kpcopy">まとめてコピー</button>
          ${navigator.share ? '<button class="btn block" data-act="kpshare">共有（ファイルで送る）</button>' : ''}
          <button class="btn block" data-act="kpsave">ファイルに保存</button>
        </div>
      </section>
      <h2 class="section-title">問題ごとに決める</h2>
      <div class="chips" style="margin-bottom:12px">
        ${KP_FILTERS.map(([v, l]) => `<button class="chip" data-act="kpfilter" data-v="${v}" aria-pressed="${settings.kpFilter === v}">${l}</button>`).join('')}
      </div>
      ${sections || '<p class="muted">この条件の問題はありません。</p>'}`;
  }

  function kanpeText() {
    const c = kpCounts();
    const out = [];
    const d = new Date();
    out.push(`# G検定 印刷用カンペの材料（G検定ドリル ${APP_VERSION}から書き出し ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}）`);
    out.push(`印刷に入れる：${c.total}問（自分で「入れる」${c.mine}問、未判断でおすすめ${c.sug}問）／メモ付き${c.notes}問`);
    out.push('記号：[自分]＝自分で入れると決めた　[おすすめ]＝未判断でClaudeのおすすめ　[本]など＝取り込んだ問題　正答＝通算の正解数/解いた回数');
    out.push(`Claudeへ：アプリの問題の本文と解説は github.com/gasen-m-k/g-kentei-drill の data/questions.json（データ版 ${DATA_VERSION}）にあります。これをもとに、本番（100分・約145問）の横で素早く引ける印刷用の資料を作ってください。メモは必ず反映し、苦手な問題は目立たせてください。`);
    for (const cat of CATS) {
      const qs = Q.filter((q) => q.cat === cat.id && kpIn(q));
      if (!qs.length) continue;
      out.push('', `## ${cat.name}（${qs.length}問）`);
      for (const q of qs) {
        const r = idx[q.id];
        const tags = [kpMine(q.id) === 1 ? '[自分]' : '[おすすめ]'];
        if (q.src) tags.push(`[${q.src}]`);
        const parts = [`- ${tags.join('')} ${q.id}`, q.s, `正解：${q.c[q.a]}`];
        if (r.n) parts.push(`正答${r.ok}/${r.n}${isWeak(r) ? '（苦手）' : ''}`);
        if (noteOf(q.id)) parts.push(`メモ：${noteOf(q.id)}`);
        out.push(parts.join('｜'));
        // アプリの問題の本文は公開リポジトリにあるので、取り込んだ問題だけ本文と解説を付ける
        if (q.src) {
          out.push(`  問：${q.q}`);
          if (q.e) out.push(`  解説：${q.e}`);
        }
      }
    }
    const no = Q.filter((q) => kpMine(q.id) === 0).map((q) => q.id);
    if (no.length) out.push('', `## 入れないと決めた問題（${no.length}問）`, no.join(' '));
    const memoOnly = Q.filter((q) => !kpIn(q) && noteOf(q.id));
    if (memoOnly.length) {
      out.push('', '## 入れない問題に付いているメモ');
      for (const q of memoOnly) out.push(`- ${q.id}｜${q.s}｜メモ：${noteOf(q.id)}`);
    }
    return out.join('\n');
  }

  function kanpeFile() {
    const name = `g-kentei-kanpe-${dayKey(now())}.md`;
    return new File([kanpeText()], name, { type: 'text/markdown' });
  }

  function downloadFile(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function renderHelp() {
    app.innerHTML = `
      <header class="page-head"><a class="icon-btn" href="#/" aria-label="ホームに戻る">←</a><h1>使い方</h1></header>
      <section class="panel help">
        <h2>解き方の種類</h2>
        <ul>
          <li><b>卒業モード</b>：2回続けて正解すると「卒業」になり、このモードでは出なくなります。卒業マップと割合で進み具合が分かります。卒業した問題も、ほかのモードで間違えると卒業が取り消されて戻ってきます。</li>
          <li><b>まだ解いていない問題</b>：一度も解いたことがない問題だけを出します。</li>
          <li><b>苦手な問題</b>：間違えたことがあり、直近で間違えたか正答率が7割未満の問題を、苦手な順に出します。</li>
          <li><b>要対策フラグ</b>：問題画面や結果画面の「要対策」で自分で印を付けた問題だけを出します。</li>
          <li><b>模擬テスト</b>：本番（100分・約145問）と同じペースの制限時間で解き、最後にまとめて答え合わせします。</li>
        </ul>
        <p>どのモードで解いても記録は共通です。1回に解く問題数と分野は、ホームの「出題の設定」で変えられます。</p>
      </section>
      <section class="panel help">
        <h2>印刷用カンペ</h2>
        <p>問題を解いた後に出る「印刷用カンペ」欄で、その問題の内容を本番の横に置く印刷物に入れるかを決めます。「入れる」「入れない」を押すと決まり、もう一度押すと未判断に戻ります。書いておきたいことがあれば、下の欄にメモできます。</p>
        <p>ホームの「印刷用カンペ」画面で、分野ごとにまとめて仕分けたり、決めた内容を書き出したりできます。書き出したものをClaudeに渡すと、印刷用の資料にまとめます。未判断の問題は、Claudeのおすすめ（知っていれば答えられる用語・人名・年・法律名・計算式など）に従います。</p>
      </section>
      <section class="panel help">
        <h2>本の問題を取り込む</h2>
        <p>Claudeが本の問題から作った問題ファイルを「設定と同期」から読み込むと、アプリの問題と同じように解けます。取り込んだ問題は公開ページには載らず、この端末と秘密Gistにだけ保存されます。ホームの「問題の出どころ」で、取り込んだ問題だけを解くこともできます。</p>
      </section>
      <section class="panel help">
        <h2>ホーム画面に追加する</h2>
        <p>AndroidのChromeならメニュー（︙）から「ホーム画面に追加」、iPhoneはSafariの共有ボタンから「ホーム画面に追加」で、アプリのように開けます。一度開いた後は、電波のない場所でも解けます（同期はつながったときに行われます）。</p>
      </section>
      <section class="panel help">
        <h2>記録の保存と同期</h2>
        <p>記録はまずこの端末に保存されます。「設定と同期」でGitHubのトークンを入れると、GitHubの秘密Gistにも保存され、別の端末と記録がまとまります。同じ問題を別々の端末で解いても、両方の記録が残ります。</p>
      </section>
      <section class="panel help">
        <h2>問題について</h2>
        <p>問題はG検定の公式シラバス（G2024#6から適用）の10分野に沿って作ったオリジナル問題です。本番の過去問ではありません。法律やガイドラインは改正されることがあるので、直前には公式テキストや最新の情報もあわせて確認してください。</p>
      </section>`;
  }

  /* ---------- 操作 ---------- */

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return;
    const act = el.dataset.act;
    switch (act) {
      case 'nav': go(el.dataset.to || ''); break;
      case 'start': startSession(el.dataset.mode); break;
      case 'mock': mockOpen = !mockOpen; renderHome(); break;
      case 'mockstart': startSession('t', { n: Number(el.dataset.n) }); break;
      case 'resume': go('quiz'); break;
      case 'discard':
        if (confirm('解きかけの問題をやめますか？ 解いた分の記録は残ります。')) { clearSession(); renderHome(); }
        break;
      case 'count': settings.count = Number(el.dataset.n); saveSettings(); renderHome(); break;
      case 'allcats': settings.cats = []; saveSettings(); renderHome(); break;
      case 'cat': {
        const c = el.dataset.cat;
        if (settings.cats.includes(c)) settings.cats = settings.cats.filter((x) => x !== c);
        else settings.cats = [...settings.cats, c];
        if (settings.cats.length === CATS.length) settings.cats = [];
        saveSettings();
        renderHome();
        break;
      }
      case 'answer': answer(Number(el.dataset.k)); break;
      case 'next': next(); break;
      case 'quit': quit(); break;
      case 'flag': {
        const id = el.dataset.id;
        const on = !isFlag(id);
        setFlag(id, on);
        el.setAttribute('aria-pressed', String(on));
        toast(on ? '要対策フラグを付けました' : '要対策フラグを外しました');
        break;
      }
      case 'kp': {
        const id = el.dataset.id;
        const v = Number(el.dataset.v);
        const next = kpMine(id) === v ? null : v;
        setKp(id, next);
        paintKp(id);
        toast(next === 1 ? '印刷用に入れます' : next === 0 ? '印刷用には入れません' : '未判断に戻しました');
        break;
      }
      case 'kpfilter': settings.kpFilter = el.dataset.v; saveSettings(); renderKanpe(); break;
      case 'kpcopy':
        if (!kpCounts().total) { toast('印刷に入る問題がまだありません'); break; }
        copyText(kanpeText()).then((ok) => toast(ok ? 'コピーしました。Claudeとのチャットに貼り付けてください' : 'コピーできませんでした。「ファイルに保存」を使ってください'));
        break;
      case 'kpsave': downloadFile(kanpeFile()); break;
      case 'kpshare': {
        const file = kanpeFile();
        const data = { files: [file], title: 'G検定 印刷用カンペの材料' };
        if (navigator.canShare && !navigator.canShare(data)) { downloadFile(file); break; }
        navigator.share(data).catch(() => { /* 共有をやめた */ });
        break;
      }
      case 'src': settings.src = el.dataset.v; saveSettings(); renderHome(); break;
      case 'packpick': document.getElementById('packFile').click(); break;
      case 'packclear':
        if (confirm(`取り込んだ問題（${pack.q.length}問）を消しますか？ 同期している場合は、ほかの端末からも消えます。解いた記録は残ります。`)) {
          pack = { ...normalizePack(null), updated: now() };
          lsSet(KEY.pack, pack);
          buildQuestions(); computeIndex(); clearSession(); Sync.soon(300);
          settings.src = 'all'; saveSettings();
          toast('取り込んだ問題を消しました');
          renderSettings();
        }
        break;
      case 'retry': {
        const ids = lastResult.ids.filter((id) => lastResult.res[id] && !lastResult.res[id].ok);
        startSession('x', { ids });
        break;
      }
      case 'toggle': {
        const li = el.closest('li');
        const d = li.querySelector('.rdetail');
        const open = d.classList.toggle('hidden') === false;
        li.classList.toggle('open', open);
        el.setAttribute('aria-expanded', String(open));
        break;
      }
      case 'connect': {
        const tok = (document.getElementById('tok').value || '').trim();
        if (!tok) { Sync.set('err', 'トークンを貼り付けてください'); return; }
        el.disabled = true;
        Sync.connect(tok).then((ok) => { if (ok) toast('同期をはじめました'); renderSettings(); });
        break;
      }
      case 'syncnow': Sync.run(); break;
      case 'disconnect':
        if (confirm('この端末の同期を解除しますか？ この端末の記録とGist上の記録はどちらも消えません。')) { Sync.disconnect(); renderSettings(); }
        break;
      case 'resetmaster':
        if (confirm('卒業の記録をリセットして、すべての問題を卒業モードに戻しますか？ 正答率などに使う解答の履歴は残ります。')) {
          state.masterReset = now();
          saveState(); computeIndex(); Sync.soon(500);
          toast('卒業モードを最初からにしました');
        }
        break;
      case 'export': {
        const blob = new Blob([serialize(state)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `g-kentei-drill-${dayKey(now())}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        break;
      }
      case 'importpick': document.getElementById('importFile').click(); break;
      case 'wipe':
        if (confirm('すべての解答記録と要対策フラグを消しますか？ 同期している場合は、ほかの端末の記録も消えます。')) {
          state = { ...emptyState(), wipedAt: now(), prefs: state.prefs };
          saveState(); computeIndex(); clearSession(); Sync.soon(300);
          toast('記録を消しました');
          go('');
        }
        break;
      default: break;
    }
  });

  app.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'exam') {
      state.prefs.exam = [el.value, now()];
      saveState(); Sync.soon(2000); renderSettings();
    } else if (el.dataset.act === 'shuffle') {
      settings.shuffle = el.checked; saveSettings();
    } else if (el.dataset.act === 'kpsuggest') {
      settings.kpSuggest = el.checked; saveSettings(); renderKanpe();
    } else if (el.dataset.note) {
      setNote(el.dataset.note, el.value);
    } else if (el.id === 'packFile' && el.files && el.files[0]) {
      el.files[0].text().then((txt) => {
        const incoming = normalizePack(JSON.parse(txt));
        if (!incoming.q.length) throw new Error('empty');
        const merged = new Map(pack.q.map((q) => [q.id, q]));
        let added = 0;
        for (const q of incoming.q) { if (!merged.has(q.id)) added++; merged.set(q.id, q); }
        pack = { ...normalizePack(null), updated: now(), q: [...merged.values()] };
        if (!lsSet(KEY.pack, pack)) throw new Error('save');
        buildQuestions(); computeIndex(); Sync.soon(300);
        toast(`${incoming.q.length}問を取り込みました（新しい問題${added}問）`);
        renderSettings();
      }).catch(() => toast('このファイルは問題として読み込めませんでした'));
      el.value = '';
    } else if (el.id === 'importFile' && el.files && el.files[0]) {
      el.files[0].text().then((txt) => {
        const incoming = normalize(JSON.parse(txt));
        state = mergeStates(state, incoming);
        saveState(); computeIndex(); Sync.soon(500);
        toast(`記録を取り込みました（解答${incoming.log.length}件）`);
      }).catch(() => toast('このファイルは読み込めませんでした'));
    }
  });

  app.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.classList || !d.classList.contains('kcat')) return;
    if (d.open) openCats.add(d.dataset.cat); else openCats.delete(d.dataset.cat);
  }, true);

  let noteTimer = 0;
  app.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el.dataset || !el.dataset.note) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => setNote(el.dataset.note, el.value), 900);
  });

  document.addEventListener('keydown', (ev) => {
    if (route() !== 'quiz' || !session || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
    const id = session.ids[session.i];
    const answered = !!session.res[id];
    const k = ev.key.toLowerCase();
    const pos = '123456'.indexOf(k) >= 0 ? '123456'.indexOf(k) : 'abcdef'.indexOf(k);
    if (!answered && pos >= 0) {
      const btns = app.querySelectorAll('.choice');
      if (btns[pos]) { ev.preventDefault(); btns[pos].click(); }
    } else if (answered && (k === 'enter' || k === ' ' || k === 'arrowright')) {
      ev.preventDefault(); next();
    } else if (k === 'f') {
      const b = app.querySelector('.qbar .flag-btn');
      if (b) b.click();
    } else if (k === 'k' && answered) {
      const b = app.querySelector('.kp [data-v="1"]');
      if (b) b.click();
    } else if (k === 'escape') {
      quit();
    }
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => Sync.soon(200));
  document.addEventListener('visibilitychange', () => {
    if (!Sync.connected) return;
    if (document.visibilityState === 'visible') { clearTimeout(Sync.timer); Sync.timer = setTimeout(() => Sync.run(), 300); }
    else if (Sync.cfg.dirty) Sync.run();
  });

  /* ---------- 起動 ---------- */

  let DATA_VERSION = '';

  async function boot() {
    try {
      const res = await fetch('data/questions.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      DATA_VERSION = data.version || '';
      BASE = data;
      buildQuestions();
    } catch {
      app.innerHTML = '<p class="boot">問題を読み込めませんでした。電波のある場所でもう一度開いてください。</p>';
      return;
    }
    settings.cats = settings.cats.filter((c) => CATNAME[c]);
    if (session && (!Array.isArray(session.ids) || !session.ids.length)) clearSession();
    computeIndex();
    if (Sync.connected) Sync.status = 'ok';
    render();
    if (Sync.connected) Sync.run();
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしで動かす */ });
  }

  boot();
})();
