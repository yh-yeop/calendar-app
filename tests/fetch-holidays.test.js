const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServiceKey, toFileContent } = require('../scripts/fetch-holidays.js');

test('normalizeServiceKey: Encoding 키는 그대로, Decoding 키는 인코딩', () => {
  assert.equal(normalizeServiceKey('ab%2Fcd%3D%3D'), 'ab%2Fcd%3D%3D');
  assert.equal(normalizeServiceKey(' ab/cd+== \n'), 'ab%2Fcd%2B%3D%3D');
});

test('toFileContent: 날짜 순 정렬, 같은 내용이면 같은 문자열', () => {
  const a = toFileContent(2026, { '2026-03-01': '삼일절', '2026-01-01': '1월1일' });
  const b = toFileContent(2026, { '2026-01-01': '1월1일', '2026-03-01': '삼일절' });
  assert.equal(a, b);
  assert.deepEqual(Object.keys(JSON.parse(a).holidays), ['2026-01-01', '2026-03-01']);
  assert.equal(JSON.parse(a).year, 2026);
});
