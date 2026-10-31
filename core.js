/* WordForge core — pure game logic (no DOM). Browser: window.WF · Node: module.exports */
(function (root) {
  'use strict';

  const INTERVALS = [0, 1, 3, 7, 14, 30]; // days until next review, indexed by box
  const MASTER_BOX = 4;                   // box 4+ = recalled correctly on 4 separate days
  const STORE_KEY = 'wordforge.v1';

  /* ---------- utils ---------- */
  let rng = Math.random;
  let clock = () => new Date();
  const setRng = f => { rng = f || Math.random; };
  const setClock = f => { clock = f || (() => new Date()); };
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const dayKey = d => { d = d || clock(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const parseDay = k => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const diffDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  /* ---------- state ---------- */
  function newState() {
    return {
      v: 1, cv: 0, xp: 0, // cv = content version: which word list this progress belongs to
      streak: { count: 0, best: 0, last: null },
      levels: {},   // levelId -> {runs, stars, done, last}
      words: {},    // wordId  -> {box, due, seen, right, wrong, lastRight, introduced}
      notes: {},    // wordId  -> user's memory trick
      theme: 'midnight', unlocked: ['midnight'],
      stats: { answered: 0, correct: 0, perfectRounds: 0, bestCombo: 0, reviews: 0 },
      settings: { sound: true, speak: true, voice: '' }, // voice '' = automatic
      log: {}       // day -> {xp, levels, reviews}
    };
  }
  function migrate(s) {
    const base = newState();
    const out = Object.assign(base, s || {});
    out.streak = Object.assign(newState().streak, (s && s.streak) || {});
    out.stats = Object.assign(newState().stats, (s && s.stats) || {});
    out.settings = Object.assign(newState().settings, (s && s.settings) || {});
    ['levels', 'words', 'notes', 'log'].forEach(k => { out[k] = (s && s[k]) || {}; });
    delete out.custom; delete out.removed; delete out.nextId; // levels are part of the game now, not player-made
    out.unlocked = Array.isArray(out.unlocked) && out.unlocked.length ? out.unlocked : ['midnight'];
    return out;
  }
  // When the word list changes (WF_CONTENT_VERSION), progress made on the old words no longer fits: start fresh, keep settings.
  function applyContentVersion(state, ver) {
    if (!ver || state.cv === ver) return { state, reset: false };
    const fresh = newState(); fresh.settings = state.settings; fresh.cv = ver;
    const had = state.xp > 0 || Object.keys(state.words).length > 0 || Object.keys(state.levels).length > 0;
    return { state: fresh, reset: had };
  }
  function load(storage) {
    try {
      const raw = storage.getItem(STORE_KEY);
      return raw ? migrate(JSON.parse(raw)) : newState();
    } catch (e) { return newState(); }
  }
  function save(storage, state) {
    try { storage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function exportState(state) { return JSON.stringify(state); }
  function importState(text) {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object' || s.v !== 1 || !s.words || !s.streak) throw new Error('That does not look like a WordForge backup.');
    return migrate(s);
  }

  /* ---------- levels & words ---------- */
  function allLevels(base) { return base.slice().sort((a, b) => a.id - b.id); }
  function prepared(lvls) {
    const seen = new Set(), out = [];
    lvls.forEach(l => l.words.forEach(w => {
      const id = w.w.trim().toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, w: w.w.trim(), pos: w.pos || '', def: w.def, ex: w.ex, level: l.id, levelTitle: l.title });
    }));
    return out;
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stemOf = w => { w = w.toLowerCase(); return w.length > 5 ? w.slice(0, -2) : (w.length > 3 ? w.slice(0, -1) : w); };
  function findWord(ex, word) {
    let m = new RegExp('\\b' + esc(word) + '\\b', 'i').exec(ex);
    if (!m) m = new RegExp('\\b' + esc(stemOf(word)) + '[a-z]*', 'i').exec(ex);
    if (!m) return null;
    return { before: ex.slice(0, m.index), match: m[0], after: ex.slice(m.index + m[0].length) };
  }
  function blankSentence(ex, word) {
    const p = findWord(ex, word);
    return p ? p.before + '_____' + p.after : ex + ' _____';
  }
  /* ---------- questions ---------- */
  function pickDistractors(target, pool, n, hard) {
    const scored = pool.filter(x => x.id !== target.id).map(x => ({
      x,
      s: (x.pos && x.pos === target.pos ? 2 : 0) + (Math.abs(x.w.length - target.w.length) <= 2 ? 1 : 0) + rng() * (hard ? 1.2 : 3)
    }));
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, n).map(o => o.x);
  }
  // types: def (word -> pick definition) · exdef (example sentence -> pick definition) · sent (sentence blank -> pick word)
  //        defword (definition -> pick word) · type (definition -> type the word)
  function buildQuestion(type, word, pool, opts) {
    opts = opts || {};
    const q = { type, wordId: word.id, word };
    if (type === 'type' || type === 'listen') {
      q.answer = word.w;
      q.prompt = { def: word.def, pos: word.pos };
      if (type === 'type' && findWord(word.ex, word.w)) q.prompt.sentence = blankSentence(word.ex, word.w); // the example, as a clue for spelling it
      return q;
    }
    const items = shuffle([word].concat(pickDistractors(word, pool, 3, opts.hard)));
    q.choices = items.map(x => (type === 'def' || type === 'exdef' ? x.def : x.w));
    q.choiceIds = items.map(x => x.id);
    q.answerIndex = items.indexOf(word);
    if (type === 'def') q.prompt = { word: word.w, pos: word.pos };
    else if (type === 'exdef') q.prompt = { word: word.w, pos: word.pos, sentence: word.ex };
    else if (type === 'sent') q.prompt = { sentence: blankSentence(word.ex, word.w) };
    else q.prompt = { def: word.def, pos: word.pos };
    return q;
  }
  // "tap the pairs": the words are split into boards of about 5; each board is ONE question
  function buildPairs(words, size) {
    size = size || 5;
    const ws = shuffle(words), n = ws.length;
    if (n < 2) return [];
    const g = Math.ceil(n / size), base = Math.floor(n / g), extra = n % g, out = [];
    let at = 0;
    for (let i = 0; i < g; i++) {
      const items = ws.slice(at, at + base + (i < extra ? 1 : 0)); at += items.length;
      out.push({ type: 'pairs', wordId: items[0].id, word: items[0], items });
    }
    return out;
  }
  function checkTyped(input, answer) {
    const a = String(input).trim().toLowerCase(), b = answer.toLowerCase();
    if (a === b) return 'exact';
    if (a && b.length >= 6 && lev(a, b) === 1) return 'close';
    return 'wrong';
  }
  function reshuffled(q) {
    if (!q.choices) return Object.assign({}, q);
    const idx = shuffle(q.choices.map((_, i) => i));
    return Object.assign({}, q, {
      choices: idx.map(i => q.choices[i]),
      choiceIds: idx.map(i => q.choiceIds[i]),
      answerIndex: idx.indexOf(q.answerIndex)
    });
  }

  /* ---------- round engine ---------- */
  const XP = { def: 8, exdef: 10, sent: 10, defword: 10, type: 15, listen: 15, pairs: 12 };
  function createRound(questions, opts) {
    opts = opts || {};
    return {
      queue: questions.slice(), total: questions.length, done: 0, mistakes: 0, missed: {}, attempts: {},
      combo: 0, bestCombo: 0, xp: 0, bonus: 0,
      hearts: opts.hearts == null ? null : opts.hearts,
      xpMult: opts.xpMult == null ? 1 : opts.xpMult,
      boss: !!opts.boss, finished: false, failed: false
    };
  }
  function submit(r, ok, usedHint) {
    const q = r.queue.shift();
    const key = q.type + ':' + q.wordId;
    const tries = (r.attempts[key] = (r.attempts[key] || 0) + 1);
    const res = { ok, firstTry: ok && tries === 1, xp: 0, comboBonus: 0, combo: 0, heartLost: false, finished: false, failed: false, question: q };
    if (ok) {
      r.done++; r.combo++;
      if (r.combo > r.bestCombo) r.bestCombo = r.combo;
      const base = res.firstTry ? XP[q.type] * (r.boss ? 1.2 : 1) * (usedHint ? 0.5 : 1) : 2;
      if (r.combo >= 5 && r.combo % 5 === 0) res.comboBonus = Math.min(20, r.combo);
      res.xp = Math.round((base + res.comboBonus) * r.xpMult);
    } else {
      r.mistakes++; r.combo = 0;
      const slipped = q.type === 'pairs' && q.missIds && q.missIds.length ? q.missIds : [q.wordId];
      slipped.forEach(id => { r.missed[id] = (r.missed[id] || 0) + 1; });
      if (q.type === 'pairs') {
        // a board cannot be left until every pair is right, so it is finished, just without full XP
        r.done++; res.xp = Math.round(3 * r.xpMult);
      } else {
        if (r.hearts != null) { r.hearts--; res.heartLost = true; }
        r.queue.splice(Math.min(3, r.queue.length), 0, reshuffled(q)); // it comes back in a few questions
      }
    }
    res.combo = r.combo;
    r.xp += res.xp;
    if (r.hearts != null && r.hearts <= 0) { r.failed = res.failed = true; r.finished = true; }
    else if (r.queue.length === 0) { r.finished = res.finished = true; }
    return res;
  }
  const roundBonus = r => (r.failed ? 0 : Math.round((20 + (r.mistakes === 0 ? 30 : 0)) * r.xpMult));

  /* ---------- spaced repetition ---------- */
  function wordRec(state, id) {
    return state.words[id] || (state.words[id] = { box: 0, due: null, seen: 0, right: 0, wrong: 0, lastRight: null, introduced: null });
  }
  // Called once per word at the end of a level / review. missed = {wordId: n} for words answered wrong at least once.
  function finalizeWords(state, ids, missed, today) {
    return ids.map(id => {
      const w = wordRec(state, id);
      const bad = !!(missed && missed[id]);
      const before = w.box;
      w.seen++;
      if (w.introduced == null) w.introduced = today;
      if (bad) {
        w.wrong++; w.box = Math.max(0, w.box - 2); w.due = addDays(today, 1);
      } else {
        w.right++;
        if (w.lastRight !== today) { w.box = Math.min(5, w.box + 1); w.lastRight = today; } // max one box per day
        w.due = addDays(today, INTERVALS[w.box] || 1);
      }
      return { id, ok: !bad, before, after: w.box };
    });
  }
  function statusOf(rec) {
    if (!rec || !rec.seen) return 'new';
    if (rec.box <= 1) return 'learning';
    if (rec.box < MASTER_BOX) return 'familiar';
    return 'mastered';
  }
  function dueWords(state, pool, today) {
    return pool.filter(w => { const r = state.words[w.id]; return r && r.seen > 0 && r.due && r.due <= today; })
      .sort((a, b) => (state.words[a.id].due < state.words[b.id].due ? -1 : state.words[a.id].due > state.words[b.id].due ? 1 : state.words[a.id].box - state.words[b.id].box));
  }
  function buildReview(state, pool, today, max) {
    const qs = dueWords(state, pool, today).slice(0, max || 20).map(w => {
      const box = state.words[w.id].box;
      const types = box <= 1 ? ['def', 'sent'] : box < MASTER_BOX ? ['sent', 'defword'] : ['sent', 'type', 'listen'];
      return buildQuestion(types[Math.floor(rng() * types.length)], w, pool, { hard: box >= 2 });
    });
    return shuffle(qs);
  }
  function masteryCounts(state, pool) {
    const c = { new: 0, learning: 0, familiar: 0, mastered: 0, total: pool.length };
    pool.forEach(w => { c[statusOf(state.words[w.id])]++; });
    return c;
  }
  const masteredCount = state => Object.keys(state.words).filter(k => state.words[k].box >= MASTER_BOX).length;

  /* ---------- streak, xp log, levels ---------- */
  function touchStreak(state, today) {
    const s = state.streak;
    if (s.last === today) return { changed: false, count: s.count };
    s.count = (s.last && s.last === addDays(today, -1)) ? s.count + 1 : 1;
    s.last = today;
    if (s.count > s.best) s.best = s.count;
    return { changed: true, count: s.count };
  }
  function effectiveStreak(state, today) {
    const s = state.streak;
    if (!s.last) return 0;
    return (s.last === today || s.last === addDays(today, -1)) ? s.count : 0;
  }
  function logActivity(state, day, patch) {
    const d = state.log[day] || (state.log[day] = { xp: 0, levels: 0, reviews: 0 });
    Object.keys(patch).forEach(k => { d[k] = (d[k] || 0) + patch[k]; });
    const keys = Object.keys(state.log).sort();
    while (keys.length > 120) delete state.log[keys.shift()];
  }
  const levelStars = mistakes => (mistakes <= 2 ? 3 : mistakes <= 6 ? 2 : 1);
  function completeLevel(state, level, mistakes, today) {
    const rec = state.levels[level.id] || (state.levels[level.id] = { runs: 0, stars: 0, done: null, last: null });
    rec.runs++;
    rec.stars = Math.max(rec.stars, levelStars(mistakes));
    rec.done = rec.done || today;
    rec.last = today;
    return rec;
  }
  function levelsDoneCount(state) { return Object.keys(state.levels).filter(k => state.levels[k].done).length; }

  /* ---------- themes & ranks ---------- */
  const THEMES = [
    { id: 'midnight', name: 'Midnight Violet', blurb: 'The original. Black melting into violet.', task: 'Yours from the start', target: 0, unit: '', value: () => 0, preview: ['#07040d', '#2a0f52', '#6d3bd2'], meta: '#12081f' },
    { id: 'ocean', name: 'Ocean Deep', blurb: 'Black water, teal light.', task: 'Reach a 3-day streak', target: 3, unit: 'days', value: s => s.streak.best, preview: ['#020b12', '#06304a', '#12a1b8'], meta: '#041620' },
    { id: 'ember', name: 'Ember', blurb: 'Charcoal with a hot core.', task: 'Finish a round with zero mistakes', target: 1, unit: 'perfect round', value: s => s.stats.perfectRounds, preview: ['#0b0503', '#3a1205', '#ff7a2f'], meta: '#1a0904' },
    { id: 'noir', name: 'Noir', blurb: 'Pure monochrome. Zero distractions.', task: 'Chain a 20-answer combo', target: 20, unit: 'in a row', value: s => s.stats.bestCombo, preview: ['#000000', '#161616', '#4a4a4a'], meta: '#050505' },
    { id: 'daylight', name: 'Daylight', blurb: 'Soft lavender paper for daytime sessions.', task: 'Complete 5 levels', target: 5, unit: 'levels', value: s => levelsDoneCount(s), preview: ['#faf7ff', '#e8deff', '#c9b6ff'], meta: '#f3edff' },
    { id: 'sakura', name: 'Sakura Night', blurb: 'Deep plum with a pink glow.', task: 'Reach a 7-day streak', target: 7, unit: 'days', value: s => s.streak.best, preview: ['#0d0408', '#3a0f2a', '#ff5fa2'], meta: '#1a0712' },
    { id: 'gold', name: 'Gold Rush', blurb: 'Black and burnished gold.', task: 'Earn 6,000 XP', target: 6000, unit: 'XP', value: s => s.xp, preview: ['#0a0803', '#2d2106', '#f5b301'], meta: '#150f03' },
    { id: 'forest', name: 'Deep Forest', blurb: 'Midnight woods, emerald light.', task: 'Master 10 words', target: 10, unit: 'words', value: s => masteredCount(s), preview: ['#020b06', '#08301f', '#2fbf82'], meta: '#041a10' },
    { id: 'aurora', name: 'Aurora', blurb: 'Animated northern lights. The flex theme.', task: 'Reach a 14-day streak', target: 14, unit: 'days', value: s => s.streak.best, preview: ['#05030c', '#3b1a6e', '#17c9a5'], meta: '#0a0618' }
  ];
  function themeProgress(state, t) {
    const v = t.value(state);
    return { value: Math.min(v, t.target), target: t.target, done: v >= t.target };
  }
  function checkUnlocks(state) {
    const fresh = [];
    THEMES.forEach(t => {
      if (!state.unlocked.includes(t.id) && t.value(state) >= t.target) { state.unlocked.push(t.id); fresh.push(t); }
    });
    return fresh;
  }
  const RANKS = [[0, 'Wordling'], [300, 'Vocab Rookie'], [1000, 'Word Nerd'], [2500, 'Sentence Slinger'], [5000, 'Wordsmith'], [9000, 'Lexicon Lord'], [15000, 'SAT Slayer']];
  function rankOf(xp) {
    let i = 0;
    RANKS.forEach((r, k) => { if (xp >= r[0]) i = k; });
    const cur = RANKS[i], nxt = RANKS[i + 1];
    return { name: cur[1], nextName: nxt ? nxt[1] : null, toNext: nxt ? nxt[0] - xp : 0, pct: nxt ? ((xp - cur[0]) / (nxt[0] - cur[0])) * 100 : 100 };
  }

  /* ---------- voices (text-to-speech) ---------- */
  const isEnglish = v => /^en([-_]|$)/i.test(v.lang || '');
  // The list shown in settings: English voices if there are any, otherwise everything the device has.
  function voiceChoices(voices) {
    const en = (voices || []).filter(isEnglish);
    return (en.length ? en : (voices || []).slice()).sort((a, b) => a.name.localeCompare(b.name));
  }
  // pref = saved voiceURI/name ('' = automatic). Falls back to the best English voice the device offers.
  function chooseVoice(voices, pref) {
    if (!voices || !voices.length) return null;
    if (pref) {
      const m = voices.find(v => v.voiceURI === pref || v.name === pref);
      if (m) return m;
    }
    const en = voices.filter(isEnglish);
    const us = en.filter(v => /^en[-_]US$/i.test(v.lang));
    const nice = list => list.find(v => /natural|neural|premium|enhanced|google/i.test(v.name));
    return nice(us) || us[0] || nice(en) || en[0] || null;
  }
  const voiceLabel = v => v.name.replace(/^Microsoft\s+/, '') + ' (' + v.lang + ')';

  const WF = {
    INTERVALS, MASTER_BOX, STORE_KEY, THEMES, RANKS, XP,
    setRng, setClock, dayKey, parseDay, addDays, diffDays, shuffle, lev,
    newState, migrate, load, save, exportState, importState,
    allLevels, prepared, findWord, blankSentence,
    buildQuestion, buildPairs, checkTyped, createRound, submit, roundBonus,
    wordRec, finalizeWords, statusOf, dueWords, buildReview, masteryCounts, masteredCount,
    applyContentVersion, touchStreak, effectiveStreak, logActivity, levelStars, completeLevel, levelsDoneCount,
    themeProgress, checkUnlocks, rankOf, voiceChoices, chooseVoice, voiceLabel, isEnglish
  };
  root.WF = WF;
  if (typeof module !== 'undefined' && module.exports) module.exports = WF;
})(typeof window !== 'undefined' ? window : globalThis);
