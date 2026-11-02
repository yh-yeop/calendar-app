#!/usr/bin/env node
// 공공데이터포털 특일 정보 API에서 공휴일을 받아 holidays/<연도>.json으로 저장한다.
// 인증키는 클라이언트에 넣지 않고 이 스크립트(GitHub Actions)에서만 쓴다.
//
//   HOLIDAY_API_KEY=<인증키> node scripts/fetch-holidays.js            # 작년~내후년
//   HOLIDAY_API_KEY=<인증키> node scripts/fetch-holidays.js 2020 2028  # 범위 지정
'use strict';

const fs = require('fs');
const path = require('path');
const SC = require('../core.js');

const API_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const OUT_DIR = path.join(__dirname, '..', 'holidays');

// 포털은 Encoding 키(%2F 등 포함)와 Decoding 키를 둘 다 준다. 어느 쪽을 넣어도 동작하게 한다.
function normalizeServiceKey(key) {
  const k = String(key || '').trim();
  return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k);
}

// 키 순서를 고정해 내용이 같으면 파일도 바이트 단위로 같게 만든다 (불필요한 커밋 방지).
function toFileContent(year, map) {
  const sorted = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  return JSON.stringify({ year, holidays: sorted }, null, 2) + '\n';
}

async function fetchYear(year, serviceKey) {
  const url = `${API_URL}?serviceKey=${serviceKey}&solYear=${year}&numOfRows=100&_type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${year}: HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // 키 오류 등은 XML로 온다.
    throw new Error(`${year}: JSON이 아닌 응답 — ${text.slice(0, 200)}`);
  }
  const header = json.response && json.response.header;
  if (!header || header.resultCode !== '00') {
    throw new Error(`${year}: API 오류 ${header ? `${header.resultCode} ${header.resultMsg}` : '(헤더 없음)'}`);
  }
  return SC.parseHolidayResponse(json);
}

async function main(argv) {
  const rawKey = process.env.HOLIDAY_API_KEY;
  if (!rawKey) {
    console.error('HOLIDAY_API_KEY 환경 변수가 없습니다. (GitHub 저장소 Settings → Secrets → Actions)');
    process.exit(1);
  }
  const serviceKey = normalizeServiceKey(rawKey);

  const now = new Date().getFullYear();
  const from = Number(argv[0]) || now - 1;
  const to = Number(argv[1]) || now + 2;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let changed = 0;
  for (let year = from; year <= to; year++) {
    const map = await fetchYear(year, serviceKey);
    const file = path.join(OUT_DIR, `${year}.json`);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    // 아직 발표되지 않은 해는 빈 결과가 온다. 이미 받은 데이터를 빈 값으로 덮어쓰지 않는다.
    if (Object.keys(map).length === 0 && prev) {
      console.log(`${year}: 빈 응답 — 기존 파일 유지`);
      continue;
    }
    const next = toFileContent(year, map);
    if (next !== prev) {
      fs.writeFileSync(file, next);
      changed++;
      console.log(`${year}: ${Object.keys(map).length}일 저장`);
    } else {
      console.log(`${year}: 변경 없음`);
    }
  }
  console.log(`완료: ${changed}개 파일 변경`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { normalizeServiceKey, toFileContent };
