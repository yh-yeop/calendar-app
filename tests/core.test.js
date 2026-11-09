const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../core.js');

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

test('toKey는 월 경계를 넘어도 정규화한다', () => {
  assert.equal(SC.toKey(2026, 0, 0), '2025-12-31');
  assert.equal(SC.toKey(2026, 11, 32), '2027-01-01');
  assert.equal(SC.addDays('2026-02-28', 1), '2026-03-01');
});

test('buildMonthGrid: 42칸, 앞뒤 달 키가 정확하다 (1월/12월 경계)', () => {
  const jan = SC.buildMonthGrid(2026, 0); // 2026-01-01은 목요일
  assert.equal(jan.length, 42);
  assert.equal(jan[0].key, '2025-12-28');
  assert.equal(jan[0].inMonth, false);
  assert.equal(jan[4].key, '2026-01-01');
  assert.equal(jan[4].inMonth, true);
  assert.deepEqual(SC.gridYears(jan), [2025, 2026]);

  const dec = SC.buildMonthGrid(2026, 11);
  assert.equal(dec[41].key, '2027-01-09');
  assert.equal(dec[41].inMonth, false);
  assert.ok(dec.every((c, i) => c.weekDay === i % 7));
});

test('parseHolidayResponse: 배열/단일/빈 응답, 겹치는 공휴일', () => {
  const arr = {
    response: { body: { items: { item: [
      { isHoliday: 'Y', locdate: 20260505, dateName: '어린이날' },
      { isHoliday: 'Y', locdate: 20260505, dateName: '부처님오신날' },
      { isHoliday: 'N', locdate: 20260508, dateName: '어버이날' },
    ] } } },
  };
  assert.deepEqual(SC.parseHolidayResponse(arr), { '2026-05-05': '어린이날·부처님오신날' });

  const single = { response: { body: { items: { item: { isHoliday: 'Y', locdate: 20261009, dateName: '한글날' } } } } };
  assert.deepEqual(SC.parseHolidayResponse(single), { '2026-10-09': '한글날' });

  assert.deepEqual(SC.parseHolidayResponse({ response: { body: { items: '' } } }), {});
  assert.deepEqual(SC.parseHolidayResponse(null), {});
});

test('shortHolidayName', () => {
  assert.equal(SC.shortHolidayName('대체공휴일(삼일절)'), '대체공휴일');
  assert.equal(SC.shortHolidayName('임시공휴일(국군의 날)'), '임시공휴일');
  assert.equal(SC.shortHolidayName('추석'), '추석');
  assert.equal(SC.shortHolidayName(undefined), '');
});

test('isHolidayCacheFresh', () => {
  const now = new Date(2026, 10, 2).getTime();
  assert.equal(SC.isHolidayCacheFresh({ fetchedAt: now - 1000, map: {} }, 2026, now), true);
  assert.equal(SC.isHolidayCacheFresh({ fetchedAt: now - 2 * 864e5, map: {} }, 2026, now), false);
  // 지난 해 데이터를 해가 바뀐 뒤 받았다면 영구 사용
  assert.equal(SC.isHolidayCacheFresh({ fetchedAt: new Date(2026, 0, 5).getTime(), map: {} }, 2025, now), true);
  assert.equal(SC.isHolidayCacheFresh(null, 2026, now), false);
  // 하루 경계: 정확히 하루 지난 캐시는 신선하지 않다
  assert.equal(SC.isHolidayCacheFresh({ fetchedAt: now - 864e5, map: {} }, 2026, now), false);
  assert.equal(SC.isHolidayCacheFresh({ fetchedAt: now - 864e5 + 1, map: {} }, 2026, now), true);
});

test('ruleMatches: 매주/매월/매년, 시작일 이전 제외', () => {
  const weekly = { freq: 'weekly', start: '2026-11-02' }; // 월요일
  assert.equal(SC.ruleMatches(weekly, '2026-11-09'), true);
  assert.equal(SC.ruleMatches(weekly, '2026-11-10'), false);
  assert.equal(SC.ruleMatches(weekly, '2026-10-26'), false);

  const monthly = { freq: 'monthly', start: '2026-01-31' };
  assert.equal(SC.ruleMatches(monthly, '2026-03-31'), true);
  assert.equal(SC.ruleMatches(monthly, '2026-02-28'), false);

  const yearly = { freq: 'yearly', start: '2024-02-29' };
  assert.equal(SC.ruleMatches(yearly, '2028-02-29'), true);
  assert.equal(SC.ruleMatches(yearly, '2027-02-28'), false);
});

test('resolveEntry: 날짜별 일정이 반복 일정보다 우선', () => {
  const data = {
    entries: { '2026-11-09': { memo: '휴가', color: 'yellow', memoColor: '' } },
    rules: [{ id: 'r', freq: 'weekly', start: '2026-11-02', memo: '회의', color: '', memoColor: 'red' }],
  };
  assert.equal(SC.resolveEntry(data, '2026-11-09').memo, '휴가');
  const r = SC.resolveEntry(data, '2026-11-16');
  assert.equal(r.memo, '회의');
  assert.equal(r.source, 'rule');
  assert.equal(SC.resolveEntry(data, '2026-11-17'), null);
});

test('upcoming', () => {
  const data = { entries: { '2026-11-03': { memo: '병원', color: '', memoColor: '' } }, rules: [] };
  assert.deepEqual(SC.upcoming(data, '2026-11-02', 2), [{ key: '2026-11-03', offset: 1, memo: '병원' }]);
});

test('normalizeMemo: 줄바꿈으로 여러 메모, 빈 줄·공백 정리, 개수·메모별 글자 수 제한', () => {
  assert.equal(SC.normalizeMemo(' 회의 \r\n\n  점심 약속\n'), '회의\n점심 약속');
  assert.equal(SC.normalizeMemo('a\nb\nc\nd\ne\nf'), 'a\nb\nc\nd\ne');
  assert.equal(SC.normalizeMemo('x'.repeat(200)).length, SC.MEMO_MAX);
  assert.equal(SC.normalizeMemo(`${'a'.repeat(60)}\n${'b'.repeat(60)}`), `${'a'.repeat(SC.MEMO_MAX)}\n${'b'.repeat(SC.MEMO_MAX)}`);
  assert.equal(SC.normalizeMemo(null), '');
  assert.deepEqual(SC.memoLines('회의\n점심'), ['회의', '점심']);
  assert.equal(SC.normalizeEntry({ memo: '가\n\n나' }).memo, '가\n나');
});

test('normalizeEntry: 구버전 black 글자색, 잘못된 값 정리', () => {
  assert.deepEqual(SC.normalizeEntry({ memo: ' a ', color: 'yellow', memoColor: 'black' }), { memo: 'a', color: 'yellow', memoColor: '' });
  assert.deepEqual(SC.normalizeEntry({ memo: 1, color: 'x', memoColor: 'y' }), { memo: '', color: '', memoColor: '' });
});

test('escapeHtml', () => {
  assert.equal(SC.escapeHtml('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('store.init: v1 날짜 키를 기본 프로필로 이전하고 구버전 키를 지운다', () => {
  const s = memoryStorage({
    '2026-11-02': JSON.stringify({ memo: '회의', color: 'blue', memoColor: 'black' }),
    '2026-11-03': JSON.stringify({ memo: '', color: '', memoColor: 'black' }),
    other: 'keep',
  });
  const store = SC.createStore(s);
  const profiles = store.init();
  assert.equal(profiles.list.length, 1);
  assert.deepEqual(store.loadData(profiles.active).entries, {
    '2026-11-02': { memo: '회의', color: 'blue', memoColor: '' },
  });
  assert.equal(s.getItem('2026-11-02'), null);
  assert.equal(s.getItem('other'), 'keep');

  // 두 번째 init은 아무것도 바꾸지 않는다
  assert.deepEqual(store.init(), profiles);
});

test('store export/import 왕복, 잘못된 백업은 거부하고 기존 데이터 유지', () => {
  const s = memoryStorage();
  const store = SC.createStore(s);
  const p = store.init();
  store.saveData(p.active, {
    entries: { '2026-11-02': { memo: 'x', color: '', memoColor: '' } },
    rules: [{ id: 'r1', freq: 'yearly', start: '2026-03-01', memo: '생일', color: 'pink', memoColor: '' }],
  });
  const backup = JSON.stringify(store.exportAll());

  const s2 = memoryStorage({ 'sc:v2:data:gone': '{}', 'sc:v2:profiles': JSON.stringify({ active: 'gone', list: [{ id: 'gone', name: 'x' }] }) });
  const store2 = SC.createStore(s2);
  assert.throws(() => store2.importAll('{"app":"other"}'), /백업/);
  assert.throws(() => store2.importAll('not json'), /JSON/);
  assert.equal(store2.loadProfiles().active, 'gone');

  const imported = store2.importAll(backup);
  assert.equal(imported.active, 'default');
  assert.equal(store2.loadData('default').rules[0].memo, '생일');
  assert.equal(s2.getItem('sc:v2:data:gone'), null);
});

test('store.init: 프로필 인덱스가 깨져도 기존 v2 데이터를 보존하고 목록을 복구한다', () => {
  const dataDefault = JSON.stringify({ entries: { '2026-11-02': { memo: '보존', color: '', memoColor: '' } }, rules: [] });
  const dataOther = JSON.stringify({ entries: { '2026-11-03': { memo: '다른', color: '', memoColor: '' } }, rules: [] });
  for (const broken of [null, 'not json', '{"active":"x","list":[]}']) {
    const init = { 'sc:v2:data:abc': dataOther, 'sc:v2:data:default': dataDefault, '2026-11-05': JSON.stringify({ memo: 'v1', color: 'blue' }) };
    if (broken !== null) init['sc:v2:profiles'] = broken;
    const s = memoryStorage(init);
    const store = SC.createStore(s);
    const profiles = store.init();
    assert.deepEqual(profiles.list, [{ id: 'default', name: '기본' }, { id: 'abc', name: '프로필 2' }]);
    assert.equal(profiles.active, 'default');
    assert.equal(s.getItem('sc:v2:data:default'), dataDefault);
    assert.equal(s.getItem('sc:v2:data:abc'), dataOther);
    assert.notEqual(s.getItem('2026-11-05'), null); // v1 이전을 돌리지 않았다
    assert.deepEqual(store.loadProfiles(), profiles); // 인덱스가 저장됐다
  }
});

test('store.exportAll: 프로필 인덱스가 없어도 예외 없이 빈 구조를 내보낸다', () => {
  const store = SC.createStore(memoryStorage());
  const out = store.exportAll();
  assert.equal(out.app, 'simple-calendar');
  assert.deepEqual(out.profiles, { active: '', list: [] });
  assert.deepEqual(out.data, {});
});

test('프로필 id 중복은 첫 항목만 유지한다 (loadProfiles, importAll)', () => {
  const s = memoryStorage({ 'sc:v2:profiles': JSON.stringify({ active: 'a', list: [{ id: 'a', name: '첫째' }, { id: 'a', name: '둘째' }, { id: 'b', name: '셋째' }] }) });
  const store = SC.createStore(s);
  assert.deepEqual(store.loadProfiles().list, [{ id: 'a', name: '첫째' }, { id: 'b', name: '셋째' }]);

  const imported = store.importAll({
    app: 'simple-calendar',
    profiles: { active: 'x', list: [{ id: 'x', name: 'X1' }, { id: 'x', name: 'X2' }, { id: 'y', name: 'Y' }] },
    data: { x: { entries: { '2026-11-02': { memo: 'm', color: '', memoColor: '' } } } },
  });
  assert.deepEqual(imported.list, [{ id: 'x', name: 'X1' }, { id: 'y', name: 'Y' }]);
  assert.equal(imported.active, 'x');
  assert.equal(s.getItem('sc:v2:data:a'), null); // 고아 데이터 삭제
  assert.equal(store.loadData('x').entries['2026-11-02'].memo, 'm');
});

test('normalizeData: 존재하지 않는 날짜 키는 버린다', () => {
  const e = { memo: 'm', color: '', memoColor: '' };
  const d = SC.normalizeData({
    entries: { '2026-02-31': e, '2026-13-01': e, '2026-00-10': e, '2026-02-28': e, '2028-02-29': e, '2027-02-29': e },
    rules: [
      { freq: 'yearly', start: '2026-02-31', memo: 'x' },
      { freq: 'weekly', start: '2026-04-31', memo: 'x' },
      { freq: 'weekly', start: '2026-04-30', memo: 'ok' },
    ],
  });
  assert.deepEqual(Object.keys(d.entries).sort(), ['2026-02-28', '2028-02-29']);
  assert.deepEqual(d.rules.map((r) => r.memo), ['ok']);
  assert.equal(SC.isValidKey('2026-02-31'), false);
  assert.equal(SC.isValidKey('2026-12-31'), true);
});
