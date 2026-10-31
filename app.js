/* WordForge UI */
(function () {
  'use strict';
  const WF = window.WF;
  const BASE = window.WF_LEVELS || [];
  const CV = window.WF_CONTENT_VERSION || 1;
  let S = WF.load(window.localStorage);
  let freshNote = false;
  (function () { const r = WF.applyContentVersion(S, CV); S = r.state; freshNote = r.reset; WF.save(window.localStorage, S); })();
  const $app = document.getElementById('app');
  let view = { name: 'home' };
  let run = null;      // the level / review currently being played
  let kb = null;       // keyboard handlers of the current screen
  let installEvt = null;

  const today = () => WF.dayKey();
  // The path is Day 1..5, Chapter 1, Day 6..10, Chapter 2 and so on. A chapter has no words of its own:
  // it is a checkpoint that quizzes the five days before it.
  let levelsMemo = null;
  const levels = () => {
    if (levelsMemo) return levelsMemo;
    const out = [];
    WF.allLevels(BASE).forEach((l, i, all) => {
      out.push(l);
      if ((i + 1) % 5 === 0) {
        const n = (i + 1) / 5, from = all.slice(i - 4, i + 1);
        out.push({ id: 'c' + n, title: 'Chapter ' + n, chapter: true, n, from, words: [], label: 'Days ' + from[0].id + '–' + from[4].id });
      }
    });
    return (levelsMemo = out);
  };
  const pool = () => WF.prepared(WF.allLevels(BASE));
  const wordsOf = l => (l.chapter ? pool().filter(w => l.from.some(f => f.id === w.level)) : pool().filter(w => w.level === l.id));
  const lvlCount = l => (l.chapter ? l.from.reduce((n, f) => n + f.words.length, 0) : l.words.length);
  const save = () => WF.save(window.localStorage, S);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const POS = { adj: 'adjective', n: 'noun', v: 'verb', adv: 'adverb' };
  const posLabel = p => POS[p] || p || '';
  const stars = (n, max) => '★'.repeat(n) + '☆'.repeat((max || 3) - n);

  const MSG = {
    good: ['Clean.', 'Nailed it.', 'Correct. Smug mode: justified.', "That's the one.", 'Brain: working. Confirmed.', 'Look at you, lexicon-ing.', 'Yep. Easy for you.'],
    bad: ['Not that one.', 'Plot twist: nope.', "Close-ish. Let's lock it in.", 'Everyone misses this once.', "Nope, but now you'll remember it."],
    combo: { 3: 'Three in a row.', 5: "Five straight. You're cooking.", 10: "Ten. Don't blink.", 15: 'Fifteen?! Okay, show-off.', 20: 'Twenty. Unreasonable. Respect.' }
  };
  // A level is three stages: the word-by-word chain, one matching stage over all the words, then the boss.
  const STAGES = [
    { id: 'chain', name: 'Word by word', title: 'Learn each word', tip: 'Each word gets its own mini-lesson: its meaning, an example, a sentence, then spelling.' },
    { id: 'match', name: 'Match-up', title: 'Everything you learned', tip: 'Tap a word, then its meaning. A quick recap of the whole level.' },
    { id: 'boss', name: 'Boss battle', title: 'The final test', boss: true, tip: 'Three hearts. Trickier sentences. The words you missed come back for revenge.' }
  ];
  const CH_STAGES = [
    { id: 'mix', name: 'Chapter quiz', title: 'Mixed questions', tip: 'Questions from all five days of this chapter, shuffled. The words you struggled with before show up more often.' },
    { id: 'match', name: 'Match-up', title: 'Everything you learned', tip: 'Tap a word, then its meaning. Words from across the chapter.' },
    { id: 'boss', name: 'Chapter boss', title: 'The final test', boss: true, tip: 'Three hearts. Trickier sentences from every day. The words you missed come back for revenge.' }
  ];
  const stagesOf = () => (run && run.chapter ? CH_STAGES : STAGES);
  const STEP_NAME = { def: 'Meaning', exdef: 'In a sentence', listen: 'Spelling by ear', type: 'Spelling', sent: 'Use it', defword: 'Find the word' };
  const RECAP_TYPES = ['defword', 'sent', 'exdef', 'def'];
  const REVIEW_STAGE = { id: 'rev', name: 'Daily review', title: 'Spaced repetition', tip: 'Words that are due, in mixed question types. This is where long-term memory actually gets built.' };

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (let i = 2; i < arguments.length; i++) put(el, arguments[i]);
    return el;
  }
  // Safe append: skips null/false, flattens arrays, turns strings into text nodes.
  // (Native append() would print "null" and "[object HTMLElement]" on screen.)
  function put(el) {
    for (let i = 1; i < arguments.length; i++) {
      [].concat(arguments[i]).flat(Infinity).forEach(c => {
        if (c == null || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return el;
  }
  const ICON = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'
  };
  const svg = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const bar = pct => h('div', { class: 'bar' }, h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));

  /* ---------- feedback helpers: sound, voice, confetti, toast, sheets ---------- */
  let AC = null;
  function tone(seq) {
    if (!S.settings.sound) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      let t = AC.currentTime;
      seq.forEach(n => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = n[2] || 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(n[3] || 0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1]);
        o.connect(g); g.connect(AC.destination);
        o.start(t); o.stop(t + n[1] + 0.03);
        t += n[1] * 0.8;
      });
    } catch (e) { /* audio is optional */ }
  }
  const SFX = {
    good: () => tone([[660, 0.09], [880, 0.14]]),
    bad: () => tone([[220, 0.16, 'sawtooth', 0.06], [165, 0.2, 'sawtooth', 0.06]]),
    win: () => tone([[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.26]]),
    pop: () => tone([[520, 0.05, 'sine', 0.06]])
  };
  const synth = () => ('speechSynthesis' in window ? window.speechSynthesis : null);
  const allVoices = () => { try { return synth() ? synth().getVoices() : []; } catch (e) { return []; } };
  let onVoices = null; // set by the settings screen so its list refreshes when the device finishes loading voices
  if (synth() && synth().addEventListener) synth().addEventListener('voiceschanged', () => { if (onVoices) onVoices(); });
  function speak(text, force, rate) {
    if ((!S.settings.speak && !force) || !synth()) return;
    try {
      synth().cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = WF.chooseVoice(allVoices(), S.settings.voice);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.rate = rate || 0.9;
      synth().speak(u);
    } catch (e) { /* voice is optional */ }
  }
  function confetti(n) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = h('canvas', { class: 'confetti' });
    document.body.append(cv);
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) { cv.remove(); return; }
    const W = (cv.width = window.innerWidth), H = (cv.height = window.innerHeight);
    const cs = getComputedStyle(document.documentElement);
    const cols = ['--accent', '--accent2', '--good'].map(v => cs.getPropertyValue(v).trim() || '#c4a1ff').concat('#ffffff', '#ffcf4a');
    const ps = Array.from({ length: n || 120 }, () => ({
      x: W / 2, y: H * 0.38, vx: (Math.random() - 0.5) * 15, vy: -Math.random() * 15 - 4,
      r: Math.random() * 5 + 3, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      ps.forEach(p => {
        p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      });
      if (++f < 110) requestAnimationFrame(tick); else cv.remove();
    })();
  }
  function toast(msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    box.append(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3300);
  }
  function sheet() {
    const back = h('div', { class: 'sheet-back' });
    const box = h('div', { class: 'sheet pop' }, [].slice.call(arguments));
    back.append(box);
    const close = () => back.remove();
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.body.append(back);
    return close;
  }
  function ask(title, text, okLabel, onOk, danger) {
    const close = sheet(
      h('h3', null, title), h('p', { class: 'muted' }, text),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { close(); onOk(); } }, okLabel))
    );
  }
  function copyText(text) {
    const fallback = () => {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Could not copy'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback);
    else fallback();
  }

  /* ---------- state helpers ---------- */
  function applyTheme() {
    const id = view.name === 'preview' ? view.id : S.theme; // a preview shows a theme without equipping it
    document.documentElement.setAttribute('data-theme', id);
    const t = WF.THEMES.find(x => x.id === id) || WF.THEMES[0];
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t.meta);
  }
  function addXp(n) {
    if (!n) return;
    S.xp += n;
    WF.logActivity(S, today(), { xp: n });
  }
  function unlockCheck() {
    WF.checkUnlocks(S).forEach(t => {
      if (run) run.newThemes.push(t);
      toast('🎨 Theme unlocked: ' + t.name, 'win');
    });
  }
  const levelDone = l => !!(S.levels[l.id] && S.levels[l.id].done);

  /* ---------- navigation ---------- */
  function go(name, params) {
    view = Object.assign({ name }, params || {});
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }
  const TABS = [['home', 'Home', 'home'], ['levels', 'Levels', 'layers'], ['words', 'Words', 'book'], ['themes', 'Themes', 'drop'], ['more', 'More', 'sliders']];
  function nav(tab) {
    return h('nav', { class: 'nav' }, TABS.map(t =>
      h('button', { class: t[0] === tab ? 'on' : '', onclick: () => go(t[0]) },
        h('span', { class: 'ic', html: svg(ICON[t[2]]) }), h('span', null, t[1]))));
  }
  function render() {
    applyTheme();
    kb = null; onVoices = null;
    if (!run && ['learn', 'quiz', 'summary'].indexOf(view.name) >= 0) view = { name: 'home' };
    const V = { home: viewHome, words: viewWords, themes: viewThemes, more: viewMore, preview: viewPreview, levels: viewLevels, learn: viewLearn, quiz: viewQuiz, summary: viewSummary };
    const tabs = ['home', 'levels', 'words', 'themes', 'more'];
    const out = (V[view.name] || viewHome)(view);
    $app.textContent = '';
    put($app, out);
    if (tabs.indexOf(view.name) >= 0) $app.append(nav(view.name));
  }
  const closeBtn = () => h('button', { class: 'icon-btn', 'aria-label': 'Leave', onclick: confirmLeave }, '✕');
  function confirmLeave() {
    ask('Leave this session?', 'Your XP so far is kept. The current round starts over next time.', 'Leave', () => { run = null; go('home'); });
  }
  const speakBtn = text => h('button', { class: 'icon-btn', 'aria-label': 'Pronounce', onclick: e => { e.stopPropagation(); speak(text); } }, '🔊');
  function sentenceNodes(w) {
    const p = WF.findWord(w.ex, w.w);
    return p ? [p.before, h('mark', null, p.match), p.after] : [w.ex];
  }

  /* =====================  HOME  ===================== */
  function viewHome() {
    const t = today(), lv = levels(), P = pool();
    const streak = WF.effectiveStreak(S, t);
    const atRisk = streak > 0 && S.streak.last !== t;
    const rank = WF.rankOf(S.xp);
    const due = WF.dueWords(S, P, t);
    const mc = WF.masteryCounts(S, P);
    const nextIdx = lv.findIndex(l => !levelDone(l));
    const doneToday = !!(S.log[t] && S.log[t].levels > 0);
    const hr = new Date().getHours();
    const greet = hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const page = h('main', { class: 'page' });

    put(page, h('header', { class: 'top' },
      h('div', null, h('div', { class: 'brand' }, 'WordForge'), h('div', { class: 'sub' }, greet + '.')),
      h('div', { class: 'chips' },
        h('span', { class: 'chip fire' + (streak ? '' : ' dim') }, '🔥 ' + streak),
        h('span', { class: 'chip' }, '⚡ ' + S.xp.toLocaleString()))));

    if (atRisk) put(page, h('div', { class: 'banner' }, '🔥 Your ' + streak + "-day streak ends tonight unless you finish today's level."));

    put(page, h('div', { class: 'card rankcard' },
      h('div', { class: 'row' }, h('b', null, rank.name), h('span', { class: 'muted sm' }, rank.nextName ? rank.toNext.toLocaleString() + ' XP to ' + rank.nextName : 'Max rank. Go outside.')),
      bar(rank.pct)));

    // today's mission
    const mission = h('div', { class: 'card mission pop' });
    if (!lv.length) {
      put(mission, h('div', { class: 'eyebrow' }, 'Coming soon'), h('h2', null, 'No levels yet'),
        h('p', { class: 'muted' }, 'Your first levels are on the way.'));
    } else if (nextIdx === -1) {
      put(mission, h('div', { class: 'eyebrow' }, 'All clear'), h('h2', null, 'Every level cleared'),
        h('p', { class: 'muted' }, "That's everything for now. Keep your reviews going and replay any level from the list below."));
    } else {
      const l = lv[nextIdx];
      put(mission, h('div', { class: 'eyebrow' }, l.chapter ? (doneToday ? 'Bonus checkpoint' : 'Chapter checkpoint') : doneToday ? 'Bonus round' : "Today's mission"), h('h2', null, l.title),
        h('div', { class: 'pills' }, h('span', { class: 'pill' }, lvlCount(l) + ' words'), h('span', { class: 'pill' }, l.chapter ? 'recap of ' + l.label : 'word by word'), h('span', { class: 'pill' }, 'boss fight')),
        doneToday ? h('p', { class: 'muted sm', style: { marginTop: '10px' } }, "Today's level is already done. One a day is the plan, but you're allowed to be extra.") : null,
        h('button', { class: 'btn primary big', onclick: () => startLevel(l) }, doneToday ? 'Start anyway' : 'Start level'));
    }
    put(page, mission);

    // daily review
    put(page, h('div', { class: 'card row' },
      h('div', null, h('b', null, 'Daily review'),
        h('div', { class: 'muted sm' }, due.length ? due.length + ' word' + (due.length === 1 ? '' : 's') + ' due. This is what makes it stick.' : 'Nothing due. Your memory is behaving.')),
      h('button', { class: 'btn primary sm', disabled: !due.length, onclick: startReview }, 'Review')));

    // mastery
    if (mc.total) {
      const pct = k => (mc[k] / mc.total) * 100 + '%';
      put(page, h('div', { class: 'card' },
        h('div', { class: 'row' }, h('b', null, 'Mastery'), h('span', { class: 'muted sm' }, mc.mastered + ' / ' + mc.total + ' mastered')),
        h('div', { class: 'seg', style: { marginTop: '12px' } },
          ['mastered', 'familiar', 'learning', 'new'].map(k => h('i', { class: 's-' + k, style: { width: pct(k) } }))),
        h('div', { class: 'legend' }, [['mastered', 'Mastered'], ['familiar', 'Familiar'], ['learning', 'Learning'], ['new', 'New']].map(k => h('span', { class: 'dot-' + k[0] }, k[1] + ' ' + mc[k[0]])))));
    }

    // level path
    const cur = nextIdx === -1 ? lv.length - 1 : nextIdx;
    const from = Math.max(0, cur - 1), to = Math.min(lv.length, cur + 3);
    put(page, h('div', { class: 'section-h row' }, h('span', null, 'Your levels'),
      h('button', { class: 'linkbtn', onclick: () => go('levels') }, 'All ' + lv.length + ' levels →')));
    const path = h('div', { class: 'path' });
    lv.slice(from, to).forEach((l, k) => put(path, pathNode(l, from + k, lv)));
    put(page, path);
    if (to < lv.length) put(page, h('p', { class: 'muted sm', style: { textAlign: 'center', marginTop: '10px' } }, (lv.length - to) + ' more levels unlock as you go.'));
    return page;
  }
  /* =====================  LEVELS  ===================== */
  function viewLevels() {
    const lv = levels(), doneN = lv.filter(levelDone).length;
    const words = lv.reduce((n, l) => n + l.words.length, 0), learned = lv.filter(levelDone).reduce((n, l) => n + l.words.length, 0); // chapters have no words of their own
    const page = h('main', { class: 'page' });
    put(page, h('header', { class: 'top' }, h('div', null, h('div', { class: 'brand' }, 'Levels'),
      h('div', { class: 'sub' }, doneN + ' of ' + lv.length + ' cleared · ' + learned + ' of ' + words + ' words'))));
    put(page, h('div', { class: 'card' }, bar(lv.length ? (doneN / lv.length) * 100 : 0),
      h('p', { class: 'muted sm', style: { margin: '10px 0 0' } }, 'Each level unlocks when you finish the one before it. Finishing a new level keeps your streak alive.')));
    const path = h('div', { class: 'path' });
    lv.forEach((l, i) => put(path, pathNode(l, i, lv)));
    put(page, path);
    setTimeout(() => { const el = document.querySelector('.node.avail'); if (el && view.name === 'levels' && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 60);
    return page;
  }
  function pathNode(l, i, lv) {
    const rec = S.levels[l.id];
    const done = levelDone(l);
    const prevDone = i === 0 || levelDone(lv[i - 1]);
    const st = done ? 'done' : prevDone ? 'avail' : 'locked';
    return h('button', { class: 'node ' + st + (l.chapter ? ' chapter' : ''), onclick: () => {
      if (st === 'locked') toast('Finish "' + lv[i - 1].title + '" first.');
      else if (st === 'avail') startLevel(l);
      else {
        const close = sheet(h('h3', null, l.title), h('p', { class: 'muted' }, 'Cleared ' + stars(rec.stars) + '. Replaying gives half XP, but the words still count toward spaced repetition.'),
          h('button', { class: 'btn primary big', onclick: () => { close(); startLevel(l); } }, 'Replay level'),
          h('button', { class: 'btn big ghost', onclick: () => close() }, 'Close'));
      }
    } },
      h('span', { class: 'dot' }, done ? '✓' : st === 'locked' ? '🔒' : l.chapter ? '★' : String(l.id)),
      h('span', { class: 'ntxt' }, h('b', null, l.title), h('small', null, st === 'locked' ? 'Finish ' + lv[i - 1].title + ' to unlock' : (l.chapter ? 'Checkpoint · recap of ' + l.label : l.words.length + ' words') + (done ? ' · ' + stars(rec.stars) : ''))),
      h('span', { class: 'go' }, st === 'locked' ? '' : done ? 'Replay' : 'Start'));
  }

  /* =====================  LEARN  ===================== */
  function startLevel(l) {
    const words = wordsOf(l);
    if (words.length < 2) { toast('This level has no words.'); return; }
    run = { mode: 'level', level: l, words, chapter: !!l.chapter, countsForStreak: !levelDone(l) || levels().every(levelDone), stageIdx: 0, wi: 0, missedAll: {}, mistakes: 0, xp: 0, bossFails: 0, first: !levelDone(l), phase: 'learn', round: null, newThemes: [], resume: 0, recap: {}, asked: {} };
    if (l.chapter) { run.pick = chapterPicks(words, l); beginStage(0); return; }
    run.round = WF.createRound(chainQs(words[0]), { xpMult: run.first ? 1 : 0.5 });
    let rc = 0; for (let i = 0; i < words.length; i++) rc += Math.min(i, 2);
    run.round.total = words.length * 4 + rc; // so the bar fills across the whole chain, recaps included
    go('learn', { chain: true });
  }
  // A level only ever asks about its own words, so distractors come from the same level (or the same chapter).
  const qpool = () => run.words;
  // The questions for word number idx: its own four, with recaps of the words before it woven in.
  // Word 1 gets none, word 2 gets one, from word 3 on there are two. Missed and rarely-asked words are picked first.
  function chainQs(w) {
    const P = qpool(), idx = run.words.indexOf(w);
    const spell = synth() && idx % 2 === 0 ? 'listen' : 'type'; // half the words are spelled by ear
    const own = ['def', 'exdef', 'sent', spell].map(t => WF.buildQuestion(t, w, P, {}));
    const earlier = run.words.slice(0, idx), missedNow = run.round ? run.round.missed : {};
    const score = e => ((run.missedAll[e.id] || 0) + (missedNow[e.id] || 0)) * 3 - (run.recap[e.id] || 0) * 2 + Math.random();
    const rc = earlier.sort((a, b) => score(b) - score(a)).slice(0, Math.min(idx, 2)).map(e => {
      const n = run.recap[e.id] || 0; run.recap[e.id] = n + 1;
      const q = WF.buildQuestion(RECAP_TYPES[n % RECAP_TYPES.length], e, P, {}); q.recap = true; return q;
    });
    return [own[0], own[1], rc[0], own[2], rc[1], own[3]].filter(Boolean);
  }
  function nextWord() {
    run.wi++;
    const r = run.round;
    r.queue = chainQs(run.words[run.wi]); r.finished = false;
    run.phase = 'learn';
    go('learn', { chain: true });
  }
  // Chapter: pick words from every day of the chapter, the ones you have slipped on most first.
  function chapterPicks(words, l) {
    const weak = w => { const r = S.words[w.id]; return (r ? (r.wrong || 0) * 2 - r.box : 0) + Math.random() * 2; };
    const take = (n, skip) => l.from.reduce((acc, f) => acc.concat(words.filter(w => w.level === f.id && !(skip && skip.has(w.id))).sort((a, b) => weak(b) - weak(a)).slice(0, n)), []);
    const mix = take(6), mixIds = new Set(mix.map(w => w.id));
    return { mix: WF.shuffle(mix), match: WF.shuffle(take(3, mixIds)), boss: WF.shuffle(take(3)) };
  }
  function viewChainCard() {
    const ws = run.words, w = ws[run.wi];
    const note = h('textarea', { class: 'note', rows: '2', placeholder: 'Your memory trick (optional): a joke, an image, a word it sounds like…', oninput: e => { S.notes[w.id] = e.target.value; save(); } });
    note.value = S.notes[w.id] || '';
    const go1 = () => { run.phase = 'q'; go('quiz'); };
    kb = { next: go1 };
    return h('main', { class: 'page learn' },
      h('div', { class: 'qtop' }, closeBtn(), bar((run.wi / ws.length) * 100), h('span', { class: 'count' }, (run.wi + 1) + '/' + ws.length)),
      h('article', { class: 'card wordcard pop' },
        h('div', { class: 'wc-top' }, h('span', { class: 'pos' }, posLabel(w.pos) || 'word'), speakBtn(w.w)),
        h('h1', { class: 'bigword' }, w.w),
        h('p', { class: 'def' }, w.def),
        h('p', { class: 'ex' }, sentenceNodes(w)),
        note),
      h('p', { class: 'muted sm', style: { textAlign: 'center' } }, run.wi ? 'Say it out loud once. Then questions on this word, with a recap of the earlier ones mixed in.' : 'Say it out loud once. Then a few quick questions on this word.'),
      h('button', { class: 'btn primary big', onclick: go1 }, 'Got it. Quiz me →'));
  }
  function viewLearn(v) {
    if (v.chain) return viewChainCard();
    const ws = run.words, i = Math.min(v.i, ws.length - 1), w = ws[i];
    const note = h('textarea', { class: 'note', rows: '2', placeholder: 'Your memory trick (optional): a joke, an image, a word it sounds like…', oninput: e => { S.notes[w.id] = e.target.value; save(); } });
    note.value = S.notes[w.id] || '';
    const last = i === ws.length - 1;
    const next = () => { if (last) beginStage(run.resume || 0); else go('learn', { i: i + 1 }); };
    const prev = () => { if (i > 0) go('learn', { i: i - 1 }); };
    kb = { right: next, left: prev };
    return h('main', { class: 'page learn' },
      h('div', { class: 'qtop' }, closeBtn(), bar(((i + 1) / ws.length) * 100), h('span', { class: 'count' }, (i + 1) + '/' + ws.length)),
      h('article', { class: 'card wordcard pop' },
        h('div', { class: 'wc-top' }, h('span', { class: 'pos' }, posLabel(w.pos) || 'word'), speakBtn(w.w)),
        h('h1', { class: 'bigword' }, w.w),
        h('p', { class: 'def' }, w.def),
        h('p', { class: 'ex' }, sentenceNodes(w)),
        note),
      h('p', { class: 'muted sm', style: { textAlign: 'center' } }, 'Say it out loud once. Seriously, it helps.'),
      h('div', { class: 'nav-row' },
        h('button', { class: 'btn', disabled: i === 0, onclick: prev }, '← Back'),
        h('button', { class: 'btn primary', onclick: next }, last ? 'Start the rounds →' : 'Next →')));
  }

  /* =====================  QUIZ  ===================== */
  function beginStage(i) {
    run.stageIdx = i; run.resume = 0; run.phase = 'intro'; run.round = null;
    go('quiz');
  }
  // the words you missed most come back in the boss, two extra questions each (most-missed first, up to 6 words)
  function bossPlan() {
    const P = pool();
    return Object.keys(run.missedAll).sort((x, y) => run.missedAll[y] - run.missedAll[x]).slice(0, 6)
      .map(id => P.find(x => x.id === id)).filter(Boolean);
  }
  const CH_TYPES = ['def', 'exdef', 'defword', 'sent', 'type'];
  function launchRound() {
    if (run.mode === 'review') { run.phase = 'q'; render(); return; }
    const P = qpool(), mult = run.first ? 1 : 0.5, st = stagesOf()[run.stageIdx];
    if (st.id === 'mix') {
      const qs = run.pick.mix.map((w, i) => WF.buildQuestion(CH_TYPES[i % CH_TYPES.length] === 'type' && synth() && i % 2 ? 'listen' : CH_TYPES[i % CH_TYPES.length], w, P, {}));
      run.round = WF.createRound(WF.shuffle(qs), { xpMult: mult });
    } else if (st.id === 'match') {
      run.round = WF.createRound(WF.buildPairs(run.chapter ? run.pick.match : run.words, 5), { xpMult: mult });
    } else {
      const extra = bossPlan().reduce((acc, w) => acc.concat([WF.buildQuestion('defword', w, P, { hard: true }), WF.buildQuestion('exdef', w, P, { hard: true })]), []);
      const main = (run.chapter ? run.pick.boss : run.words).map(w => WF.buildQuestion('sent', w, P, { hard: true }));
      run.round = WF.createRound(WF.shuffle(main.concat(extra)), { hearts: 3, boss: true, xpMult: mult });
    }
    run.phase = 'q';
    render();
  }
  function viewQuiz() {
    if (run.phase === 'intro') return quizIntro();
    if (run.phase === 'end') return quizEnd();
    return quizQuestion();
  }
  const curStage = () => (run.mode === 'review' ? REVIEW_STAGE : stagesOf()[run.stageIdx]);

  function quizIntro() {
    const st = curStage();
    const plan = st.boss ? bossPlan() : [];
    const n = run.mode === 'review' ? run.round.total : st.id === 'mix' ? run.pick.mix.length : st.id === 'match' ? Math.ceil((run.chapter ? run.pick.match : run.words).length / 5) : (run.chapter ? run.pick.boss : run.words).length + plan.length * 2;
    kb = { next: launchRound };
    return h('main', { class: 'page center' },
      h('div', { class: 'card intro pop' },
        h('div', { class: 'eyebrow' }, st.name), h('h2', null, st.title), h('p', { class: 'muted' }, st.tip),
        plan.length ? h('p', { class: 'revenge' }, '😈 Back for revenge: ', plan.map(w => w.w).join(', ')) : null,
        h('div', { class: 'facts' },
          h('span', { class: 'pill' }, n + ' questions'),
          st.boss ? h('span', { class: 'pill' }, '❤️❤️❤️ 3 hearts') : null,
          !run.first && run.mode === 'level' ? h('span', { class: 'pill' }, 'replay: half XP') : null),
        h('button', { class: 'btn primary big', onclick: launchRound }, "Let's go"),
        h('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: confirmLeave }, 'Not now')));
  }

  function quizQuestion() {
    const r = run.round, q = r.queue[0], st = curStage();
    let answered = false, usedHint = false, res = null, moved = false, blankEl = null;
    const fb = h('div', { class: 'feedback hidden' });
    const body = h('div', { class: 'stack' });
    const page = h('main', { class: 'page quiz' },
      h('div', { class: 'qtop' }, closeBtn(), bar((r.done / r.total) * 100),
        r.hearts != null ? h('span', { class: 'hearts' }, '❤️'.repeat(Math.max(0, r.hearts)) + '🖤'.repeat(Math.max(0, 3 - r.hearts))) : null),
      h('div', { class: 'qmeta' }, h('span', { class: 'eyebrow' }, run.mode === 'level' && st.id === 'chain' ? (q.recap ? 'Recap · ' : 'Word ' + (run.wi + 1) + '/' + run.words.length + ' · ') + STEP_NAME[q.type] : st.id === 'mix' ? 'Chapter quiz · ' + STEP_NAME[q.type] : st.name + ' · ' + st.title),
        h('span', { class: 'combo' + (r.combo >= 3 ? ' on' : '') }, r.combo >= 3 ? '🔥 ×' + r.combo : '')),
      body, fb);

    const card = h('div', { class: 'card qcard pop' });
    if (q.type === 'def') {
      put(card, h('div', { class: 'qlabel' }, 'Which definition fits?'),
        h('div', { class: 'qword' }, q.word.w, speakBtn(q.word.w)), q.word.pos ? h('span', { class: 'pos' }, posLabel(q.word.pos)) : null);
    } else if (q.type === 'exdef') {
      const p = WF.findWord(q.prompt.sentence, q.word.w);
      put(card, h('div', { class: 'qlabel' }, 'In this sentence, what does the word mean?'),
        h('p', { class: 'qsent' }, p ? [p.before, h('mark', null, p.match), p.after] : q.prompt.sentence),
        q.word.pos ? h('span', { class: 'pos', style: { marginTop: '10px' } }, posLabel(q.word.pos)) : null);
    } else if (q.type === 'sent') {
      const bits = q.prompt.sentence.split('_____');
      blankEl = h('span', { class: 'blank', 'aria-label': 'Drop the word here' });
      put(card, h('div', { class: 'qlabel' }, 'Drag the word that fits into the blank'), h('p', { class: 'qsent' }, bits[0], blankEl, bits.slice(1).join('_____')));
    } else if (q.type === 'defword') {
      put(card, h('div', { class: 'qlabel' }, 'Which word matches?'), h('p', { class: 'qdef' }, q.prompt.def), q.prompt.pos ? h('span', { class: 'pos', style: { marginTop: '10px' } }, posLabel(q.prompt.pos)) : null);
    } else if (q.type === 'pairs') {
      put(card, h('div', { class: 'qlabel' }, 'Tap the matching pairs'), h('p', { class: 'qpair-tip' }, 'Pick a word, then its meaning.'));
    } else if (q.type === 'listen') {
      const play = rate => speak(q.answer, true, rate);
      put(card, h('div', { class: 'qlabel' }, 'Listen, then type the word'),
        h('div', { class: 'listen' },
          h('button', { class: 'play', 'aria-label': 'Play the word', onclick: () => play(0.9) }, '🔊'),
          h('button', { class: 'play slow', 'aria-label': 'Play slowly', onclick: () => play(0.5) }, '🐢')));
      setTimeout(() => { if (!answered && view.name === 'quiz') play(0.9); }, 350);
    } else {
      put(card, h('div', { class: 'qlabel' }, 'Spell the word'), h('p', { class: 'qdef' }, q.prompt.def),
        q.prompt.sentence ? h('p', { class: 'qclue' }, q.prompt.sentence.split('_____').join(' ＿＿＿ ')) : null);
    }
    put(body, card);

    /* --- feedback + scoring shared by both input styles --- */
    function settle(ok, note) {
      res = WF.submit(r, ok, usedHint);
      S.stats.answered++; if (ok) S.stats.correct++;
      S.stats.bestCombo = Math.max(S.stats.bestCombo, r.bestCombo);
      addXp(res.xp);
      unlockCheck();
      save();
      ok ? SFX.good() : SFX.bad();
      if (blankEl) { blankEl.textContent = q.word.w; blankEl.classList.remove('has', 'over'); blankEl.classList.add('filled'); }
      page.classList.add('fbopen');
      fb.className = 'feedback ' + (ok ? 'good' : 'bad');
      const head = h('div', { class: 'fb-head' });
      const comboMsg = MSG.combo[res.combo];
      if (ok) put(head, h('span', null, pick(MSG.good)), res.xp ? h('span', { class: 'xp-pop' }, '+' + res.xp + ' XP') : null);
      else put(head, h('span', null, pick(MSG.bad) + (res.heartLost ? ' −1 ❤️' : '')));
      const lastBtn = res.failed ? 'See results' : res.finished ? (chainMore() ? 'Next word →' : 'Finish round') : 'Continue';
      fb.textContent = '';
      put(fb, head,
        ok && comboMsg ? h('div', { class: 'fb-note' }, '🔥 ' + comboMsg + (res.comboBonus ? ' +' + res.comboBonus + ' combo bonus' : '')) : null,
        note ? h('div', { class: 'fb-note' }, note) : null,
        (ok && res.firstTry) || q.type === 'pairs' ? null : h('div', { class: 'teach' },
          h('div', { class: 't-word' }, h('b', null, q.word.w), q.word.pos ? h('span', { class: 'pos' }, posLabel(q.word.pos)) : null, speakBtn(q.word.w)),
          h('div', null, q.word.def), h('div', { class: 't-ex' }, sentenceNodes(q.word))),
        h('button', { class: 'btn primary big', onclick: cont }, lastBtn));
      kb = { next: cont };
    }
    const chainMore = () => run.mode === 'level' && st.id === 'chain' && run.wi < run.words.length - 1;
    function cont() {
      if (moved) return; moved = true;
      if (res.failed) endRound();
      else if (res.finished) { if (chainMore()) nextWord(); else endRound(); }
      else render();
    }

    if (q.type === 'pairs') {
      /* ---- tap a word, then its meaning ---- */
      const sel = { w: null, d: null }, slips = {};
      let matched = 0, busy = false;
      const mk = (it, kind) => {
        const b = h('button', { class: 'opt pair ' + kind, 'data-id': it.id, 'data-kind': kind, onclick: () => tap(b, it, kind) }, h('span', null, kind === 'w' ? it.w : it.def));
        b._it = it; return b;
      };
      const colW = h('div', { class: 'col' }), colD = h('div', { class: 'col' });
      WF.shuffle(q.items.slice()).forEach(it => put(colW, mk(it, 'w')));
      WF.shuffle(q.items.slice()).forEach(it => put(colD, mk(it, 'd')));
      function tap(b, it, kind) {
        if (busy || answered || b.disabled) return;
        const was = sel[kind];
        if (was) was.classList.remove('sel');
        if (was === b) { sel[kind] = null; return; }
        sel[kind] = b; b.classList.add('sel');
        if (kind === 'w') speak(it.w);
        if (sel.w && sel.d) resolve();
      }
      function resolve() {
        const a = sel.w, d = sel.d; sel.w = sel.d = null;
        if (a._it.id === d._it.id) {
          [a, d].forEach(x => { x.classList.remove('sel'); x.classList.add('right'); x.disabled = true; });
          SFX.pop(); matched++;
          if (matched === q.items.length) { busy = true; setTimeout(done, 380); }
        } else {
          slips[a._it.id] = true; busy = true; SFX.bad();
          [a, d].forEach(x => { x.classList.remove('sel'); x.classList.add('wrong'); });
          setTimeout(() => { [a, d].forEach(x => x.classList.remove('wrong')); busy = false; }, 450);
        }
      }
      function done() {
        answered = true;
        q.missIds = Object.keys(slips);
        const ok = !q.missIds.length;
        settle(ok, ok ? null : 'Slipped on: ' + q.missIds.map(id => q.items.find(x => x.id === id).w).join(', ') + '. Worth another look later.');
      }
      put(body, h('div', { class: 'pairs' }, colW, colD));
      kb = {};
    } else if (q.type === 'sent') {
      /* ---- drag a word from the bank into the blank (a tap works too) ---- */
      let placed = -1;
      const tiles = [];
      const tray = h('div', { class: 'tray' });
      const checkBtn = h('button', { class: 'btn primary big', disabled: true, onclick: () => submitPlaced() }, 'Check');
      const hintBtn = h('button', { class: 'btn ghost sm', onclick: () => hint() }, '💡 Hint (half XP)');
      const overBlank = (x, y) => {
        const r2 = blankEl.getBoundingClientRect(), pad = 28; // generous landing zone for fingers
        return x > r2.left - pad && x < r2.right + pad && y > r2.top - pad && y < r2.bottom + pad;
      };
      function place(i) {
        if (answered || !tiles[i] || tiles[i].classList.contains('gone')) return;
        if (placed >= 0) tiles[placed].classList.remove('used');   // swapping: the old word goes back to the bank
        placed = i; tiles[i].classList.add('used');
        blankEl.textContent = q.choices[i]; blankEl.classList.add('has');
        checkBtn.disabled = false; SFX.pop();
      }
      function unplace() {
        if (answered || placed < 0) return;
        tiles[placed].classList.remove('used'); placed = -1;
        blankEl.textContent = ''; blankEl.classList.remove('has');
        checkBtn.disabled = true;
      }
      blankEl.addEventListener('click', unplace);
      function startDrag(e, tile, i) {
        if (answered || (e.button != null && e.button > 0)) return;
        if (tile.classList.contains('used') || tile.classList.contains('gone')) return;
        e.preventDefault();
        const rect = tile.getBoundingClientRect();
        const offX = e.clientX - rect.left, offY = e.clientY - rect.top, sx = e.clientX, sy = e.clientY;
        let ghost = null, dragging = false;
        try { tile.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        function finish() {
          tile.removeEventListener('pointermove', move); tile.removeEventListener('pointerup', up); tile.removeEventListener('pointercancel', finish);
          blankEl.classList.remove('over'); tile.classList.remove('lifted');
          if (ghost) ghost.remove();
        }
        function move(ev) {
          if (!dragging) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return; // below 8px it is still a tap
            dragging = true;
            ghost = tile.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = rect.width + 'px';
            document.body.append(ghost); tile.classList.add('lifted');
          }
          ghost.style.transform = 'translate(' + (ev.clientX - offX) + 'px,' + (ev.clientY - offY) + 'px) scale(1.06) rotate(-2deg)';
          blankEl.classList.toggle('over', overBlank(ev.clientX, ev.clientY));
        }
        function up(ev) {
          const hit = dragging ? overBlank(ev.clientX, ev.clientY) : true; // a plain tap also places the word
          finish();
          if (hit) place(i);
        }
        tile.addEventListener('pointermove', move); tile.addEventListener('pointerup', up); tile.addEventListener('pointercancel', finish);
      }
      q.choices.forEach((c, i) => {
        const tile = h('div', { class: 'tile', role: 'button', 'aria-label': c }, h('span', { class: 'tk' }, String(i + 1)), c);
        tiles.push(tile); put(tray, tile);
        tile.addEventListener('pointerdown', e => startDrag(e, tile, i));
      });
      function submitPlaced() {
        if (answered || placed < 0) return;
        answered = true;
        const ok = placed === q.answerIndex;
        tiles.forEach((t, j) => {
          t.classList.remove('used');
          if (j === q.answerIndex) t.classList.add('right'); else if (j === placed) t.classList.add('wrong'); else t.classList.add('dim');
        });
        hintBtn.classList.add('hidden'); checkBtn.classList.add('hidden');
        settle(ok);
      }
      function hint() {
        if (answered || usedHint) return;
        const cand = tiles.map((t, j) => j).filter(j => j !== q.answerIndex && j !== placed);
        if (!cand.length) return;
        usedHint = true;
        tiles[cand[Math.floor(Math.random() * cand.length)]].classList.add('gone');
        hintBtn.classList.add('hidden');
      }
      put(body, h('div', { class: 'tray-label' }, 'Word bank. Drag a word up, or just tap it.'), tray, checkBtn, h('div', { class: 'hint-row' }, hintBtn));
      kb = { choose: place, hint, next: submitPlaced };
    } else if (q.choices) {
      const optEls = [];
      const list = h('div', { class: 'opts' });
      q.choices.forEach((c, i) => {
        const b = h('button', { class: 'opt', onclick: () => choose(i) }, h('span', { class: 'key' }, String(i + 1)), h('span', null, c));
        optEls.push(b); put(list, b);
      });
      const hintBtn = h('button', { class: 'btn ghost sm', onclick: hint }, '💡 Hint (half XP)');
      put(body, list, h('div', { class: 'hint-row' }, hintBtn));
      function choose(i) {
        if (answered) return;
        answered = true;
        const ok = i === q.answerIndex;
        optEls.forEach((b, j) => {
          b.disabled = true;
          if (j === q.answerIndex) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); else b.classList.add('dim');
        });
        hintBtn.classList.add('hidden');
        settle(ok);
      }
      function hint() {
        if (answered || usedHint) return;
        usedHint = true;
        const wrongs = optEls.map((b, j) => j).filter(j => j !== q.answerIndex);
        const j = wrongs[Math.floor(Math.random() * wrongs.length)];
        optEls[j].classList.add('gone'); optEls[j].disabled = true;
        hintBtn.classList.add('hidden');
      }
      kb = { choose, hint };
    } else {
      const pat = h('div', { class: 'pattern' });
      const paint = () => { pat.textContent = q.answer.split('').map((c, i) => (i === 0 && usedHint ? c.toUpperCase() : /[a-z]/i.test(c) ? '_' : c)).join(' '); };
      paint();
      const input = h('input', { class: 'typein', type: 'text', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'type the word…', enterkeyhint: 'done', 'aria-label': 'Your answer' });
      const check = () => {
        if (answered) return;
        const v = input.value.trim();
        if (!v) return;
        answered = true; input.disabled = true; input.blur();
        const kind = WF.checkTyped(v, q.answer);
        const ok = kind !== 'wrong';
        input.classList.add(ok ? 'right' : 'wrong');
        hintBtn.classList.add('hidden'); checkBtn.classList.add('hidden');
        settle(ok, kind === 'close' ? 'Almost: it is spelled "' + q.answer + '". Counted, but mind the spelling.' : (!ok ? 'The word was "' + q.answer + '".' : null));
      };
      const checkBtn = h('button', { class: 'btn primary big', onclick: check }, 'Check');
      const hintBtn = h('button', { class: 'btn ghost sm', onclick: hint }, '💡 Reveal first letter (half XP)');
      function hint() { if (answered || usedHint) return; usedHint = true; paint(); hintBtn.classList.add('hidden'); input.focus(); }
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); } });
      put(card, pat);
      put(body, input, checkBtn, h('div', { class: 'hint-row' }, hintBtn));
      setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 60);
      kb = {};
    }
    return page;
  }

  function mergeMissed(r) { Object.keys(r.missed).forEach(id => { run.missedAll[id] = (run.missedAll[id] || 0) + r.missed[id]; }); }
  function endRound() {
    const r = run.round;
    mergeMissed(r);
    if (r.failed) {
      run.bossFails++; run.xp += r.xp; save();
      run.phase = 'end'; render(); return;
    }
    r.bonus = WF.roundBonus(r);
    addXp(r.bonus); r.xp += r.bonus;
    if (r.mistakes === 0) S.stats.perfectRounds++;
    run.mistakes += r.mistakes; run.xp += r.xp;
    unlockCheck(); save();
    run.phase = 'end'; render();
    SFX.win(); if (r.mistakes === 0) confetti(70);
  }
  function quizEnd() {
    const r = run.round, st = curStage();
    if (r.failed) {
      kb = { next: () => launchRound() };
      return h('main', { class: 'page center' },
        h('div', { class: 'card intro pop' },
          h('div', { class: 'eyebrow' }, 'Boss battle'), h('h2', null, 'Out of hearts 💔'),
          h('p', { class: 'muted' }, 'The boss wins this one. Re-read the cards, or go straight back in with fresh questions.'),
          h('button', { class: 'btn primary big', onclick: launchRound }, 'Rematch'),
          run.chapter ? null : h('button', { class: 'btn big', style: { marginTop: '10px' }, onclick: () => { run.resume = STAGES.length - 1; go('learn', { i: 0 }); } }, 'Re-read the cards first'),
          h('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: () => { run = null; go('home'); } }, 'Back home')));
    }
    const acc = Math.round((r.total / (r.total + r.mistakes)) * 100);
    const missed = Object.keys(r.missed).map(id => run.words.find(w => w.id === id)).filter(Boolean);
    const lastStage = run.mode === 'review' || run.stageIdx === stagesOf().length - 1;
    const nextLabel = run.mode === 'review' ? 'Finish review' : lastStage ? 'Claim the level 🏆' : 'Next: ' + stagesOf()[run.stageIdx + 1].title + ' →';
    const proceed = () => { if (run.mode === 'review') finishReview(); else if (lastStage) finishLevel(); else beginStage(run.stageIdx + 1); };
    kb = { next: proceed };
    return h('main', { class: 'page center' },
      h('div', { class: 'card intro pop' },
        h('div', { class: 'eyebrow' }, st.name + ' complete'),
        h('h2', null, r.mistakes === 0 ? 'Flawless.' : acc >= 80 ? 'Solid.' : 'Done. Lessons learned.'),
        h('div', { class: 'stats3' },
          h('div', { class: 'stat' }, h('b', null, acc + '%'), h('span', null, 'accuracy')),
          h('div', { class: 'stat' }, h('b', null, '×' + r.bestCombo), h('span', null, 'best combo')),
          h('div', { class: 'stat' }, h('b', null, '+' + r.xp), h('span', null, 'XP'))),
        r.bonus ? h('p', { class: 'muted sm', style: { marginTop: '12px' } }, 'Includes +' + r.bonus + ' round bonus' + (r.mistakes === 0 ? ' (perfect round!)' : '') + '.') : null,
        missed.length ? h('div', { style: { marginTop: '16px', textAlign: 'left' } }, h('div', { class: 'muted sm' }, 'Words that tripped you up:'), h('div', { class: 'chips-wrap' }, missed.map(w => h('span', { class: 'wchip' }, w.w)))) : null,
        h('button', { class: 'btn primary big', onclick: proceed }, nextLabel)));
  }

  /* ---------- finishing a level / review ---------- */
  function finishLevel() {
    const t = today();
    WF.finalizeWords(S, (run.chapter ? Array.from(new Set(run.pick.mix.concat(run.pick.match, run.pick.boss).map(w => w.id))) : run.words.map(w => w.id)), run.missedAll, t);
    WF.completeLevel(S, run.level, run.mistakes, t);
    const lvXp = Math.round(50 * (run.first ? 1 : 0.5));
    addXp(lvXp); run.xp += lvXp;
    // the streak is about finishing the level of the day: a NEW level counts (a replay only counts once every level is cleared)
    const st = run.countsForStreak ? WF.touchStreak(S, t) : { changed: false, count: WF.effectiveStreak(S, t), skipped: true };
    WF.logActivity(S, t, { levels: 1 });
    unlockCheck(); save();
    run.summary = {
      kind: 'level', chapter: !!run.chapter, title: run.level.title, stars: WF.levelStars(run.mistakes), xp: run.xp, streak: st, mistakes: run.mistakes,
      missed: Object.keys(run.missedAll).map(id => run.words.find(w => w.id === id)).filter(Boolean), newThemes: run.newThemes
    };
    SFX.win(); confetti(170); go('summary');
  }
  function finishReview() {
    const t = today(), r = run.round;
    WF.finalizeWords(S, run.ids, r.missed, t);
    S.stats.reviews++;
    const st = { changed: false, count: WF.effectiveStreak(S, t), review: true }; // reviews build memory; they do not move the streak
    WF.logActivity(S, t, { reviews: 1 });
    unlockCheck(); save();
    run.summary = {
      kind: 'review', title: 'Daily review', xp: run.xp, streak: st, mistakes: r.mistakes, count: run.ids.length,
      missed: Object.keys(run.missedAll).map(id => run.words.find(w => w.id === id)).filter(Boolean), newThemes: run.newThemes
    };
    SFX.win(); confetti(90); go('summary');
  }
  function startReview() {
    const t = today(), P = pool();
    const qs = WF.buildReview(S, P, t, 20).map(q => (q.type === 'listen' && !synth() ? WF.buildQuestion('type', q.word, P, {}) : q));
    if (!qs.length) { toast('Nothing due right now.'); return; }
    const ids = Array.from(new Set(qs.map(q => q.wordId)));
    run = { mode: 'review', ids, words: P.filter(w => ids.indexOf(w.id) >= 0), stageIdx: 0, missedAll: {}, mistakes: 0, xp: 0, first: true, phase: 'intro', newThemes: [], resume: 0, round: WF.createRound(qs, { xpMult: 0.8 }) };
    go('quiz');
  }
  function viewSummary() {
    const sm = run.summary;
    const st = sm.streak;
    kb = { next: () => { run = null; go('home'); } };
    const page = h('main', { class: 'page center' });
    const card = h('div', { class: 'card intro pop' });
    put(card, h('div', { class: 'eyebrow' }, sm.chapter ? 'Chapter complete' : sm.kind === 'level' ? 'Level complete' : 'Review complete'), h('h2', null, sm.title));
    if (sm.kind === 'level') put(card, h('div', { class: 'bigstars' }, stars(sm.stars)));
    put(card, h('div', { class: 'stats3' },
      h('div', { class: 'stat' }, h('b', null, '+' + sm.xp), h('span', null, 'XP earned')),
      h('div', { class: 'stat' }, h('b', null, '🔥 ' + st.count), h('span', null, 'day streak')),
      h('div', { class: 'stat' }, h('b', null, sm.mistakes), h('span', null, 'mistakes'))));
    put(card, h('p', { class: 'muted sm', style: { marginTop: '12px' } }, st.changed ? (st.count > 1 ? 'Streak extended. Do it again tomorrow.' : 'Streak started. Tomorrow makes it two.') : st.review ? "Reviews lock words into memory. Your streak counts when you finish the day's level." : st.skipped ? 'Replays are for practice. Your streak counts when you finish a new level.' : "Streak already counted today. You're just showing off now."));
    if (sm.missed.length) put(card, h('div', { style: { marginTop: '14px', textAlign: 'left' } }, h('div', { class: 'muted sm' }, 'Watch these. They come back in review tomorrow:'), h('div', { class: 'chips-wrap' }, sm.missed.map(w => h('span', { class: 'wchip' }, w.w)))));
    sm.newThemes.forEach(t => put(card, h('div', { class: 'card unlock', style: { textAlign: 'left' } },
      h('div', { class: 'mini-sw', style: { background: 'linear-gradient(135deg,' + t.preview[0] + ',' + t.preview[1] + ' 55%,' + t.preview[2] + ')' } }),
      h('div', { style: { flex: 1 } }, h('b', null, '🎨 Theme unlocked'), h('div', { class: 'muted sm' }, t.name)),
      h('button', { class: 'btn primary sm', onclick: () => { S.theme = t.id; save(); applyTheme(); toast(t.name + ' equipped'); } }, 'Equip'))));
    put(card, h('button', { class: 'btn primary big', onclick: () => { run = null; go('home'); } }, 'Back home'));
    put(page, card);
    return page;
  }

  /* =====================  WORDS  ===================== */
  function viewWords() {
    const lv = levels(), P = pool(), t = today();
    const mc = WF.masteryCounts(S, P);
    let q = '';
    const list = h('div', { class: 'wlist' });
    function row(w) {
      const rec = S.words[w.id], status = WF.statusOf(rec);
      const detail = h('div', { class: 'wdetail hidden' },
        h('div', null, w.def), h('div', { class: 'ex' }, sentenceNodes(w)),
        S.notes[w.id] ? h('div', { class: 'meta' }, '💭 ' + S.notes[w.id]) : null,
        rec && rec.due ? h('div', { class: 'meta' }, WF.diffDays(t, rec.due) <= 0 ? 'Due for review now' : 'Next review in ' + WF.diffDays(t, rec.due) + ' day' + (WF.diffDays(t, rec.due) === 1 ? '' : 's')) : null);
      const el = h('button', { class: 'wrow', onclick: () => { detail.classList.toggle('hidden'); } },
        h('div', { class: 'wr-top' }, h('div', null, h('b', null, w.w), ' ', h('span', { class: 'muted xs' }, posLabel(w.pos))),
          h('div', { class: 'row' }, h('span', { class: 'badge ' + status }, status), speakBtn(w.w))),
        detail);
      return el;
    }
    function paint() {
      list.replaceChildren();
      lv.forEach(l => {
        const ws = P.filter(w => w.level === l.id && (!q || w.w.toLowerCase().indexOf(q) >= 0 || w.def.toLowerCase().indexOf(q) >= 0));
        if (!ws.length) return;
        put(list, h('div', { class: 'lvl-h' }, l.title), ws.map(row));
      });
      if (!list.children.length) put(list, h('p', { class: 'muted' }, P.length ? 'No matches.' : 'No words yet. Add a level from Home.'));
    }
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search words or meanings…', 'aria-label': 'Search words', oninput: e => { q = e.target.value.trim().toLowerCase(); paint(); } });
    paint();
    return h('main', { class: 'page' },
      h('header', { class: 'top' }, h('div', null, h('div', { class: 'brand' }, 'Word bank'), h('div', { class: 'sub' }, mc.total + ' words · ' + mc.mastered + ' mastered'))),
      search, list);
  }

  /* =====================  THEMES  ===================== */
  const swatchCss = t => 'linear-gradient(135deg,' + t.preview[0] + ',' + t.preview[1] + ' 55%,' + t.preview[2] + ')';
  function viewThemes() {
    const grid = h('div', { class: 'tgrid' });
    WF.THEMES.forEach(t => {
      const pr = WF.themeProgress(S, t), unlocked = S.unlocked.indexOf(t.id) >= 0, eq = S.theme === t.id;
      const fmt = n => n.toLocaleString();
      grid.append(h('div', { class: 'card tcard' + (unlocked ? '' : ' locked') + (eq ? ' equipped' : '') },
        h('div', { class: 'swatch', style: { background: swatchCss(t) } }, unlocked ? null : h('span', { class: 'lock' }, '🔒')),
        h('div', { class: 'tname' }, t.name), h('div', { class: 'muted xs' }, t.blurb),
        h('div', { class: 'tactions' },
          unlocked ? null : h('div', { class: 'task' }, h('div', { class: 'task-t' }, t.task), bar((pr.value / pr.target) * 100), h('div', { class: 'muted xs' }, fmt(pr.value) + ' / ' + fmt(pr.target) + ' ' + t.unit)),
          h('button', { class: 'btn sm ghost', onclick: () => go('preview', { id: t.id }) }, '👁 Preview'),
          unlocked ? h('button', { class: 'btn sm ' + (eq ? '' : 'primary'), disabled: eq, onclick: () => { S.theme = t.id; save(); render(); } }, eq ? 'Equipped ✓' : 'Equip') : null)));
    });
    return h('main', { class: 'page' },
      h('header', { class: 'top' }, h('div', null, h('div', { class: 'brand' }, 'Theme store'), h('div', { class: 'sub' }, S.unlocked.length + ' of ' + WF.THEMES.length + ' unlocked · every theme is earned'))),
      grid);
  }

  /* a full-screen preview: the whole app re-skinned with sample content, nothing is equipped until you say so */
  function viewPreview(v) {
    const list = WF.THEMES, idx = Math.max(0, list.findIndex(t => t.id === v.id)), t = list[idx];
    const unlocked = S.unlocked.indexOf(t.id) >= 0, eq = S.theme === t.id, pr = WF.themeProgress(S, t);
    const step = d => go('preview', { id: list[(idx + d + list.length) % list.length].id });
    kb = { left: () => step(-1), right: () => step(1) };
    const sample = h('div', { class: 'pv-sample', 'aria-hidden': 'true' },
      h('header', { class: 'top' },
        h('div', null, h('div', { class: 'brand' }, 'WordForge'), h('div', { class: 'sub' }, 'Good evening.')),
        h('div', { class: 'chips' }, h('span', { class: 'chip fire' }, '🔥 7'), h('span', { class: 'chip' }, '⚡ 2,140'))),
      h('div', { class: 'card rankcard' }, h('div', { class: 'row' }, h('b', null, 'Word Nerd'), h('span', { class: 'muted sm' }, '360 XP to Sentence Slinger')), bar(72)),
      h('div', { class: 'card qcard' },
        h('div', { class: 'qlabel' }, 'Drag the word that fits into the blank'),
        h('p', { class: 'qsent' }, 'The ', h('span', { class: 'blank has' }, 'ephemeral'), ' beauty of the blossoms made the festival feel precious.')),
      h('div', { class: 'tray' }, h('div', { class: 'tile used' }, 'ephemeral'), h('div', { class: 'tile' }, 'verbose'), h('div', { class: 'tile' }, 'candid'), h('div', { class: 'tile' }, 'obsolete')),
      h('div', { class: 'opts' },
        h('div', { class: 'opt right' }, h('span', { class: 'key' }, '1'), h('span', null, 'lasting for a very short time')),
        h('div', { class: 'opt wrong' }, h('span', { class: 'key' }, '2'), h('span', null, 'using more words than necessary'))),
      h('div', { class: 'card mission' }, h('div', { class: 'eyebrow' }, "Today's mission"), h('h2', null, 'Day 12'),
        h('div', { class: 'pills' }, h('span', { class: 'pill' }, '15 words'), h('span', { class: 'pill' }, 'word by word'), h('span', { class: 'pill' }, 'boss fight')),
        h('div', { class: 'btn primary big', style: { marginTop: '16px' } }, 'Start level')),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, 'Mastery'), h('span', { class: 'muted sm' }, '38 / 180 mastered')),
        h('div', { class: 'seg', style: { marginTop: '12px' } }, h('i', { class: 's-mastered', style: { width: '21%' } }), h('i', { class: 's-familiar', style: { width: '25%' } }), h('i', { class: 's-learning', style: { width: '20%' } }), h('i', { class: 's-new', style: { width: '34%' } }))));
    return [
      h('main', { class: 'page pv' },
        h('div', { class: 'pv-top' },
          h('button', { class: 'icon-btn', 'aria-label': 'Back to the theme store', onclick: () => go('themes') }, '←'),
          h('div', { class: 'pv-title' }, h('div', { class: 'eyebrow' }, 'Theme preview · ' + (idx + 1) + '/' + list.length), h('b', null, t.name)),
          h('div', { class: 'pv-arrows' },
            h('button', { class: 'icon-btn', 'aria-label': 'Previous theme', onclick: () => step(-1) }, '‹'),
            h('button', { class: 'icon-btn', 'aria-label': 'Next theme', onclick: () => step(1) }, '›'))),
        sample),
      h('div', { class: 'pv-bar' },
        unlocked
          ? h('button', { class: 'btn primary big', disabled: eq, onclick: () => { S.theme = t.id; save(); toast(t.name + ' equipped'); render(); } }, eq ? 'Equipped ✓' : 'Equip this theme')
          : h('div', { class: 'pv-lock' }, h('div', { class: 'task-t' }, '🔒 ' + t.task), bar((pr.value / pr.target) * 100), h('div', { class: 'muted xs' }, pr.value.toLocaleString() + ' / ' + pr.target.toLocaleString() + ' ' + t.unit + ' · keep playing to unlock')))
    ];
  }

  /* =====================  MORE  ===================== */
  function viewMore() {
    const sw = (key, label) => {
      const b = h('button', { class: 'switch' + (S.settings[key] ? ' on' : ''), role: 'switch', 'aria-label': label, 'aria-checked': String(!!S.settings[key]), onclick: () => { S.settings[key] = !S.settings[key]; save(); b.classList.toggle('on'); b.setAttribute('aria-checked', String(!!S.settings[key])); if (S.settings[key] && key === 'sound') SFX.good(); } });
      return h('div', { class: 'switch-row' }, h('span', null, label), b);
    };
    // voice picker: whatever voices this device offers
    const voiceSel = h('select', { class: 'field', 'aria-label': 'Voice for the words' });
    const voiceNote = h('p', { class: 'muted xs', style: { marginTop: '6px' } });
    function fillVoices() {
      const vs = WF.voiceChoices(allVoices());
      voiceSel.textContent = '';
      put(voiceSel, h('option', { value: '' }, 'Automatic (best English voice)'));
      vs.forEach(v => put(voiceSel, h('option', { value: v.voiceURI }, WF.voiceLabel(v))));
      voiceSel.value = S.settings.voice && vs.some(v => v.voiceURI === S.settings.voice) ? S.settings.voice : '';
      voiceNote.textContent = vs.length
        ? vs.length + ' voice' + (vs.length === 1 ? '' : 's') + ' available on this device. PCs and iPhones offer different ones.'
        : (synth() ? 'No voices found yet. They can take a moment to load.' : 'This browser cannot read words aloud.');
    }
    voiceSel.addEventListener('change', () => { S.settings.voice = voiceSel.value; save(); speak('ephemeral', true); });
    fillVoices(); onVoices = fillVoices;

    const restoreBox = h('textarea', { class: 'field mono', rows: '4', placeholder: 'Paste a backup here…', 'aria-label': 'Backup text' });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { restoreBox.value = String(rd.result); }; rd.readAsText(f); } });
    const stats = S.stats, acc = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    return h('main', { class: 'page' },
      h('header', { class: 'top' }, h('div', null, h('div', { class: 'brand' }, 'More'), h('div', { class: 'sub' }, 'Settings and backup'))),
      h('div', { class: 'card' }, h('h3', null, 'Your numbers'),
        h('div', { class: 'stats3' },
          h('div', { class: 'stat' }, h('b', null, S.streak.best), h('span', null, 'best streak')),
          h('div', { class: 'stat' }, h('b', null, stats.answered), h('span', null, 'answers')),
          h('div', { class: 'stat' }, h('b', null, acc + '%'), h('span', null, 'accuracy')))),
      h('div', { class: 'card' }, h('h3', null, 'Sound and voice'),
        sw('sound', 'Sound effects'), sw('speak', 'Read words aloud (🔊 buttons)'),
        h('div', { style: { marginTop: '12px' } }, h('div', { class: 'muted sm', style: { marginBottom: '6px' } }, 'Voice for the words'), voiceSel, voiceNote,
          h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: () => speak('ephemeral. Lasting for a very short time.', true) }, '🔊 Preview voice'))),
      h('div', { class: 'card' }, h('h3', null, 'Install as an app'),
        installEvt ? h('button', { class: 'btn primary big', style: { marginBottom: '10px' }, onclick: () => { installEvt.prompt(); installEvt = null; } }, 'Install on this device') : null,
        h('details', null, h('summary', null, 'iPhone'), h('p', null, 'Open this page in Safari, tap the Share button, then "Add to Home Screen". It launches full-screen and works offline.')),
        h('details', { style: { marginTop: '8px' } }, h('summary', null, 'PC (Chrome or Edge)'), h('p', null, 'Click the install icon at the right end of the address bar (or the ⋮ menu → "Install WordForge"). It opens in its own window and works offline.'))),
      h('div', { class: 'card' }, h('h3', null, 'Backup'),
        h('p', { class: 'muted sm' }, 'Your progress lives on this device only. Save a backup now and then, especially on iPhone: iOS can wipe data for sites you have not opened in a while, and installing to the Home Screen avoids most of that risk.'),
        h('div', { class: 'row gap', style: { marginTop: '10px' } },
          h('button', { class: 'btn sm', onclick: () => copyText(WF.exportState(S)) }, 'Copy backup'),
          h('button', { class: 'btn sm', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([WF.exportState(S)], { type: 'application/json' })), download: 'wordforge-backup-' + today() + '.json' }); document.body.append(a); a.click(); a.remove(); } }, 'Download')),
        h('div', { style: { marginTop: '14px' } }, restoreBox,
          h('div', { class: 'row gap', style: { marginTop: '8px' } },
            h('button', { class: 'btn sm', onclick: () => fileIn.click() }, 'Choose file…'),
            h('button', { class: 'btn sm primary', onclick: () => {
              try { const ns = WF.importState(restoreBox.value); ask('Restore this backup?', 'It replaces the progress on this device.', 'Restore', () => { S = WF.applyContentVersion(ns, CV).state; save(); applyTheme(); toast('Backup restored'); go('home'); }, true); }
              catch (e) { toast(e.message || 'Could not read that backup.'); }
            } }, 'Restore')), fileIn)),
      h('div', { class: 'card' }, h('h3', null, 'Danger zone'),
        h('button', { class: 'btn danger big', onclick: () => ask('Reset everything?', 'Deletes all progress and unlocked themes on this device. This cannot be undone.', 'Reset', () => { S = WF.newState(); S.cv = CV; save(); toast('Fresh start.'); go('home'); }, true) }, 'Reset all progress')));
  }

  /* ---------- global wiring ---------- */
  document.addEventListener('keydown', e => {
    if (!kb || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !e.target.disabled) return;
    if (/^[1-4]$/.test(e.key) && kb.choose) { kb.choose(+e.key - 1); return; }
    if (e.key === 'Enter' && kb.next) { if (tag === 'BUTTON') return; e.preventDefault(); kb.next(); return; }
    if ((e.key === 'h' || e.key === 'H') && kb.hint) kb.hint();
    if (e.key === 'ArrowRight' && kb.right) kb.right();
    if (e.key === 'ArrowLeft' && kb.left) kb.left();
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ['home', 'levels', 'words', 'themes', 'more'].indexOf(view.name) >= 0) render(); });

  window.__wf = { get S() { return S; }, get run() { return run; }, get view() { return view; }, go, render, WF }; // handy for debugging
  render();
  if (freshNote) setTimeout(() => toast('Fresh start: the real word list is in, with 20 levels.'), 400);
})();
