'use strict';

(() => {
  // ───────── 기본값 ─────────
  const STORE_KEY = 'wewotaja.v1';
  // 내 컴퓨터(file://, localhost)에서 만든 공유 링크도 친구가 열 수 있게, 그때는 깃허브 페이지 주소를 쓴다
  const PUBLIC_URL = 'https://s26064-crypto.github.io/TIL2/';

  const STAGE = {
    1: { name: '따라 쓰기', desc: '문장을 보면서 그대로 따라 써요. 눈과 손으로 먼저 익혀요.' },
    2: { name: '빈칸 채우기', desc: '절반쯤 가려진 단어를 떠올려서 채워 써요. 막히면 Tab으로 한 단어씩 볼 수 있어요.' },
    3: { name: '첫 글자 힌트', desc: '단어의 첫 글자만 보고 문장 전체를 떠올려 써요.' },
    4: { name: '외워 쓰기', desc: '뜻만 보고 문장을 처음부터 끝까지 써요. 정말 막히면 Tab으로 다음 단어를 볼 수 있어요.' },
  };

  const MODES = {
    steps: [1, 2, 3, 4],
    copy: [1],
    cloze: [2],
    initials: [3],
    recall: [4],
  };

  const FLOW_NOTE = {
    round: '모든 문장을 1단계로 한 바퀴, 2단계로 한 바퀴… 돌아요. 같은 문장 사이에 간격이 생겨서 더 오래 기억돼요.',
    focus: '한 문장을 4단계까지 끝내고 다음 문장으로 넘어가요. 문장이 적을 때나 하나씩 확실히 외우고 싶을 때 좋아요.',
  };

  const DEFAULT_SETTINGS = { mode: 'steps', flow: 'round', scope: 'all', shuffle: false, ignoreCase: false, speak: false, tolerance: 2 };

  const SAMPLE_NAME = '자주 쓰는 영어 문장 (예시)';
  const SAMPLE_TEXT = [
    "I'd like to make a reservation for two. | 두 명 예약하고 싶어요.",
    'Could you tell me how to get to the station? | 역에 어떻게 가는지 알려 주실 수 있나요?',
    "I'm looking forward to seeing you again. | 다시 만나기를 기대하고 있어요.",
    "It's not as difficult as you think. | 생각하는 것만큼 어렵지 않아요.",
    'The more you practice, the better you get. | 연습할수록 더 잘하게 돼요.',
    'Practice makes perfect. | 연습이 완벽을 만든다.',
  ].join('\n');

  // ───────── 작은 도구 ─────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
  const ALNUM = /[A-Za-z0-9À-ɏ]/;
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 복사해 온 문장의 둥근 따옴표·긴 줄표 같은 건 키보드로 치기 어려우니 평범한 글자로 바꿔 둔다.
  function normChars(s) {
    return s
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/…/g, '...')
      .replace(/[  -   　]/g, ' ')
      .replace(/[​-‍﻿]/g, '');
  }
  const normSentence = (s) => normChars(s).replace(/\s+/g, ' ').trim();

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return '오늘';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}분 ${s}초` : `${s}초`;
  }

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ───────── 문장 붙여넣기 해석 ─────────
  const NUMBERING = /^(?:\(\d{1,3}\)|\d{1,3}[.)](?=\s)|[①-⑳❶-❿]|[-*•·▪◦►▶](?=\s))\s*/;

  const ARROW = /^\s*(?:[→⇒➜➝➞➔➡⟶]|-+>|=>)\s*/;

  // "영어 / 뜻" 의 / 위치. and/or, 24/7 처럼 영어 안의 / 는 건너뛴다:
  // 왼쪽에 영어가 있고, 오른쪽이 비었거나(뜻 생략) 한국어가 있으면서 / 앞이 띄어 있거나 바로 한국어가 올 때만 구분자로 본다
  function findSlashSep(raw) {
    const re = /[/／]/g;
    let m;
    while ((m = re.exec(raw))) {
      const left = raw.slice(0, m.index);
      const right = raw.slice(m.index + 1);
      if (!/[A-Za-z]/.test(left)) continue;
      if (!right.trim()) return m.index;
      if (!HANGUL.test(right)) continue;
      if (/\s$/.test(left) || HANGUL.test(right.trimStart()[0])) return m.index;
    }
    return -1;
  }

  function parseText(text) {
    const lines = text.split(/\r?\n/);
    // "영어 문장 / → 한국어 뜻" 꼴이면, 화살표 없는 한국어 줄(예: "1. 헤어짐")은 주제 제목으로 본다
    const arrowKo = lines.some((l) => ARROW.test(l) && HANGUL.test(l));
    const items = [];
    const groups = [];
    let group = null;
    let pending = null;
    let ignored = 0;

    for (const line of lines) {
      const arrowed = ARROW.test(line);
      const raw = line.replace(ARROW, '');
      let en = '';
      let ko = '';
      const sep = raw.search(/[|\t]/);
      const slash = sep < 0 ? findSlashSep(raw) : -1;
      if (sep >= 0) {
        en = raw.slice(0, sep);
        ko = raw.slice(sep + 1).replace(/[|\t]/g, ' ');
      } else if (slash >= 0) {
        en = raw.slice(0, slash);
        ko = raw.slice(slash + 1);
      } else {
        const h = raw.search(HANGUL);
        if (h < 0) en = raw;
        else if (/[A-Za-z].*[A-Za-z]/.test(raw.slice(0, h))) {
          // "영어 문장. 한국어 뜻" / "영어 문장. → 한국어 뜻" 처럼 한 줄에 같이 있는 경우
          en = raw.slice(0, h).replace(/[\s([{:=\/\->→⇒➜➝➞➔➡⟶]+$/, '');
          ko = raw.slice(h);
          if (!/[([]/.test(ko)) ko = ko.replace(/[)\]]+\s*$/, '');
        } else ko = raw;
      }
      en = normSentence(en).replace(NUMBERING, '').trim();
      ko = normSentence(ko).replace(NUMBERING, '').trim();
      if (!/[A-Za-z0-9]/.test(en)) en = '';

      if (arrowKo) {
        if (en) {
          const item = { en, ko };
          items.push(item);
          if (!group) groups.push((group = { title: '', items: [] }));
          group.items.push(item);
        } else if (ko && arrowed) {
          const prev = items[items.length - 1];
          if (prev && !prev.ko) prev.ko = ko;
          else ignored++;
        } else if (ko) groups.push((group = { title: ko, items: [] }));
        continue;
      }

      if (en) {
        const item = { en, ko };
        if (!ko && pending) {
          item.ko = pending;
          pending = null;
        }
        items.push(item);
      } else if (ko) {
        // 한국어만 있는 줄 → 바로 위 영어 문장의 뜻, 아니면 다음 영어 문장의 뜻
        const prev = items[items.length - 1];
        if (prev && !prev.ko && !pending) prev.ko = ko;
        else {
          if (pending) ignored++;
          pending = ko;
        }
      }
    }
    if (pending) ignored++;
    return { items, ignored, groups: groups.filter((g) => g.items.length) };
  }

  const ABBR_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\.$/i;
  const INITIAL_RE = /(?:^|\s)[A-Z]\.$/;

  function splitSentences(text) {
    const out = [];
    const re = /[.!?]+["')\]]*(?=\s+["'(]?[A-Z0-9])/g;
    let start = 0;
    let m;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      const chunk = text.slice(start, end);
      if (ABBR_RE.test(chunk) || INITIAL_RE.test(chunk)) continue;
      out.push(chunk.trim());
      start = end;
    }
    const rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }

  function splitText(text) {
    return text
      .split(/\r?\n/)
      .flatMap((line) => {
        if (!line.trim() || HANGUL.test(line) || /[|\t]/.test(line)) return [line];
        return splitSentences(normSentence(line).replace(NUMBERING, ''));
      })
      .join('\n');
  }

  // ───────── 저장 ─────────
  const newSentence = ({ en, ko }) => ({ id: uid(), en, ko: ko || '', mastered: false, tries: 0, last: null });

  function makeSet(name, items) {
    const now = Date.now();
    return { id: uid(), name, createdAt: now, updatedAt: now, lastPracticed: null, sentences: items.map(newSentence) };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.sets)) {
          d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
          d.best = d.best || 0;
          return d;
        }
      }
    } catch (e) {
      /* 저장소를 못 읽으면 새로 시작 */
    }
    return {
      version: 1,
      sets: [makeSet(SAMPLE_NAME, parseText(SAMPLE_TEXT).items)],
      settings: { ...DEFAULT_SETTINGS },
      best: 0,
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      /* 사생활 보호 모드 등에서는 저장이 안 될 수 있음 */
    }
  }

  const db = load();
  const getSet = (id) => db.sets.find((s) => s.id === id);
  const getSentence = (setId, sid) => {
    const set = getSet(setId);
    return set && set.sentences.find((s) => s.id === sid);
  };

  // ───────── 화면 전환 ─────────
  const VIEWS = ['home', 'editor', 'practice', 'result'];
  let view = 'home';

  function show(name) {
    view = name;
    for (const v of VIEWS) $('#view-' + v).hidden = v !== name;
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  // ───────── 홈 ─────────
  function renderHome() {
    const list = $('#set-list');
    if (!db.sets.length) {
      list.innerHTML = '<div class="empty">아직 문장 세트가 없어요.<br><b>＋ 문장 넣기</b>로 외우고 싶은 문장을 넣어 보세요.</div>';
      return;
    }
    list.innerHTML = db.sets
      .map((set) => {
        const n = set.sentences.length;
        const m = set.sentences.filter((s) => s.mastered).length;
        const pct = n ? Math.round((m / n) * 100) : 0;
        const when = set.lastPracticed ? `최근 연습 ${fmtDate(set.lastPracticed)}` : '아직 연습 안 함';
        const peek = set.sentences[0] ? set.sentences[0].en : '';
        return `
          <article class="set-card" data-id="${set.id}">
            <div class="set-main">
              <h3>${esc(set.name)}${n && m === n ? '<span class="set-done">모두 외움</span>' : ''}</h3>
              <p class="set-meta">${n}문장 · ${when}</p>
              <div class="mastery">
                <div class="mastery-bar"><i style="width:${pct}%"></i></div>
                <span>외운 문장 ${m} / ${n}</span>
              </div>
              ${peek ? `<p class="set-peek">${esc(peek)}</p>` : ''}
            </div>
            <div class="set-actions">
              <button class="btn primary" type="button" data-action="practice">연습하기</button>
              <button class="btn ghost" type="button" data-action="edit">수정</button>
              <button class="btn ghost" type="button" data-action="share">공유</button>
              <button class="btn ghost danger" type="button" data-action="delete">삭제</button>
            </div>
          </article>`;
      })
      .join('');
  }

  function goHome() {
    if (S) finish(false);
    renderHome();
    show('home');
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go="home"]');
    if (go) {
      goHome();
      return;
    }
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const card = act.closest('.set-card');
    const id = card && card.dataset.id;
    switch (act.dataset.action) {
      case 'new-set':
        openEditor(null);
        break;
      case 'practice':
        openSetup(id);
        break;
      case 'share':
        openShare(id);
        break;
      case 'edit':
        openEditor(id);
        break;
      case 'delete': {
        const set = getSet(id);
        if (!set) break;
        askConfirm(`'${set.name}' 세트를 지울까요?`, '지운 세트와 외운 기록은 되돌릴 수 없어요.', '지우기').then((ok) => {
          if (!ok) return;
          db.sets = db.sets.filter((s) => s.id !== id);
          persist();
          renderHome();
          toast('세트를 지웠어요');
        });
        break;
      }
    }
  });

  const previewItem = (it) => `<li><span class="pv-en">${esc(it.en)}</span><span class="pv-ko${it.ko ? '' : ' none'}">${it.ko ? esc(it.ko) : '뜻 없음'}</span></li>`;

  // ───────── 세트 공유 ─────────
  // 서버가 없으니 세트를 링크 # 뒤에 담는다 (# 뒤는 서버로 안 감). 줄일 수 있으면 deflate로 줄인다
  const b64url = {
    enc(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };
  const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  async function encodeSet(set) {
    const data = { v: 1, n: set.name, s: set.sentences.map((x) => (x.ko ? [x.en, x.ko] : [x.en])) };
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if ('CompressionStream' in window) {
      try {
        return 'z' + b64url.enc(await pipeBytes(bytes, new CompressionStream('deflate')));
      } catch (e) {
        /* 못 줄이면 그냥 담는다 */
      }
    }
    return 'j' + b64url.enc(bytes);
  }

  // 링크에서 온 값은 남이 만든 것이니 모양을 확인하고 정리해서만 쓴다
  async function decodeShared(code) {
    const bytes = b64url.dec(code.slice(1));
    let raw;
    if (code[0] === 'z') raw = await pipeBytes(bytes, new DecompressionStream('deflate'));
    else if (code[0] === 'j') raw = bytes;
    else throw new Error('unknown');
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (!data || !Array.isArray(data.s)) throw new Error('shape');
    const items = data.s
      .filter(Array.isArray)
      .slice(0, 500)
      .map(([en, ko]) => ({ en: normSentence(String(en || '')), ko: normSentence(String(ko || '')) }))
      .filter((it) => /[A-Za-z0-9]/.test(it.en));
    if (!items.length) throw new Error('empty');
    return { name: normSentence(String(data.n || '')).slice(0, 60) || '공유받은 문장', items };
  }

  function shareBase() {
    const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    return local ? PUBLIC_URL : location.origin + location.pathname;
  }

  const shareDlg = $('#share');
  const shareUrl = $('#share-url');
  const shareCopy = $('#share-copy');
  let sharing = null;

  async function openShare(id) {
    const set = getSet(id);
    if (!set) return;
    if (!set.sentences.length) {
      toast('공유할 문장이 없어요');
      return;
    }
    const url = shareBase() + '#s=' + (await encodeSet(set));
    sharing = { name: set.name, url };
    $('#share-title').textContent = `'${set.name}' 공유하기`;
    $('#share-msg').textContent = `이 링크를 연 친구는 같은 ${set.sentences.length}문장을 자기 세트로 추가할 수 있어요. 외운 기록은 같이 가지 않아요.`;
    shareUrl.value = url;
    shareCopy.textContent = '링크 복사';
    $('#share-native').hidden = !navigator.share;
    shareDlg.showModal();
    shareUrl.select();
  }

  shareUrl.addEventListener('focus', () => shareUrl.select());
  shareCopy.addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      ok = true;
    } catch (e) {
      shareUrl.focus();
      shareUrl.select();
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        ok = false;
      }
    }
    // 창이 떠 있는 동안엔 아래 알림이 창 뒤로 가려지니 버튼 글자로 알려 준다
    shareCopy.textContent = ok ? '복사했어요 ✓' : '위 링크를 직접 복사해 주세요';
    if (!ok) shareUrl.select();
  });
  $('#share-native').addEventListener('click', () => {
    if (sharing && navigator.share) navigator.share({ title: `외워타자 · ${sharing.name}`, url: sharing.url }).catch(() => {});
  });

  // 공유 링크로 들어오면 세트를 보여 주고 추가할지 묻는다
  const importDlg = $('#import');
  async function checkSharedLink() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search); // 새로 고침해도 또 묻지 않게
    let shared;
    try {
      shared = await decodeShared(m[1]);
    } catch (e) {
      toast('공유 링크를 읽지 못했어요. 링크가 중간에 잘리지 않았는지 확인해 주세요', 4000);
      return;
    }
    if (view !== 'home') goHome();
    const { name, items } = shared;
    const same = db.sets.some((s) => s.name === name && s.sentences.length === items.length && s.sentences.every((x, i) => x.en === items[i].en));
    $('#import-title').textContent = name;
    $('#import-msg').textContent = `${items.length}문장` + (same ? ' · 이미 같은 세트가 있어요. 추가하면 하나 더 생겨요.' : '');
    $('#import-list').innerHTML = items.map(previewItem).join('');
    importDlg.returnValue = '';
    importDlg.showModal();
    importDlg.addEventListener(
      'close',
      () => {
        if (importDlg.returnValue !== 'ok') return;
        const set = makeSet(name, items);
        db.sets.unshift(set);
        persist();
        renderHome();
        openSetup(set.id);
      },
      { once: true }
    );
  }
  window.addEventListener('hashchange', checkSharedLink);

  // 브라우저 기본 confirm()은 앱 안 브라우저 등에서 창 없이 바로 '취소'가 돼 버려서, 페이지 안의 창으로 묻는다
  const confirmDlg = $('#confirm');
  function askConfirm(title, msg, okLabel) {
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = msg;
    $('#confirm-ok').textContent = okLabel;
    confirmDlg.returnValue = '';
    confirmDlg.showModal();
    return new Promise((resolve) => confirmDlg.addEventListener('close', () => resolve(confirmDlg.returnValue === 'ok'), { once: true }));
  }

  // ───────── 문장 넣기 ─────────
  let editingId = null;
  const nameInput = $('#set-name');
  const textInput = $('#set-text');

  function openEditor(id) {
    editingId = id || null;
    const set = id ? getSet(id) : null;
    $('#editor-title').textContent = set ? '문장 세트 수정' : '문장 넣기';
    nameInput.value = set ? set.name : '';
    textInput.value = set ? set.sentences.map((s) => (s.ko ? `${s.en} | ${s.ko}` : s.en)).join('\n') : '';
    renderPreview();
    show('editor');
    textInput.focus();
  }

  // 주제 제목이 2개 이상이고 새로 넣는 중이면, 주제마다 세트를 따로 만들 수 있다
  const canSplitSets = (groups) => !editingId && groups.length >= 2;
  const autoName = (items) => {
    const first = items[0].en;
    return first.length > 28 ? first.slice(0, 28) + '…' : first;
  };

  function renderPreview() {
    const { items, ignored, groups } = parseText(textInput.value);
    $('#preview-count').textContent = groups.length >= 2 ? `${items.length}문장 · 주제 ${groups.length}개` : `${items.length}문장`;
    const warn = $('#preview-warn');
    warn.hidden = !ignored;
    warn.textContent = ignored ? `짝지을 영어 문장이 없는 한국어 줄 ${ignored}개는 빠졌어요.` : '';

    const splitWrap = $('#split-sets-wrap');
    splitWrap.hidden = !canSplitSets(groups);
    $('#split-sets-label').textContent = `주제별로 나눠서 ${groups.length}개 세트로 저장`;

    const li = previewItem;
    let html;
    if (!items.length) html = '<li class="pv-empty">왼쪽에 문장을 넣으면 여기에 한 문장씩 나뉘어 보여요.</li>';
    else if (groups.length >= 2)
      html = groups.map((g) => `<li class="pv-group">${esc(g.title || '제목 없음')}<span>${g.items.length}문장</span></li>${g.items.map(li).join('')}`).join('');
    else html = items.map(li).join('');
    $('#preview-list').innerHTML = html;
  }

  function saveEditor(thenPractice) {
    const { items, groups } = parseText(textInput.value);
    if (!items.length) {
      toast('영어 문장을 한 줄 이상 넣어 주세요');
      textInput.focus();
      return;
    }
    const base = nameInput.value.trim();

    if (canSplitSets(groups) && $('#split-sets').checked) {
      const made = groups.map((g) => makeSet(g.title ? (base ? `${base} · ${g.title}` : g.title) : base || autoName(g.items), g.items));
      db.sets.unshift(...made);
      persist();
      renderHome();
      show('home');
      if (thenPractice) openSetup(made[0].id);
      else toast(`${made.length}개 세트로 나눠서 저장했어요`);
      return;
    }

    const name = base || autoName(items);
    let set = editingId ? getSet(editingId) : null;
    if (set) {
      // 그대로 남은 문장은 외운 기록을 이어 간다
      const old = new Map(set.sentences.map((s) => [s.en, s]));
      set.sentences = items.map((it) => {
        const o = old.get(it.en);
        if (!o) return newSentence(it);
        old.delete(it.en);
        return { ...o, ko: it.ko };
      });
      set.name = name;
      set.updatedAt = Date.now();
    } else {
      set = makeSet(name, items);
      db.sets.unshift(set);
    }
    persist();
    renderHome();
    show('home');
    if (thenPractice) openSetup(set.id);
    else toast(`${items.length}문장을 저장했어요`);
  }

  textInput.addEventListener('input', renderPreview);
  $('#split-btn').addEventListener('click', () => {
    const before = parseText(textInput.value).items.length;
    textInput.value = splitText(textInput.value);
    renderPreview();
    const after = parseText(textInput.value).items.length;
    toast(after > before ? `${after}문장으로 나눴어요` : '더 나눌 문단이 없어요');
  });
  $('#sample-btn').addEventListener('click', () => {
    textInput.value = textInput.value.trim() ? textInput.value.replace(/\s*$/, '\n') + SAMPLE_TEXT : SAMPLE_TEXT;
    renderPreview();
  });
  $('#save-btn').addEventListener('click', () => saveEditor(false));
  $('#save-practice-btn').addEventListener('click', () => saveEditor(true));

  // ───────── 연습 설정 창 ─────────
  const dialog = $('#setup');
  const form = $('#setup-form');
  let setupId = null;

  function openSetup(id) {
    const set = getSet(id);
    if (!set) return;
    if (!set.sentences.length) {
      toast('문장이 없어요. 먼저 문장을 넣어 주세요');
      return;
    }
    setupId = id;
    const st = db.settings;
    const f = form.elements;
    $('#setup-title').textContent = set.name;
    const un = set.sentences.filter((s) => !s.mastered).length;
    $('#scope-all-n').textContent = set.sentences.length;
    $('#scope-un-n').textContent = un;
    form.querySelector('input[name="scope"][value="unmastered"]').disabled = un === 0;
    f.mode.value = st.mode;
    f.flow.value = st.flow;
    f.scope.value = un === 0 ? 'all' : st.scope;
    f.tolerance.value = String(st.tolerance);
    f.shuffle.checked = st.shuffle;
    f.ignoreCase.checked = st.ignoreCase;
    f.speak.checked = st.speak;
    syncSetup();
    dialog.showModal();
  }

  function syncSetup() {
    const f = form.elements;
    const stages = MODES[f.mode.value] || MODES.steps;
    $('#flow-field').classList.toggle('is-off', stages.length === 1);
    $('#tol-field').classList.toggle('is-off', stages[stages.length - 1] === 1);
    $('#flow-note').textContent = FLOW_NOTE[f.flow.value] || '';
  }

  form.addEventListener('change', syncSetup);
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dialog.close();
  });
  form.addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'start') return;
    const f = form.elements;
    const opts = {
      mode: f.mode.value,
      flow: f.flow.value,
      scope: f.scope.value,
      tolerance: Number(f.tolerance.value),
      shuffle: f.shuffle.checked,
      ignoreCase: f.ignoreCase.checked,
      speak: f.speak.checked,
    };
    db.settings = { ...db.settings, ...opts };
    persist();
    // 창이 닫힌 다음에 시작해야 입력칸에 포커스가 간다
    setTimeout(() => startPractice(setupId, opts), 0);
  });

  // ───────── 소리 ─────────
  const canSpeak = 'speechSynthesis' in window;
  let voice = null;
  function pickVoice() {
    if (!canSpeak) return;
    const vs = speechSynthesis.getVoices();
    voice =
      vs.find((v) => /en[-_]US/i.test(v.lang) && /Google|Natural|Samantha|Aria|Jenny/i.test(v.name)) ||
      vs.find((v) => /en[-_]US/i.test(v.lang)) ||
      vs.find((v) => /^en/i.test(v.lang)) ||
      null;
  }
  if (canSpeak) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  let warnedVoice = false;
  function speak(text) {
    if (!canSpeak) {
      toast('이 브라우저는 읽어 주기를 지원하지 않아요');
      return;
    }
    if (!voice) pickVoice();
    if (!voice && !warnedVoice) {
      // 영어 음성이 없으면 한국어 음성이 영어를 읽게 되니 한 번 알려 준다
      warnedVoice = true;
      toast('이 브라우저엔 영어 음성이 없어 한국어 음성으로 읽어요. 크롬이나 엣지에서 열면 영어 발음으로 들려요', 4500);
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  // ───────── 연습 ─────────
  const practiceView = $('#view-practice');
  const card = $('#card');
  const line = $('#p-line');
  const input = $('#p-input');
  let S = null; // 지금 하고 있는 연습
  let lastOpts = null;
  let lastSetId = null;
  let ticker = 0;

  const same = (a, b) => a === b || (S.opts.ignoreCase && a.toLowerCase() === b.toLowerCase());
  const eq = (a, b) => a.length === b.length && [...a].every((ch, i) => same(ch, b[i]));

  function startPractice(setId, opts) {
    const set = getSet(setId);
    if (!set || !set.sentences.length) return;
    let pool = opts.scope === 'unmastered' ? set.sentences.filter((s) => !s.mastered) : set.sentences.slice();
    if (!pool.length) pool = set.sentences.slice();
    const stages = MODES[opts.mode] || MODES.steps;

    const queue = [];
    if (opts.flow === 'focus' && stages.length > 1) {
      for (const s of opts.shuffle ? shuffle(pool) : pool) for (const st of stages) queue.push({ sid: s.id, stage: st });
      queue[0].intro = 'focus';
    } else {
      for (const st of stages) {
        const order = opts.shuffle ? shuffle(pool) : pool;
        order.forEach((s, i) => queue.push({ sid: s.id, stage: st, intro: i === 0 ? 'stage' : null }));
      }
    }

    S = {
      setId,
      opts: { ...opts },
      stages,
      finalStage: stages[stages.length - 1],
      ids: pool.map((s) => s.id),
      queue,
      pos: 0,
      done: 0,
      total: queue.length,
      reviewRound: 0,
      results: {},
      tot: { len: 0, err: 0, correct: 0, ms: 0 },
      best: 0,
      startedAt: Date.now(),
      cur: null,
    };
    lastOpts = { ...opts };
    lastSetId = setId;
    $('#p-set').textContent = set.name;
    show('practice');
    clearInterval(ticker);
    ticker = setInterval(tick, 250);
    nextTask();
  }

  function nextTask() {
    if (S.pos >= S.queue.length) {
      // 마지막 단계에서 통과 못 한 문장은 복습으로 한 번 더
      const need = S.finalStage >= 2 ? S.ids.filter((id) => S.results[id] && S.results[id].last !== 'pass') : [];
      if (!need.length) {
        finish(true);
        return;
      }
      S.reviewRound++;
      const order = S.opts.shuffle ? shuffle(need) : need;
      order.forEach((id, i) => S.queue.push({ sid: id, stage: S.finalStage, review: true, intro: i === 0 ? 'review' : null }));
      S.total += need.length;
    }

    const task = S.queue[S.pos];
    const sent = getSentence(S.setId, task.sid);
    if (!sent) {
      S.pos++;
      if (!task.retry) S.done++;
      nextTask();
      return;
    }

    const target = normSentence(sent.en);
    const words = segment(target);
    const mask = buildMask(target, words, task.stage);
    const cue = new Set();
    // 뜻이 없는 문장은 외워 쓰기에서 첫 단어를 실마리로 보여 준다
    if (task.stage === 4 && !sent.ko && words.length) for (let i = words[0].start; i < words[0].end; i++) cue.add(i);

    S.cur = { task, sent, target, words, mask, cue, revealed: new Set(), typed: '', errs: new Set(), start: 0, endAt: 0, hints: 0, phase: 'typing', revealAll: false, gaveUp: false, submitted: false };
    input.value = '';
    $('#ime-warn').hidden = true;
    hideFeedback();
    renderChrome();
    renderLine();
    if (task.intro) showIntro(task);
    updateStats();
    focusInput();
  }

  // 단어 위치와, 그 안에서 가릴 수 있는 글자(알파벳·숫자, 단어 속 ' 와 -) 위치
  function segment(t) {
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(t))) {
      const start = m.index;
      const end = start + m[0].length;
      const letters = [];
      for (let i = start; i < end; i++) {
        const ch = t[i];
        if (ALNUM.test(ch)) letters.push(i);
        else if ((ch === "'" || ch === '-') && i > start && i < end - 1 && ALNUM.test(t[i - 1]) && ALNUM.test(t[i + 1])) letters.push(i);
      }
      words.push({ start, end, letters });
    }
    return words;
  }

  // true = 가린 글자
  function buildMask(t, words, stage) {
    const mask = new Array(t.length).fill(false);
    if (stage === 1) return mask;
    if (stage === 4) {
      for (let i = 0; i < t.length; i++) mask[i] = t[i] !== ' ';
      return mask;
    }
    const cand = words.filter((w) => w.letters.length);
    if (stage === 3) {
      for (const w of cand) for (const i of w.letters.slice(1)) mask[i] = true;
      return mask;
    }
    // 2단계: 긴 단어(내용어)일수록 잘 가려지도록, 단어 절반 정도를 가린다
    const k = Math.max(1, Math.round(cand.length / 2));
    cand
      .map((w) => ({ w, score: w.letters.length + Math.random() * 4 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .forEach(({ w }) => w.letters.forEach((i) => (mask[i] = true)));
    return mask;
  }

  function renderChrome() {
    const { task, sent, words } = S.cur;
    const st = task.retry ? 1 : task.stage;
    practiceView.dataset.stage = st;
    const chip = $('#p-chip');
    chip.className = 'stage-chip s' + st;
    chip.textContent = task.retry ? '고쳐 쓰기' : task.review ? `복습 · ${STAGE[task.stage].name}` : `${task.stage}단계 · ${STAGE[task.stage].name}`;
    $('#p-count').textContent = `${Math.min(S.done + (task.retry ? 0 : 1), S.total)} / ${S.total}`;
    $('#p-bar').style.width = (S.done / S.total) * 100 + '%';

    const meaning = $('#p-meaning');
    meaning.hidden = !sent.ko;
    meaning.textContent = sent.ko;
    meaning.classList.toggle('big', st === 4);

    const cue = $('#p-cue');
    cue.hidden = st !== 4;
    if (st === 4) cue.textContent = sent.ko ? `단어 ${words.length}개` : `단어 ${words.length}개 · 뜻이 없어서 첫 단어만 보여 드려요`;
    renderHints();
  }

  function renderHints() {
    const el = $('#p-hints');
    const h = S.cur.hints;
    el.hidden = !h;
    el.textContent = `힌트 ${h}번`;
  }

  function renderLine() {
    const c = S.cur;
    const { target: t, typed: u, mask, revealed, cue } = c;
    const n = t.length;
    const recall = c.task.stage === 4 && !c.revealAll;
    const total = Math.max(n, u.length);
    const cells = [];

    for (let i = 0; i < total; i++) {
      const isTyped = i < u.length;
      const hidden = !c.revealAll && i < n && mask[i] && !revealed.has(i) && !cue.has(i);
      // 외워 쓰기에서는 아직 안 친 부분을 미리 보여 주지 않는다 (길이도 숨김)
      if (recall && !isTyped && hidden) break;
      const tc = i < n ? t[i] : '';
      let top = tc;
      let tcls = '';
      let bcls = '';
      if (isTyped) {
        if (i < n && same(u[i], tc)) {
          tcls = hidden ? 'found' : 'done';
          bcls = 'ok';
        } else if (i >= n && u[i] === ' ') {
          // 문장 끝 띄어쓰기는 오타로 치지 않으니 빨갛게도 안 보인다
        } else {
          bcls = 'bad';
          tcls = hidden ? 'mask bad' : i < n ? 'miss' : '';
        }
      } else if (hidden) tcls = 'mask';
      else if (!c.revealAll && cue.has(i)) tcls = 'cue';
      else if (!c.revealAll && revealed.has(i) && mask[i]) tcls = 'hint';
      if (tcls.startsWith('mask')) top = '';
      cells.push({ i, top, tcls, bot: isTyped ? u[i] : '', bcls, sp: tc === ' ' });
    }

    if (c.phase !== 'feedback') {
      let caret = cells.find((x) => x.i === u.length);
      if (!caret) {
        caret = { i: u.length, top: '', tcls: '', bot: '', bcls: '', sp: false };
        cells.push(caret);
      }
      caret.cur = true;
    }

    const cell = (ch) => (ch === '' || ch === ' ' ? '&nbsp;' : esc(ch));
    let html = '<span class="w">';
    for (const x of cells) {
      html += `<span class="c${x.cur ? ' cur' : ''}"><span class="t ${x.tcls}">${cell(x.top)}</span><span class="b ${x.bcls}">${cell(x.bot)}</span></span>`;
      if (x.sp) html += '</span><span class="w">';
    }
    line.innerHTML = html + '</span>';
    line.classList.toggle('recall', recall);
    line.classList.toggle('nohint', recall && !cells.some((x) => x.tcls === 'hint' || x.tcls === 'cue'));
  }

  function countCorrect(c) {
    let k = 0;
    const L = Math.min(c.typed.length, c.target.length);
    for (let i = 0; i < L; i++) if (same(c.typed[i], c.target[i])) k++;
    return k;
  }

  // 지금 입력칸에 틀린 채로 남아 있는 글자 수. 지우고 바르게 다시 치면 줄어서 정확도가 다시 오른다
  // (문장 끝에 덧붙인 띄어쓰기는 세지 않음)
  function wrongNow(c) {
    let k = 0;
    for (let i = 0; i < c.typed.length; i++) {
      if (i >= c.target.length) k += c.typed[i] === ' ' ? 0 : 1;
      else if (!same(c.typed[i], c.target[i])) k++;
    }
    return k;
  }

  function updateStats() {
    if (!S || !S.cur) return;
    const c = S.cur;
    let cpm = 0;
    if (c.start) {
      const ms = (c.endAt || performance.now()) - c.start;
      if (ms > 800) cpm = Math.round(countCorrect(c) / (ms / 60000));
    }
    const live = !c.submitted;
    const len = S.tot.len + (live ? c.target.length : 0);
    const err = S.tot.err + (live ? Math.min(wrongNow(c), c.target.length) : 0);
    const acc = len ? Math.max(0, Math.round((1 - err / len) * 100)) : 100;
    const prog = S.total ? Math.round((S.done / S.total) * 100) : 0;
    const best = Math.max(S.best, 0);

    $('#st-cpm').textContent = cpm;
    $('#st-best').textContent = best;
    $('#st-acc').textContent = acc;
    $('#st-prog').textContent = prog;
    $('#st-cpm-bar').style.width = Math.min(100, (cpm / 500) * 100) + '%';
    $('#st-best-bar').style.width = Math.min(100, (best / 500) * 100) + '%';
    $('#st-acc-bar').style.width = acc + '%';
    $('#st-prog-bar').style.width = prog + '%';
  }

  function tick() {
    if (S && S.cur && S.cur.phase === 'typing' && S.cur.start) updateStats();
  }

  function focusInput() {
    if (!S || view !== 'practice') return;
    input.focus({ preventScroll: true });
    const L = input.value.length;
    try {
      input.setSelectionRange(L, L);
    } catch (e) {
      /* 일부 브라우저 */
    }
  }

  // ── 단계 안내 ──
  function showIntro(task) {
    S.cur.phase = 'intro';
    const st = task.stage;
    const chip = $('#intro-chip');
    chip.className = 'stage-chip lg s' + st;
    let title = STAGE[st].name;
    let desc = STAGE[st].desc;
    if (task.intro === 'review') {
      chip.textContent = `복습 ${S.reviewRound}`;
      title = '못 외운 문장을 한 번 더';
      desc = `${S.queue.length - S.pos}문장이 남았어요. 이번에도 ${STAGE[st].name}로 써 봐요.`;
    } else if (task.intro === 'focus') {
      chip.textContent = '한 문장씩 끝까지';
      title = '한 문장을 4단계로';
      desc = '한 문장을 따라 쓰기 → 빈칸 → 첫 글자 → 외워 쓰기 순서로 끝내고 다음 문장으로 넘어가요.';
    } else {
      chip.textContent = S.stages.length > 1 ? `${st}단계 / ${S.stages.length}` : `${st}단계`;
    }
    $('#intro-title').textContent = title;
    $('#intro-desc').textContent = desc;
    $('#intro').hidden = false;
  }

  function beginTyping() {
    $('#intro').hidden = true;
    S.cur.phase = 'typing';
    S.cur.typed = '';
    input.value = '';
    renderLine();
    focusInput();
  }

  // ── 입력 ──
  input.addEventListener('input', () => {
    if (!S || !S.cur) return;
    const c = S.cur;
    if (c.phase !== 'typing') {
      input.value = c.typed;
      return;
    }
    let v = normChars(input.value.replace(/[\r\n]/g, ''));
    if (v.length > c.target.length + 12) v = v.slice(0, c.target.length + 12);
    if (v !== input.value) input.value = v;
    if (!c.start && v.length) c.start = performance.now();
    // 한 번이라도 틀리게 친 자리 — 정확도에는 안 쓰고, 외워 쓰기 통과 기준(허용 오타)에만 쓴다 (고쳐도 남음)
    for (let i = 0; i < v.length; i++) {
      if (i >= c.target.length && v[i] === ' ') continue; // 문장 끝에 습관처럼 친 띄어쓰기는 봐준다
      if (i >= c.target.length || !same(v[i], c.target[i])) c.errs.add(i);
    }
    c.typed = v;
    $('#ime-warn').hidden = !HANGUL.test(v);
    renderLine();
    updateStats();
  });

  function onKey(e) {
    if (!S || !S.cur) return;
    const c = S.cur;
    if (e.isComposing || e.keyCode === 229) return;

    if (c.phase === 'intro') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        beginTyping();
      } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Tab') e.preventDefault();
      return;
    }
    if (c.phase === 'feedback') {
      // Space는 문장 끝에서 넘어가려고 연달아 누른 것일 수 있어 정답을 볼 틈을 잠깐 둔다
      if (e.key === 'Enter' || (e.key === ' ' && performance.now() - c.endAt > 600)) {
        e.preventDefault();
        continueAfterFeedback();
      } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Tab') e.preventDefault();
      return;
    }
    if (c.phase !== 'typing') {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        submit();
        break;
      case ' ':
        // 한컴타자처럼 문장 끝 마침표까지 치고 Space를 누르면 다음으로
        if (atSentenceEnd(c)) {
          e.preventDefault();
          submit();
        }
        break;
      case 'Tab':
        e.preventDefault();
        hint();
        break;
      case 'Escape':
        e.preventDefault();
        giveUp();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Home':
      case 'End':
        // 커서는 항상 맨 끝에 (중간에 끼워 치지 않게)
        e.preventDefault();
        break;
    }
  }

  input.addEventListener('keydown', onKey);
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    toast('붙여넣기는 안 돼요. 직접 쳐야 외워져요!');
  });
  input.addEventListener('focus', () => {
    card.classList.remove('blurred');
    card.classList.add('focused');
  });
  input.addEventListener('blur', () => {
    card.classList.remove('focused');
    if (S) card.classList.add('blurred');
  });

  // 연습 화면 아무 데나 눌러도 입력이 이어지게 (버튼 눌러도 포커스는 안 뺏기게)
  practiceView.addEventListener('mousedown', (e) => {
    if (document.activeElement === input) e.preventDefault();
  });
  practiceView.addEventListener('click', (e) => {
    if (!e.target.closest('button')) focusInput();
  });
  $('#veil').addEventListener('click', focusInput);
  $('#intro-go').addEventListener('click', beginTyping);

  // 입력칸이 포커스를 잃었을 때 키를 누르면 다시 이어서
  document.addEventListener('keydown', (e) => {
    if (view !== 'practice' || !S || dialog.open || e.target === input) return;
    if (e.target.closest && e.target.closest('button, a, input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    focusInput();
    if (['Enter', 'Tab', 'Escape', ' '].includes(e.key)) onKey(e);
  });

  // ── 판정 ──
  // 문장 끝 문장부호(. ! ?)까지 쳤는지. 문장 안의 Mr. / p.m. / 1.5 같은 점에서는 넘어가지 않도록 개수까지 맞춰 본다
  const END_PUNCT = /[.!?]["')\]]*$/;
  const countPunct = (s) => (s.match(/[.!?]/g) || []).length;
  function atSentenceEnd(c) {
    if (!c.typed.trim()) return false;
    if (!END_PUNCT.test(c.target)) return c.typed.length >= c.target.length;
    return END_PUNCT.test(c.typed) && countPunct(c.typed) >= countPunct(c.target);
  }

  function submit() {
    const c = S.cur;
    const typed = c.typed.replace(/\s+$/, '');
    if (!typed) return;
    const exact = eq(typed, c.target);
    if (!exact && c.task.stage === 1) {
      replay(card, 'shake');
      toast('빨간 글자를 고친 다음 넘어갈 수 있어요');
      return;
    }
    finalize(exact ? judge(c) : 'fail');
  }

  function judge(c) {
    const st = c.task.stage;
    if (!c.task.retry && st >= 2 && st === S.finalStage && (c.hints > 0 || c.errs.size > S.opts.tolerance)) return 'weak';
    return 'pass';
  }

  function giveUp() {
    const c = S.cur;
    if (c.task.stage === 1) return;
    c.gaveUp = true;
    c.hints++;
    finalize('fail');
  }

  function hint() {
    const c = S.cur;
    if (c.task.stage === 1) return;
    let p = 0;
    while (p < c.typed.length && p < c.target.length && same(c.typed[p], c.target[p])) p++;
    // 처음 틀린 곳(또는 지금 칠 곳)부터 아직 가려진 단어를 하나 보여 준다
    const w = c.words.find((w) => {
      if (w.end <= p) return false;
      for (let i = w.start; i < w.end; i++) if (c.mask[i] && !c.revealed.has(i) && !c.cue.has(i)) return true;
      return false;
    });
    if (!w) {
      toast('더 보여 줄 단어가 없어요');
      return;
    }
    for (let i = w.start; i < w.end; i++) c.revealed.add(i);
    c.hints++;
    renderHints();
    renderLine();
  }

  function finalize(result) {
    const c = S.cur;
    c.phase = result === 'fail' ? 'feedback' : 'done';
    c.endAt = performance.now();
    const ms = c.start ? c.endAt - c.start : 0;
    const n = c.target.length;
    const ok = countCorrect(c);

    S.tot.len += n;
    S.tot.err += Math.min(wrongNow(c) + Math.max(0, n - c.typed.trimEnd().length), n);
    S.tot.correct += ok;
    S.tot.ms += ms;
    c.submitted = true;
    if (result !== 'fail' && ms > 800) S.best = Math.max(S.best, Math.round(n / (ms / 60000)));

    if (!c.task.retry && c.task.stage === S.finalStage) {
      const r = S.results[c.sent.id] || (S.results[c.sent.id] = { tries: 0, first: null, last: null });
      r.tries++;
      r.first = r.first || result;
      r.last = result;
      c.sent.tries = (c.sent.tries || 0) + 1;
      if (c.task.stage === 4) {
        c.sent.mastered = result === 'pass';
        c.sent.last = result;
      }
    }
    const set = getSet(S.setId);
    if (set) set.lastPracticed = Date.now();
    persist();
    if (S.opts.speak) speak(c.target);
    updateStats();

    if (result === 'fail') {
      c.revealAll = true;
      renderLine();
      showFeedback();
      return;
    }
    if (result === 'weak') {
      toast(c.hints ? '맞았어요! 힌트를 써서 복습 때 한 번 더 나와요' : `맞았어요! 오타 ${c.errs.size}개라 복습 때 한 번 더 나와요`, 2600);
    } else if (!c.task.retry && c.task.stage === 4) {
      toast('외웠어요! ✓', 1200);
    }
    replay(card, 'flash');
    advance();
  }

  // 단어 단위로 정답과 내가 쓴 것을 맞대 본다 (LCS)
  function wordDiff(target, typed) {
    const A = target.split(' ');
    const B = typed ? typed.split(/\s+/) : [];
    const key = (w) => (S.opts.ignoreCase ? w.toLowerCase() : w);
    const n = A.length;
    const m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i][j] = key(A[i]) === key(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const inA = new Array(n).fill(false);
    const inB = new Array(m).fill(false);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (key(A[i]) === key(B[j])) {
        inA[i] = inB[j] = true;
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return {
      a: A.map((w, k) => (inA[k] ? esc(w) : `<mark>${esc(w)}</mark>`)).join(' '),
      b: B.map((w, k) => (inB[k] ? esc(w) : `<del>${esc(w)}</del>`)).join(' '),
    };
  }

  function showFeedback() {
    const c = S.cur;
    const typed = c.typed.trim();
    const { a, b } = wordDiff(c.target, typed);
    const fb = $('#feedback');
    fb.innerHTML = `
      <div class="fb-head"><b>${c.gaveUp ? '정답을 확인해요' : '조금 달라요'}</b><span>정답을 보고 바로 한 번 고쳐 써 봐요.</span></div>
      <div class="fb-row"><span class="fb-k">정답</span><p class="fb-v">${a}</p></div>
      ${typed ? `<div class="fb-row"><span class="fb-k">내가 쓴 것</span><p class="fb-v">${b}</p></div>` : ''}
      <p class="fb-go"><kbd>Enter</kbd> 또는 <kbd>Space</kbd> 고쳐 쓰러 가기</p>`;
    fb.hidden = false;
    card.classList.add('is-fail');
  }

  function hideFeedback() {
    $('#feedback').hidden = true;
    card.classList.remove('is-fail');
  }

  function continueAfterFeedback() {
    const c = S.cur;
    S.queue.splice(S.pos + 1, 0, { sid: c.sent.id, stage: 1, retry: true });
    advance();
  }

  function advance() {
    if (!S.cur.task.retry) S.done++;
    S.pos++;
    nextTask();
  }

  $('#speak-btn').addEventListener('click', () => {
    if (!S || !S.cur) return;
    const c = S.cur;
    if (c.phase === 'typing' && c.task.stage >= 2 && !c.task.retry) {
      c.hints++;
      renderHints();
      toast('듣기를 힌트로 썼어요');
    }
    speak(c.target);
    focusInput();
  });
  $('#quit-btn').addEventListener('click', () => finish(false));

  // ───────── 결과 ─────────
  function finish(completed) {
    if (!S) return;
    const s = S;
    S = null;
    clearInterval(ticker);
    if (!completed && canSpeak) speechSynthesis.cancel();
    card.classList.remove('blurred', 'focused');
    $('#intro').hidden = true;
    db.best = Math.max(db.best || 0, s.best);
    persist();
    renderResult(s, completed);
    show('result');
    input.blur();
  }

  function renderResult(s, completed) {
    const set = getSet(s.setId);
    const avg = s.tot.ms > 0 ? Math.round(s.tot.correct / (s.tot.ms / 60000)) : 0;
    const acc = s.tot.len ? Math.max(0, Math.round((1 - s.tot.err / s.tot.len) * 100)) : 0;
    $('#r-set').textContent = set ? set.name : '';
    $('#r-title').textContent = completed ? '연습 완료!' : '여기까지 했어요';
    $('#r-cpm').textContent = avg;
    $('#r-best').textContent = s.best;
    $('#r-acc').textContent = s.tot.len ? acc + '%' : '–';
    $('#r-time').textContent = fmtTime(Math.round((Date.now() - s.startedAt) / 1000));

    const memo = s.finalStage >= 2;
    $('#r-mem').hidden = !memo;
    const rows = s.ids.map((id) => ({ sent: getSentence(s.setId, id), r: s.results[id] })).filter((x) => x.sent);
    const firstTry = rows.filter((x) => x.r && x.r.first === 'pass').length;
    const passed = rows.filter((x) => x.r && x.r.last === 'pass').length;

    if (memo) {
      $('#r-mem-sum').textContent = `한 번에 ${firstTry} · 최종 ${passed} / ${rows.length}`;
      $('#r-list').innerHTML = rows
        .map(({ sent, r }) => {
          let cls = 'none';
          let label = '안 함';
          if (r && r.first === 'pass') [cls, label] = ['good', '✓ 한 번에'];
          else if (r && r.last === 'pass') [cls, label] = ['ok', `✓ ${r.tries}번 만에`];
          else if (r && r.last === 'weak') [cls, label] = ['warn', '△ 힌트·오타'];
          else if (r) [cls, label] = ['bad', '✗ 복습 필요'];
          return `<li class="r-item"><span class="r-badge ${cls}">${label}</span><div><p class="r-en">${esc(sent.en)}</p>${sent.ko ? `<p class="r-ko">${esc(sent.ko)}</p>` : ''}</div></li>`;
        })
        .join('');
    }

    let sub;
    if (!completed) sub = '중간에 멈췄어요. 지금까지 한 기록은 저장됐어요.';
    else if (memo) sub = firstTry === rows.length ? `${rows.length}문장을 모두 한 번에 외웠어요. 대단해요!` : `${rows.length}문장 중 ${firstTry}문장을 한 번에 외웠고, 나머지는 복습으로 끝까지 외웠어요.`;
    else sub = `${rows.length}문장을 따라 썼어요. 손에 익었다면 단계별 암기로 외워 봐요.`;
    $('#r-sub').textContent = sub;

    const weakN = set ? set.sentences.filter((x) => !x.mastered).length : 0;
    const weakBtn = $('#r-weak');
    weakBtn.hidden = !(set && weakN > 0 && weakN < set.sentences.length);
    weakBtn.textContent = `못 외운 ${weakN}문장만 다시`;
  }

  $('#r-again').addEventListener('click', () => {
    if (lastSetId && lastOpts) startPractice(lastSetId, lastOpts);
  });
  $('#r-weak').addEventListener('click', () => {
    if (lastSetId && lastOpts) startPractice(lastSetId, { ...lastOpts, scope: 'unmastered' });
  });

  // ───────── 시작 ─────────
  renderHome();
  show('home');
  checkSharedLink();
})();
