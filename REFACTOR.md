# REFACTOR.md — 1단계 리팩터링 (Haiku → Opus → Sonnet)

대상: `calendar-app/` (core.js, script.js, index.html, style.css, service-worker.js, manifest.json)
검증 방법: `npm test` (node --test, tests/core.test.js) + 브라우저 스모크(로컬 http.server)
환경 전제: 주 실행 환경은 안드로이드 WebView(Chromium, Play 스토어로 갱신) + 데스크톱/모바일 Chrome. WebView는 `Notification` 없음, 파일 선택/Blob 다운로드 미지원(네이티브 미구현).

## 1. Haiku 지적 (3기 병렬, 총 38건)

- **H1 (core.js, tests)**: 9건 — C1~C9
- **H2 (script.js)**: 11건 — S1~S11
- **H3 (index.html, style.css, service-worker.js, manifest.json)**: 16건(+확인 2) — W1~W16

## 2. Opus 판정

판정: ✅ 수정 대상 / ❌ 기각(오탐·대상 환경 밖·가치 낮음)

### core.js
| ID | 위치 | 지적 | 판정 | 근거 |
|---|---|---|---|---|
| C1 | init | `sc:v2:profiles`가 깨지면 v1로 오인해 `sc:v2:data:default`를 덮어쓰고 다른 프로필 데이터 고아화 | ✅ | 드물지만 데이터 유실. 남아 있는 `sc:v2:data:*` 키로 프로필 목록을 복구해야 함 |
| C2 | exportAll | init 전/저장소 불가 시 `profiles.list` null 참조 | ✅ | 저장소 불가 폴백 경로에서 내보내기 누르면 예외. 빈 목록 처리 |
| C3 | loadProfiles/importAll | 프로필 id 중복 미제거 → 두 프로필이 같은 데이터 키 공유 | ✅ | 손상/수작업 백업에서 가능. 첫 항목만 유지 |
| C4 | importAll | 기존 데이터 삭제가 프로필 인덱스 저장보다 먼저 | ✅ | 순서만 바꾸면 됨: 새 데이터 → 인덱스 → 고아 삭제 |
| C5 | parseHolidayResponse | resultCode 무시 → 오류 응답이 빈 맵으로 영구 캐시 | ❌ | 오탐. script.js `ensureHolidays`가 파싱 전에 `header.resultCode !== '00'`이면 throw |
| C6 | normalizeEntry | `slice(0,50)`이 서로게이트 쌍 분리 | ❌ | 입력은 `maxlength=50`(UTF-16 단위)으로 이미 같은 기준. 가져오기에서만 발생, 가치 낮음 |
| C7 | normalizeData | 존재하지 않는 날짜(`2026-02-31`) 통과 | ✅ | 가져오기 시 엉뚱한 날로 굴러감. toKey 왕복 검증. (규칙 id 재생성 지적은 기각: id는 저장 시 고정되고 식별은 객체 참조) |
| C8 | active 비교 | 숫자형 active | ❌ | 앱이 쓰는 id는 항상 문자열 |
| C9 | tests | 테스트 공백 | ✅ | 위 ✅ 항목(C1·C3·C4·C7)과 7일 경계에 테스트 추가 |

### script.js
| ID | 위치 | 지적 | 판정 | 근거 |
|---|---|---|---|---|
| S1 | show/ensureHolidays | 콜드 스타트 첫 렌더에 공휴일 누락(캐시를 render 뒤에 메모리로 올리고, 신선하면 재렌더 안 함) | ✅ | 실제 버그. 재현 경로 확인. render 전에 캐시를 메모리에 올려야 함 |
| S2 | 시작부 | localStorage 접근 예외 시 시작 중단(currentTheme, 테마/알림 setItem 무방비) | ✅ | 시작이 통째로 죽는 건 치명적. 접근부를 안전 래퍼로 |
| S3 | notifyUpcoming | SW 컨트롤러 없을 때 `new Notification` 폴백이 안드로이드 Chrome에서 TypeError → 알림도 배너도 없음, `last`는 이미 저장 | ✅ | 실제 버그. 실패 시 토스트로 폴백, 성공 후에 last 기록 |
| S4 | saveEditor/resetProfile | persist 실패 시 메모리 상태만 바뀐 채 남음 | ✅ | 저장 실패 시 이전 상태로 롤백 (스냅샷) |
| S5 | matchMedia.addEventListener | 구형 Safari/WebView 미지원 | ❌ | 대상 환경(Chromium 갱신형 WebView) 밖 |
| S6 | File.text() | Chrome 76+ 필요 | ❌ | 대상 환경 밖. 게다가 WebView는 파일 선택 자체가 안 됨(S9에서 처리) |
| S7 | saveEditor → notifyUpcoming | 하루 한 번 알림이 '앱 열 때'가 아니라 '첫 저장 때' 뜰 수 있음(방금 입력한 일정을 바로 알림) | ✅ | 설명 문구와 다르고 거슬림. 저장 후 호출 제거 |
| S8 | touch | touchcancel/멀티터치 시 시작점 미초기화 | ✅ | 간단. 오동작(달 넘김/클릭 삼킴) 가능 |
| S9 | 백업 | WebView에서 Blob 다운로드·파일 선택이 조용히 실패 | ✅ | 주 환경이 WebView. UA의 `; wv)`로 감지해 파일 버튼 숨김(복사/붙여넣기는 동작) |
| S10 | ensureHolidays | 실패 시 네거티브 캐시 없음 → 달 이동마다 재요청 | ✅ | 오프라인에서 요청 폭주. 실패 후 일정 시간 재시도 억제 |
| S11 | SERVICE_KEY | 키 노출 | ❌ | 서버 없이 숨길 수 없음. 원래 코드도 동일. 보고서에 언급만 |

### index.html / style.css / service-worker.js / manifest.json
| ID | 위치 | 지적 | 판정 | 근거 |
|---|---|---|---|---|
| W1 | memoInput 등 | 입력란 접근 가능한 이름 없음 | ✅ | aria-label 추가, 저비용 |
| W2 | monthTitle 클릭 | 키보드 접근 불가 | ❌ | 같은 기능의 '오늘' 버튼이 키보드로 접근 가능. 제목 클릭은 보조 단축 |
| W3 | th scope, td role=button | 표 의미 덮어씀 | ❌ | 가치 낮음 |
| W4 | `label:focus-within` | 탭한 스와치/칩에 포커스 테두리가 남음 | ✅ | 실제 시각 버그. `input:focus-visible + span`으로 |
| W5 | .btn-danger | 흰 글자 대비 부족 | ✅ | 위험 버튼 토큰 조정 |
| W6 | primary 버튼 | 흰 글자 대비 부족 | ✅ | 버튼 배경용 토큰을 약간 진하게(브랜드색 #3a86ff 계열 유지) |
| W7 | dimmed | `--text-dimmed` + td opacity 0.55 이중 흐림 | ✅ | 거의 안 보임. 이중 적용 해소 |
| W8 | 공휴일 이름 | 작은 글씨 빨강 대비 부족 | ✅ | 라이트 테마 holiday 토큰을 진하게 |
| W9 | dialog 패딩 | 패딩 영역 탭이 `target === dialog`라 바깥 클릭으로 오인해 닫힘 | ✅ | 실제 버그(입력 중 닫힘). script.js에서 좌표가 다이얼로그 사각형 밖일 때만 닫기 |
| W10 | color-mix | 폴백 없음 | ✅ | 한 줄 폴백 |
| W11 | 스와치 | 360px에서 5+1 줄바꿈 | ✅ | 폭을 유동적으로 |
| W12 | 다크 토큰 3중 복제 | 유지보수 | ❌ | 전처리기 없이 미디어쿼리+속성 둘 다 지원하려면 불가피 |
| W13 | SW addAll | HTTP 캐시로 오래된 파일을 프리캐시 | ✅ | `cache: 'reload'` |
| W14 | SW cache.put | 거부 미처리 | ✅ | catch 추가 |
| W15 | SW 오프라인 폴백 | 스크립트/스타일 요청에도 index.html 반환 | ✅ | 내비게이션 요청에만 폴백 |
| W16 | manifest 아이콘 | 192 항목이 실제 512 | ❌ | 설치 조건(192·512) 충족용으로 필요, 브라우저가 축소. 무해 |

**판정 요약**: 지적 36건(+확인 2) → 수정 대상 26건, 기각 10건

## 3. 비판적 Sonnet 반론 (판정당 1회)

| ID | 반론 | Opus 최종 결정 |
|---|---|---|
| W9 | 좌표 검사만으론 textarea 드래그 선택을 backdrop에서 놓을 때 닫힘이 남음 → mousedown target도 dlg일 때만 | **수용**: pointerdown 시작 지점이 dlg 자신이고 사각형 밖일 때만 닫기 |
| S3 | `last`를 비동기 성공 뒤로 미루면 중복 알림 | **수용**: `last`는 동기로 먼저 기록, 시스템 알림 실패 시 토스트로 폴백(되돌리지 않고 같은 호출 안에서 배너로 대체) |
| C1 | 키 스캔으로 이름 복구는 과잉, 핵심은 default 덮어쓰기 방지 | **수용**: 기존 `sc:v2:data:*`가 있으면 덮어쓰지 않고 그 키들로 목록만 재구성(이름은 '프로필 N', default는 '기본') |
| S9 | UA 감지는 틀릴 수 있음 → 틀려도 무해하게 | **수용**: 붙여넣기/복사를 기본 경로로 두고, 파일 버튼은 감지 시 숨김. 감지 실패해도 기존 동작과 동일 |
| W14 | catch만으론 부족, put이 waitUntil 밖 | **수용**: `event.waitUntil`로 감싸고 catch |

동의: 나머지 31건.

## 4. 최종 수정 목록 → Sonnet 3기 (파일 겹침 없음)

- **F1 core.js + tests/core.test.js**: C1(반론 반영), C2, C3, C4, C7, C9
- **F2 script.js**: S1, S2, S3(반론 반영), S4, S7, S8, S9(반론 반영), S10, W9(반론 반영)
- **F3 index.html + style.css + service-worker.js**: W1, W4, W5, W6, W7, W8, W10, W11, W13, W14(반론 반영), W15

## 5. 수정 결과

| 담당 | 수정 | 비고 |
|---|---|---|
| F1 core.js/tests | C1, C2, C3, C4, C7, C9 (6) | `isValidKey`, `cleanProfileList` 추가. 테스트 12 → 16건 |
| F2 script.js | S1, S2, S3, S4, S7, S8, S9, S10, W9 (9) | `primeHolidayCache`, 안전 storage 래퍼, `rollbackData`, 실패 60초 재시도 억제 |
| F3 html/css/sw | W1, W4, W5, W6, W7, W8, W10, W11, W13, W14, W15 (11) | `--primary-strong #2563d6`, `--danger-strong #c62f34`, 라이트 `--holiday/--sun #c62828`, CACHE v3 |

재시도 0회, 2단계 승격 조건(연속 실패·다중 모듈 설계 판단) 해당 없음.

### Opus 샘플링 (1단계 4번)
- core.js 변경분(init/exportAll/importAll/isValidKey) 직접 검토: 이상 없음.
- script.js notifyUpcoming/show/holiday 경로 검토: 이상 없음. 추가 지적 없음.

### 검증
- `npm test`: 16/16 통과
- 브라우저 스모크(360px, 라이트): 캐시 공휴일 첫 렌더 표시(S1), 다이얼로그 패딩 탭 시 유지·바깥 탭 시 닫힘(W9), 스와치 한 줄(W11), 매월 반복 저장·다음 달 표시, 내보내기→초기화→가져오기 왕복, history 상태 누수 없음, 콘솔 오류 없음
- 안드로이드 `:app:compileDebugKotlin` 통과 (MainActivity 뒤로가기 처리)
