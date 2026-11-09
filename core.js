// 심캘 핵심 로직 (DOM 비의존). 브라우저에서는 window.SC, Node 테스트에서는 module.exports로 사용한다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const BG_COLORS = ['', 'yellow', 'blue', 'gray', 'green', 'pink'];
  const MEMO_COLORS = ['', 'red', 'blue'];
  const FREQS = ['weekly', 'monthly', 'yearly'];
  const FREQ_LABELS = { weekly: '매주', monthly: '매월', yearly: '매년' };
  const MEMO_MAX = 100; // 줄바꿈 포함 전체 글자 수
  const MEMO_LINES_MAX = 5; // 한 줄이 메모 하나

  const KEYS = {
    profiles: 'sc:v2:profiles',
    dataPrefix: 'sc:v2:data:',
    theme: 'sc:theme',
    notify: 'sc:notify',
    holidayPrefix: 'sc:holidays:',
  };

  // ---------- 날짜 ----------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // month0: 0~11. 범위를 벗어나도 Date가 정규화한다.
  function toKey(year, month0, day) {
    const d = new Date(year, month0, day);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function dateToKey(date) {
    return toKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { year: y, month0: m - 1, day: d, weekDay: new Date(y, m - 1, d).getDay() };
  }

  function addDays(key, n) {
    const p = parseKey(key);
    return toKey(p.year, p.month0, p.day + n);
  }

  function formatKeyLong(key) {
    const p = parseKey(key);
    return `${p.year}년 ${p.month0 + 1}월 ${p.day}일 (${WEEKDAYS[p.weekDay]})`;
  }

  // 항상 6주(42칸) 고정 그리드. 앞뒤 달 날짜도 정확한 키를 가진다.
  function buildMonthGrid(year, month0) {
    const firstWeekDay = new Date(year, month0, 1).getDay();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month0, 1 - firstWeekDay + i);
      cells.push({
        key: dateToKey(d),
        day: d.getDate(),
        weekDay: i % 7,
        inMonth: d.getMonth() === ((month0 % 12) + 12) % 12,
      });
    }
    return cells;
  }

  function gridYears(cells) {
    return [...new Set([cells[0].key, cells[cells.length - 1].key].map((k) => Number(k.slice(0, 4))))];
  }

  // ---------- 공휴일 ----------

  function parseHolidayResponse(json) {
    const raw = json && json.response && json.response.body && json.response.body.items
      ? json.response.body.items.item
      : null;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const map = {};
    for (const it of items) {
      if (!it || it.isHoliday !== 'Y') continue;
      const s = String(it.locdate);
      if (s.length !== 8) continue;
      const key = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      // 같은 날 공휴일이 겹치면 이어 붙인다 (예: 어린이날 + 부처님오신날)
      map[key] = map[key] ? `${map[key]}·${it.dateName}` : it.dateName;
    }
    return map;
  }

  function shortHolidayName(name) {
    if (!name) return '';
    if (name.includes('임시공휴일')) return '임시공휴일';
    if (name.includes('대체공휴일')) return '대체공휴일';
    return name;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;

  // 이미 지난 해는 해가 바뀐 뒤 받은 데이터라면 영구 사용, 그 외는 하루마다 갱신 (임시공휴일이 갑자기 지정되는 경우 대비).
  function isHolidayCacheFresh(cache, year, now) {
    if (!cache || typeof cache.fetchedAt !== 'number' || !cache.map) return false;
    const nowMs = now instanceof Date ? now.getTime() : now;
    const fetchedYear = new Date(cache.fetchedAt).getFullYear();
    if (fetchedYear > year) return true;
    return nowMs - cache.fetchedAt < DAY_MS;
  }

  // ---------- 일정 ----------

  // 여러 메모는 줄바꿈으로 구분한다. 줄마다 앞뒤 공백을 떼고 빈 줄은 버린다.
  function memoLines(memo) {
    if (typeof memo !== 'string') return [];
    return memo.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  }

  function normalizeMemo(memo) {
    return memoLines(memo).slice(0, MEMO_LINES_MAX).join('\n').slice(0, MEMO_MAX).trim();
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const memo = normalizeMemo(e.memo);
    const color = BG_COLORS.includes(e.color) ? e.color : '';
    // 구버전은 글자색 기본값을 'black'으로 저장했다.
    const memoColor = MEMO_COLORS.includes(e.memoColor) ? e.memoColor : '';
    return { memo, color, memoColor };
  }

  function isEmptyEntry(e) {
    return !e || (!e.memo && !e.color);
  }

  function ruleMatches(rule, key) {
    if (!rule || key < rule.start) return false;
    const s = parseKey(rule.start);
    const k = parseKey(key);
    switch (rule.freq) {
      case 'weekly':
        return s.weekDay === k.weekDay;
      case 'monthly':
        return s.day === k.day; // 31일 규칙은 31일이 없는 달에는 건너뛴다
      case 'yearly':
        return s.month0 === k.month0 && s.day === k.day; // 2/29는 윤년에만
      default:
        return false;
    }
  }

  // 날짜별 일정이 반복 일정보다 우선한다 (해당 날짜만 예외 수정).
  function resolveEntry(data, key) {
    const entry = data.entries[key];
    if (entry && !isEmptyEntry(entry)) return { ...entry, source: 'entry' };
    const rule = data.rules.find((r) => ruleMatches(r, key));
    if (rule) {
      return { memo: rule.memo, color: rule.color, memoColor: rule.memoColor, source: 'rule', rule };
    }
    return null;
  }

  function emptyData() {
    return { entries: {}, rules: [] };
  }

  // 형식뿐 아니라 실제 존재하는 날짜인지 왕복 검증 (2026-02-31 같은 값 거부)
  function isValidKey(k) {
    if (typeof k !== 'string' || !DATE_KEY_RE.test(k)) return false;
    const p = parseKey(k);
    return toKey(p.year, p.month0, p.day) === k;
  }

  function normalizeData(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object') return data;
    if (raw.entries && typeof raw.entries === 'object') {
      for (const [k, v] of Object.entries(raw.entries)) {
        const e = normalizeEntry(v);
        if (isValidKey(k) && !isEmptyEntry(e)) data.entries[k] = e;
      }
    }
    if (Array.isArray(raw.rules)) {
      for (const r of raw.rules) {
        if (!r || !FREQS.includes(r.freq) || !isValidKey(r.start)) continue;
        const e = normalizeEntry(r);
        if (isEmptyEntry(e)) continue;
        data.rules.push({ id: String(r.id || uid()), freq: r.freq, start: r.start, ...e });
      }
    }
    return data;
  }

  // fromKey부터 days일 동안의 일정 목록
  function upcoming(data, fromKey, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const key = addDays(fromKey, i);
      const r = resolveEntry(data, key);
      if (r && r.memo) out.push({ key, offset: i, memo: r.memo });
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let uidCounter = 0;
  function uid() {
    uidCounter = (uidCounter + 1) % 1e6;
    return Date.now().toString(36) + uidCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- 저장소 (localStorage 인터페이스를 주입받는다) ----------

  function readJson(storage, key, fallback) {
    try {
      const v = storage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  // 프로필 목록 정리: 잘못된 항목 제거, id 중복은 첫 항목만 유지
  function cleanProfileList(arr) {
    const seen = new Set();
    const list = [];
    for (const x of arr) {
      if (!x || !x.id) continue;
      const id = String(x.id);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, name: String(x.name || '이름 없음') });
    }
    return list;
  }

  function createStore(storage) {
    function loadProfiles() {
      const p = readJson(storage, KEYS.profiles, null);
      if (!p || !Array.isArray(p.list) || p.list.length === 0) return null;
      const list = cleanProfileList(p.list);
      if (list.length === 0) return null;
      const active = list.some((x) => x.id === p.active) ? p.active : list[0].id;
      return { active, list };
    }

    function saveProfiles(p) {
      storage.setItem(KEYS.profiles, JSON.stringify(p));
    }

    function loadData(id) {
      return normalizeData(readJson(storage, KEYS.dataPrefix + id, null));
    }

    function saveData(id, data) {
      storage.setItem(KEYS.dataPrefix + id, JSON.stringify(data));
    }

    function removeData(id) {
      storage.removeItem(KEYS.dataPrefix + id);
    }

    // v1(날짜 키를 localStorage에 바로 저장) → v2(프로필별 묶음) 이전. 이미 v2면 그대로 둔다.
    function init() {
      const existing = loadProfiles();
      if (existing) return existing;

      // 인덱스만 깨지고 v2 데이터 키가 남아 있으면 덮어쓰지 말고 키로 목록을 복구한다.
      const ids = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(KEYS.dataPrefix)) ids.push(k.slice(KEYS.dataPrefix.length));
      }
      if (ids.length > 0) {
        ids.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : 0));
        const list = ids.map((id, i) => ({ id, name: id === 'default' ? '기본' : `프로필 ${i + 1}` }));
        const rebuilt = { active: list[0].id, list };
        saveProfiles(rebuilt);
        return rebuilt;
      }

      const data = emptyData();
      const legacyKeys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (DATE_KEY_RE.test(k)) legacyKeys.push(k);
      }
      for (const k of legacyKeys) {
        const e = normalizeEntry(readJson(storage, k, null));
        if (!isEmptyEntry(e)) data.entries[k] = e;
      }

      const profiles = { active: 'default', list: [{ id: 'default', name: '기본' }] };
      saveData('default', data);
      saveProfiles(profiles);
      // 새 형식 저장이 끝난 뒤에만 구버전 키를 지운다.
      for (const k of legacyKeys) storage.removeItem(k);
      return profiles;
    }

    function exportAll() {
      const profiles = loadProfiles() || { active: '', list: [] };
      const data = {};
      for (const p of profiles.list) data[p.id] = loadData(p.id);
      return { app: 'simple-calendar', version: 2, exportedAt: new Date().toISOString(), profiles, data };
    }

    // 백업으로 전체를 교체한다. 잘못된 형식이면 예외를 던지고 기존 데이터는 건드리지 않는다.
    function importAll(text) {
      let obj;
      try {
        obj = typeof text === 'string' ? JSON.parse(text) : text;
      } catch (e) {
        throw new Error('JSON 형식이 아닙니다.');
      }
      if (!obj || obj.app !== 'simple-calendar' || !obj.profiles || !Array.isArray(obj.profiles.list)) {
        throw new Error('심캘 백업 파일이 아닙니다.');
      }
      const list = cleanProfileList(obj.profiles.list);
      if (list.length === 0) throw new Error('프로필이 없습니다.');
      const active = list.some((x) => x.id === obj.profiles.active) ? obj.profiles.active : list[0].id;

      const old = loadProfiles();
      // 새 데이터 → 인덱스 → 고아 삭제 순서 (중간에 실패해도 기존 인덱스가 가리키는 데이터는 남는다)
      for (const p of list) saveData(p.id, normalizeData(obj.data && obj.data[p.id]));
      const profiles = { active, list };
      saveProfiles(profiles);
      if (old) {
        for (const p of old.list) if (!list.some((x) => x.id === p.id)) removeData(p.id);
      }
      return profiles;
    }

    return { init, loadProfiles, saveProfiles, loadData, saveData, removeData, exportAll, importAll };
  }

  return {
    KEYS, WEEKDAYS, BG_COLORS, MEMO_COLORS, FREQS, FREQ_LABELS, MEMO_MAX, MEMO_LINES_MAX,
    pad2, toKey, dateToKey, parseKey, addDays, formatKeyLong, buildMonthGrid, gridYears,
    parseHolidayResponse, shortHolidayName, isHolidayCacheFresh,
    memoLines, normalizeMemo, normalizeEntry, isEmptyEntry, ruleMatches, resolveEntry, emptyData, isValidKey, normalizeData, upcoming,
    escapeHtml, uid, readJson, createStore,
  };
});
