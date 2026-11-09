(function () {
  'use strict';

  const SC = window.SC;
  const $ = (id) => document.getElementById(id);

  // 공휴일은 GitHub Actions가 API에서 받아 커밋한 정적 파일을 읽는다 (인증키를 클라이언트에 두지 않기 위해).
  const HOLIDAY_DIR = 'holidays/';

  // localStorage 접근 자체가 예외를 던지는 환경(사생활 보호 모드 등)에서는 메모리 저장소로 대체한다.
  function memoryStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      key: (i) => Array.from(m.keys())[i] ?? null,
      get length() { return m.size; },
    };
  }

  let storageOk = true;
  const storage = (() => {
    try {
      const ls = window.localStorage;
      ls.getItem(SC.KEYS.theme); // 접근 가능 여부 확인
      return ls;
    } catch (e) {
      storageOk = false;
      return memoryStorage();
    }
  })();

  const store = SC.createStore(storage);

  const state = {
    year: 0,
    month0: 0,
    profiles: null,
    data: null,
    editKey: '',
    editRule: null,
  };

  // ---------- 요소 ----------

  const els = {
    calendarBody: $('calendarBody'),
    monthTitle: $('monthTitle'),
    todayBtn: $('todayBtn'),
    profileBar: $('profileBar'),
    toast: $('toast'),

    editDialog: $('editDialog'),
    editForm: $('editForm'),
    editTitle: $('editTitle'),
    editHoliday: $('editHoliday'),
    memoInput: $('memoInput'),
    memoCount: $('memoCount'),
    ruleHint: $('ruleHint'),
    deleteBtn: $('deleteBtn'),

    menuDialog: $('menuDialog'),
    menuProfileName: $('menuProfileName'),
    deleteProfileBtn: $('deleteProfileBtn'),
    notifyToggle: $('notifyToggle'),
    notifyStatus: $('notifyStatus'),

    backupDialog: $('backupDialog'),
    backupTitle: $('backupTitle'),
    backupHint: $('backupHint'),
    backupText: $('backupText'),
    backupFile: $('backupFile'),
    backupFileBtn: $('backupFileBtn'),
    backupActionBtn: $('backupActionBtn'),

    confirmDialog: $('confirmDialog'),
    confirmText: $('confirmText'),
    confirmYes: $('confirmYes'),

    promptDialog: $('promptDialog'),
    promptForm: $('promptForm'),
    promptTitle: $('promptTitle'),
    promptInput: $('promptInput'),
  };

  // ---------- 다이얼로그 (안드로이드 뒤로가기로 닫히도록 history 연동) ----------

  let activeDialog = null;
  let pendingBack = 0;

  function openDialog(dlg) {
    if (activeDialog === dlg) return;
    if (activeDialog) {
      // 다이얼로그 간 전환은 history 항목을 그대로 재사용한다.
      activeDialog.close();
    } else {
      history.pushState({ scModal: true }, '');
    }
    activeDialog = dlg;
    dlg.showModal();
  }

  function closeDialog() {
    if (!activeDialog) return;
    activeDialog.close();
    activeDialog = null;
    if (history.state && history.state.scModal) {
      pendingBack++;
      history.back();
    }
  }

  window.addEventListener('popstate', () => {
    if (pendingBack > 0) {
      pendingBack--;
      return;
    }
    if (activeDialog) {
      activeDialog.close();
      activeDialog = null;
    }
  });

  function isOutsideRect(dlg, e) {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  for (const dlg of document.querySelectorAll('dialog')) {
    // Esc
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
    });
    // 바깥(backdrop) 클릭: 누른 곳과 뗀 곳이 모두 다이얼로그 사각형 밖일 때만 닫는다.
    let downOutside = false;
    dlg.addEventListener('pointerdown', (e) => {
      downOutside = e.target === dlg && isOutsideRect(dlg, e);
    });
    dlg.addEventListener('click', (e) => {
      const close = downOutside && e.target === dlg && isOutsideRect(dlg, e);
      downOutside = false;
      if (close) closeDialog();
    });
    for (const btn of dlg.querySelectorAll('[data-close]')) btn.addEventListener('click', closeDialog);
  }

  function confirmAction(text, yesLabel, onYes) {
    els.confirmText.textContent = text;
    els.confirmYes.textContent = yesLabel;
    els.confirmYes.onclick = () => {
      closeDialog();
      onYes();
    };
    openDialog(els.confirmDialog);
    $('confirmNo').focus();
  }

  function promptText(title, initial, onOk) {
    els.promptTitle.textContent = title;
    els.promptInput.value = initial;
    els.promptForm.onsubmit = (e) => {
      e.preventDefault();
      const v = els.promptInput.value.trim();
      if (!v) {
        els.promptInput.focus();
        return;
      }
      closeDialog();
      onOk(v);
    };
    openDialog(els.promptDialog);
    els.promptInput.select();
  }
  $('promptCancel').addEventListener('click', closeDialog);
  $('confirmNo').addEventListener('click', closeDialog);

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  // ---------- 공휴일 (연 단위 1회 호출 + localStorage 캐시) ----------

  const holidays = new Map(); // year -> { 'YYYY-MM-DD': name }
  const inflight = new Map(); // year -> Promise

  const failedAt = new Map(); // year -> 마지막 실패 시각 (네거티브 캐시)
  const RETRY_MS = 60 * 1000;

  function loadHolidayCache(year) {
    try {
      return SC.readJson(storage, SC.KEYS.holidayPrefix + year, null);
    } catch (e) {
      return null;
    }
  }

  // 동기: 저장된 캐시를 메모리로 올린다. render 전에 호출해 첫 렌더에 공휴일이 보이게 한다.
  function primeHolidayCache(year) {
    if (holidays.has(year)) return;
    const cache = loadHolidayCache(year);
    if (cache && cache.map) holidays.set(year, cache.map);
  }

  // 네트워크 갱신만 담당한다.
  function ensureHolidays(year) {
    if (inflight.has(year)) return inflight.get(year);

    primeHolidayCache(year);
    if (SC.isHolidayCacheFresh(loadHolidayCache(year), year, Date.now())) return Promise.resolve(false);
    if (failedAt.has(year) && Date.now() - failedAt.get(year) < RETRY_MS) return Promise.resolve(false);

    const p = fetch(`${HOLIDAY_DIR}${year}.json`)
      .then((res) => {
        // 파일이 없는 해(수집 범위 밖)는 공휴일 없음으로 본다.
        if (res.status === 404) return { holidays: {} };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const map = (json && json.holidays && typeof json.holidays === 'object') ? json.holidays : {};
        const before = JSON.stringify(holidays.get(year) || null);
        holidays.set(year, map);
        failedAt.delete(year);
        try {
          storage.setItem(SC.KEYS.holidayPrefix + year, JSON.stringify({ fetchedAt: Date.now(), map }));
        } catch (e) { /* 용량 초과 등은 무시: 메모리 캐시로 동작 */ }
        return before !== JSON.stringify(map);
      })
      .catch((e) => {
        console.warn('공휴일 정보를 불러오지 못했습니다:', e);
        failedAt.set(year, Date.now());
        return false;
      })
      .finally(() => inflight.delete(year));
    inflight.set(year, p);
    return p;
  }

  function holidayName(key) {
    const m = holidays.get(Number(key.slice(0, 4)));
    return (m && m[key]) || '';
  }

  // ---------- 달력 ----------

  function render() {
    const { year, month0, data } = state;
    const cells = SC.buildMonthGrid(year, month0);
    const todayKey = SC.dateToKey(new Date());

    els.monthTitle.textContent = `${year}년 ${month0 + 1}월`;

    let html = '';
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (i % 7 === 0) html += '<tr>';

      const holiday = holidayName(c.key);
      const entry = SC.resolveEntry(data, c.key);

      const tdClass = ['day'];
      if (!c.inMonth) tdClass.push('dimmed');
      if (entry && entry.color) tdClass.push('bg-' + entry.color);

      const dateClass = ['date'];
      if (holiday) dateClass.push('holiday');
      else if (c.weekDay === 0) dateClass.push('sun');
      else if (c.weekDay === 6) dateClass.push('sat');
      if (c.key === todayKey) dateClass.push('today');

      const lines = entry ? SC.memoLines(entry.memo) : [];
      const label = SC.formatKeyLong(c.key) + (holiday ? `, ${holiday}` : '') + (lines.length ? `, ${lines.join(', ')}` : '');

      html += `<td class="${tdClass.join(' ')}" data-key="${c.key}" tabindex="0" role="button" aria-label="${SC.escapeHtml(label)}">`
        + `<span class="${dateClass.join(' ')}">${c.day}</span>`
        + (holiday ? `<span class="holiday-name">${SC.escapeHtml(SC.shortHolidayName(holiday))}</span>` : '')
        + (lines.length
          ? `<span class="memo${lines.length > 3 ? ' multi many' : lines.length > 1 ? ' multi' : ''}${entry.memoColor ? ' fg-' + entry.memoColor : ''}">`
            + lines.map((l, j) => `<span class="memo-item">${j === 0 && entry.source === 'rule' ? '<i class="repeat" aria-hidden="true">↻</i>' : ''}${SC.escapeHtml(l)}</span>`).join('')
            + '</span>'
          : '')
        + '</td>';

      if (i % 7 === 6) html += '</tr>';
    }
    els.calendarBody.innerHTML = html;
  }

  // 화면은 캐시로 즉시 그리고, 공휴일이 새로 도착하면 같은 달을 보고 있을 때만 다시 그린다.
  function show(year, month0) {
    const d = new Date(year, month0, 1);
    state.year = d.getFullYear();
    state.month0 = d.getMonth();
    const years = SC.gridYears(SC.buildMonthGrid(state.year, state.month0));
    years.forEach(primeHolidayCache);
    render();

    const shown = `${state.year}-${state.month0}`;
    Promise.all(years.map(ensureHolidays)).then((changed) => {
      if (changed.some(Boolean) && shown === `${state.year}-${state.month0}`) render();
    });
    // 다음/이전 해 경계에 가까우면 미리 받아 둔다.
    if (state.month0 === 11) ensureHolidays(state.year + 1);
    if (state.month0 === 0) ensureHolidays(state.year - 1);
  }

  function changeMonth(offset, animate) {
    show(state.year, state.month0 + offset);
    if (animate) {
      els.calendarBody.classList.remove('slide-left', 'slide-right');
      void els.calendarBody.offsetWidth;
      els.calendarBody.classList.add(offset > 0 ? 'slide-left' : 'slide-right');
    }
  }

  function goToToday() {
    const t = new Date();
    show(t.getFullYear(), t.getMonth());
  }

  function updateTodayButton() {
    const t = new Date();
    els.todayBtn.textContent = t.getDate();
  }

  // ---------- 일정 편집 ----------

  function setRadio(name, value) {
    for (const r of document.querySelectorAll(`input[name="${name}"]`)) r.checked = r.value === value;
  }

  function getRadio(name) {
    const r = document.querySelector(`input[name="${name}"]:checked`);
    return r ? r.value : '';
  }

  function updateMemoCount() {
    const n = SC.memoLines(els.memoInput.value).length;
    const lines = n > 1 ? `메모 ${n}개 · ` : '';
    const over = n > SC.MEMO_LINES_MAX ? ` (최대 ${SC.MEMO_LINES_MAX}개까지 저장)` : '';
    els.memoCount.textContent = `${lines}${els.memoInput.value.length}/${SC.MEMO_MAX}${over}`;
  }

  // Enter는 줄바꿈(다음 메모), Ctrl/Cmd+Enter는 저장. 메모가 이미 최대 개수면 새 줄을 막는다.
  function onMemoKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      els.editForm.requestSubmit();
    } else if (!e.shiftKey && SC.memoLines(els.memoInput.value).length >= SC.MEMO_LINES_MAX) {
      e.preventDefault();
      toast(`메모는 날짜마다 ${SC.MEMO_LINES_MAX}개까지 쓸 수 있어요.`);
    }
  }

  function updateRuleHint() {
    const freq = getRadio('freq');
    const rule = state.editRule;
    if (rule && freq) {
      els.ruleHint.textContent = `${SC.FREQ_LABELS[rule.freq]} 반복 (${SC.formatKeyLong(rule.start)}부터) — 저장하면 모든 반복 일정이 바뀝니다.`;
    } else if (rule && !freq) {
      els.ruleHint.textContent = '이 날짜만 따로 저장합니다. 다른 날의 반복 일정은 그대로입니다.';
    } else if (freq) {
      els.ruleHint.textContent = `이 날짜부터 ${SC.FREQ_LABELS[freq]} 반복됩니다.`;
    } else {
      els.ruleHint.textContent = '';
    }
  }

  function openEditor(key) {
    const data = state.data;
    const own = data.entries[key];
    const resolved = SC.resolveEntry(data, key);
    const rule = !own && resolved && resolved.source === 'rule' ? resolved.rule : null;
    const src = own || rule || { memo: '', color: '', memoColor: '' };

    state.editKey = key;
    state.editRule = rule;

    els.editTitle.textContent = SC.formatKeyLong(key);
    const holiday = holidayName(key);
    els.editHoliday.textContent = holiday;
    els.editHoliday.hidden = !holiday;

    els.memoInput.value = src.memo;
    setRadio('color', src.color);
    setRadio('memoColor', src.memoColor);
    setRadio('freq', rule ? rule.freq : '');
    updateMemoCount();
    updateRuleHint();

    els.deleteBtn.hidden = !own && !rule;
    els.deleteBtn.textContent = rule ? '반복 삭제' : '삭제';

    openDialog(els.editDialog);
    // 모바일에서 키보드가 바로 올라오지 않게, 데스크톱(정밀 포인터)에서만 자동 포커스
    if (window.matchMedia('(pointer: fine)').matches) els.memoInput.focus();
  }

  function persist() {
    try {
      store.saveData(state.profiles.active, state.data);
      return true;
    } catch (e) {
      toast('저장 공간이 부족해 저장하지 못했습니다.');
      return false;
    }
  }

  function snapshotData() {
    return JSON.parse(JSON.stringify(state.data));
  }

  // 저장 실패 시 메모리 상태를 스냅샷으로 되돌린다.
  function rollbackData(snap) {
    state.data = snap;
    if (state.editRule) state.editRule = snap.rules.find((r) => r.id === state.editRule.id) || null;
    render();
  }

  function saveEditor() {
    const key = state.editKey;
    const entry = SC.normalizeEntry({
      memo: els.memoInput.value,
      color: getRadio('color'),
      memoColor: getRadio('memoColor'),
    });
    const freq = getRadio('freq');
    const snap = snapshotData();
    const data = state.data;
    const rule = state.editRule;

    if (rule && freq) {
      if (SC.isEmptyEntry(entry)) {
        data.rules = data.rules.filter((r) => r !== rule);
      } else {
        Object.assign(rule, entry, { freq });
      }
    } else if (freq) {
      delete data.entries[key];
      if (!SC.isEmptyEntry(entry)) data.rules.push({ id: SC.uid(), freq, start: key, ...entry });
    } else if (SC.isEmptyEntry(entry)) {
      delete data.entries[key];
    } else {
      data.entries[key] = entry;
    }

    if (persist()) {
      closeDialog();
      render();
    } else {
      rollbackData(snap);
    }
  }

  function deleteFromEditor() {
    const key = state.editKey;
    const rule = state.editRule;
    if (rule) {
      confirmAction(`'${rule.memo || '반복 일정'}' 반복 일정을 모든 날짜에서 삭제할까요?`, '삭제', () => {
        const snap = snapshotData();
        state.data.rules = state.data.rules.filter((r) => r !== rule);
        if (persist()) render();
        else rollbackData(snap);
      });
    } else {
      const snap = snapshotData();
      delete state.data.entries[key];
      if (persist()) {
        closeDialog();
        render();
      } else {
        rollbackData(snap);
      }
    }
  }

  // ---------- 프로필 ----------

  function activeProfile() {
    return state.profiles.list.find((p) => p.id === state.profiles.active);
  }

  function renderProfiles() {
    const { list, active } = state.profiles;
    let html = '';
    for (const p of list) {
      html += `<button type="button" class="profile-chip${p.id === active ? ' active' : ''}" data-profile="${SC.escapeHtml(p.id)}" aria-pressed="${p.id === active}">${SC.escapeHtml(p.name)}</button>`;
    }
    html += '<button type="button" class="profile-chip add" data-add-profile aria-label="새 프로필">+</button>';
    els.profileBar.innerHTML = html;
  }

  function saveProfiles() {
    try {
      store.saveProfiles(state.profiles);
    } catch (e) {
      toast('저장 공간이 부족해 저장하지 못했습니다.');
    }
  }

  function switchProfile(id) {
    if (id === state.profiles.active) return;
    state.profiles.active = id;
    saveProfiles();
    state.data = store.loadData(id);
    renderProfiles();
    render();
    toast(`'${activeProfile().name}' 프로필`);
  }

  function addProfile() {
    promptText('새 프로필 이름', '', (name) => {
      const id = SC.uid();
      state.profiles.list.push({ id, name });
      try {
        store.saveData(id, SC.emptyData());
      } catch (e) { /* switchProfile 저장에서 다시 알린다 */ }
      switchProfile(id);
    });
  }

  function renameProfile() {
    const p = activeProfile();
    promptText('프로필 이름 변경', p.name, (name) => {
      p.name = name;
      saveProfiles();
      renderProfiles();
    });
  }

  function deleteProfile() {
    if (state.profiles.list.length <= 1) return;
    const p = activeProfile();
    confirmAction(`'${p.name}' 프로필과 모든 일정을 삭제할까요?`, '삭제', () => {
      state.profiles.list = state.profiles.list.filter((x) => x.id !== p.id);
      state.profiles.active = state.profiles.list[0].id;
      store.removeData(p.id);
      saveProfiles();
      state.data = store.loadData(state.profiles.active);
      renderProfiles();
      render();
    });
  }

  // ---------- 테마 ----------

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
    const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#1b1d22' : '#3a86ff');
  }

  function currentTheme() {
    let t = null;
    try {
      t = storage.getItem(SC.KEYS.theme);
    } catch (e) { /* 저장소 접근 불가: 시스템 테마 */ }
    return t === 'light' || t === 'dark' ? t : 'system';
  }

  // ---------- 알림 ----------

  function notifySettings() {
    return SC.readJson(storage, SC.KEYS.notify, { enabled: false, last: '' });
  }

  function saveNotifySettings(s) {
    try {
      storage.setItem(SC.KEYS.notify, JSON.stringify(s));
    } catch (e) { /* 저장 실패는 무시: 이번 실행에서만 유효 */ }
  }

  const canNotify = 'Notification' in window;

  function upcomingAll() {
    const todayKey = SC.dateToKey(new Date());
    const multi = state.profiles.list.length > 1;
    const items = [];
    for (const p of state.profiles.list) {
      const data = p.id === state.profiles.active ? state.data : store.loadData(p.id);
      for (const it of SC.upcoming(data, todayKey, 2)) {
        items.push(`${it.offset === 0 ? '오늘' : '내일'} · ${multi ? `[${p.name}] ` : ''}${SC.memoLines(it.memo).join(' / ')}`);
      }
    }
    return items;
  }

  // 하루 한 번: 시스템 알림(권한이 있을 때) 또는 앱 안 배너로 오늘·내일 일정을 알려준다.
  function notifyUpcoming(force) {
    const s = notifySettings();
    if (!s.enabled) return;
    const todayKey = SC.dateToKey(new Date());
    if (!force && s.last === todayKey) return;
    const items = upcomingAll();
    if (items.length === 0) return;

    s.last = todayKey;
    saveNotifySettings(s);

    const body = items.slice(0, 5).join('\n') + (items.length > 5 ? `\n외 ${items.length - 5}건` : '');
    if (canNotify && Notification.permission === 'granted') {
      const opts = { body, icon: 'icon.png', tag: 'sc-daily' };
      const fallback = () => toast(items.slice(0, 3).join('  /  '), 5000);
      try {
        const sw = navigator.serviceWorker;
        const getReg = sw && sw.getRegistration ? sw.getRegistration() : Promise.resolve(null);
        getReg
          .then((reg) => {
            if (reg) return reg.showNotification('심캘 일정', opts);
            new Notification('심캘 일정', opts);
          })
          .catch(fallback);
      } catch (e) {
        fallback();
      }
    } else {
      toast(items.slice(0, 3).join('  /  '), 5000);
    }
  }

  function updateNotifyUi() {
    const s = notifySettings();
    els.notifyToggle.checked = s.enabled;
    let status;
    if (!s.enabled) status = '앱을 열 때 오늘·내일 일정을 하루 한 번 알려줍니다.';
    else if (!canNotify) status = '이 환경은 시스템 알림을 지원하지 않아 앱 안 배너로 알려줍니다.';
    else if (Notification.permission === 'granted') status = '시스템 알림으로 알려줍니다.';
    else if (Notification.permission === 'denied') status = '알림 권한이 거부되어 앱 안 배너로 알려줍니다.';
    else status = '앱 안 배너로 알려줍니다.';
    els.notifyStatus.textContent = status;
  }

  async function onNotifyToggle() {
    const s = notifySettings();
    s.enabled = els.notifyToggle.checked;
    s.last = '';
    saveNotifySettings(s);
    if (s.enabled && canNotify && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) { /* 구형 브라우저 */ }
    }
    updateNotifyUi();
    if (s.enabled) notifyUpcoming(true);
  }

  // ---------- 백업 ----------

  // 안드로이드 WebView는 Blob 다운로드·파일 선택이 조용히 실패하므로 파일 버튼을 숨긴다.
  const isWebView = /; wv\)/.test(navigator.userAgent || '');
  function setFileBtnVisible() {
    els.backupFileBtn.style.display = isWebView ? 'none' : '';
  }

  function openExport() {
    const text = JSON.stringify(store.exportAll());
    els.backupTitle.textContent = '백업 내보내기';
    els.backupHint.textContent = '아래 텍스트를 복사해 보관하세요. 가져오기에 붙여넣으면 복원됩니다.';
    els.backupText.value = text;
    els.backupText.readOnly = true;
    els.backupFileBtn.textContent = '파일로 저장';
    setFileBtnVisible();
    els.backupActionBtn.textContent = '복사';
    els.backupFileBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `simple-calendar-${SC.dateToKey(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    els.backupActionBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        els.backupText.select();
        document.execCommand('copy');
      }
      toast('복사했습니다.');
    };
    openDialog(els.backupDialog);
  }

  function openImport() {
    els.backupTitle.textContent = '백업 가져오기';
    els.backupHint.textContent = `내보낸 텍스트를 붙여넣${isWebView ? '으세요' : '거나 파일을 선택하세요'}. 지금 있는 모든 프로필과 일정이 백업 내용으로 바뀝니다.`;
    els.backupText.value = '';
    els.backupText.readOnly = false;
    els.backupFileBtn.textContent = '파일 선택';
    setFileBtnVisible();
    els.backupActionBtn.textContent = '가져오기';
    els.backupFileBtn.onclick = () => els.backupFile.click();
    els.backupActionBtn.onclick = () => {
      const text = els.backupText.value.trim();
      if (!text) {
        els.backupText.focus();
        return;
      }
      confirmAction('지금 있는 일정을 모두 백업 내용으로 바꿀까요?', '가져오기', () => {
        try {
          state.profiles = store.importAll(text);
        } catch (e) {
          toast(e.message);
          return;
        }
        state.data = store.loadData(state.profiles.active);
        renderProfiles();
        render();
        toast('백업을 가져왔습니다.');
      });
    };
    openDialog(els.backupDialog);
    els.backupText.focus();
  }

  els.backupFile.addEventListener('change', () => {
    const f = els.backupFile.files[0];
    if (!f) return;
    f.text().then((t) => {
      els.backupText.value = t;
    });
    els.backupFile.value = '';
  });

  // ---------- 설정 메뉴 ----------

  function openMenu() {
    els.menuProfileName.textContent = activeProfile().name;
    els.deleteProfileBtn.disabled = state.profiles.list.length <= 1;
    setRadio('theme', currentTheme());
    updateNotifyUi();
    openDialog(els.menuDialog);
  }

  function resetProfile() {
    confirmAction(`'${activeProfile().name}' 프로필의 메모와 색깔, 반복 일정을 모두 삭제할까요?`, '모두 삭제', () => {
      const snap = snapshotData();
      state.data = SC.emptyData();
      if (persist()) {
        render();
        toast('초기화했습니다.');
      } else {
        rollbackData(snap);
      }
    });
  }

  // ---------- 이벤트 ----------

  els.calendarBody.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-key]');
    if (td) openEditor(td.dataset.key);
  });
  els.calendarBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const td = e.target.closest('td[data-key]');
    if (td) {
      e.preventDefault();
      openEditor(td.dataset.key);
    }
  });

  // 좌우 스와이프로 달 이동
  let touch = null;
  els.calendarBody.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) {
      touch = null;
      return;
    }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  els.calendarBody.addEventListener('touchcancel', () => {
    touch = null;
  }, { passive: true });
  els.calendarBody.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // 스와이프 뒤 이어지는 click으로 편집창이 열리지 않게 막는다.
      e.preventDefault();
      changeMonth(dx < 0 ? 1 : -1, true);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (activeDialog || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowLeft') changeMonth(-1, true);
    else if (e.key === 'ArrowRight') changeMonth(1, true);
    else if (e.key === 't' || e.key === 'T') goToToday();
  });

  $('prevMonthBtn').addEventListener('click', () => changeMonth(-1, true));
  $('nextMonthBtn').addEventListener('click', () => changeMonth(1, true));
  els.todayBtn.addEventListener('click', goToToday);
  els.monthTitle.addEventListener('click', goToToday);
  $('menuBtn').addEventListener('click', openMenu);

  els.profileBar.addEventListener('click', (e) => {
    const chip = e.target.closest('button');
    if (!chip) return;
    if (chip.hasAttribute('data-add-profile')) addProfile();
    else switchProfile(chip.dataset.profile);
  });

  els.editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveEditor();
  });
  els.memoInput.addEventListener('input', updateMemoCount);
  els.memoInput.addEventListener('keydown', onMemoKeydown);
  for (const r of document.querySelectorAll('input[name="freq"]')) r.addEventListener('change', updateRuleHint);
  $('cancelBtn').addEventListener('click', closeDialog);
  els.deleteBtn.addEventListener('click', deleteFromEditor);

  $('addProfileBtn').addEventListener('click', addProfile);
  $('renameProfileBtn').addEventListener('click', renameProfile);
  els.deleteProfileBtn.addEventListener('click', deleteProfile);
  for (const r of document.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => {
      try {
        if (r.value === 'system') storage.removeItem(SC.KEYS.theme);
        else storage.setItem(SC.KEYS.theme, r.value);
      } catch (e) { /* 저장 실패는 무시: 이번 실행에서만 적용 */ }
      applyTheme(r.value);
    });
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme()));
  els.notifyToggle.addEventListener('change', onNotifyToggle);
  $('exportBtn').addEventListener('click', openExport);
  $('importBtn').addEventListener('click', openImport);
  $('resetBtn').addEventListener('click', resetProfile);

  // 자정을 넘기거나 앱을 다시 열었을 때 '오늘' 표시를 갱신한다.
  let lastToday = SC.dateToKey(new Date());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = SC.dateToKey(new Date());
    if (now !== lastToday) {
      lastToday = now;
      updateTodayButton();
      render();
    }
    notifyUpcoming(false);
  });

  // ---------- 시작 ----------

  try {
    state.profiles = store.init();
  } catch (e) {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등): 메모리에서만 동작
    state.profiles = { active: 'default', list: [{ id: 'default', name: '기본' }] };
    toast('저장소를 사용할 수 없어 일정이 저장되지 않습니다.', 4000);
  }
  if (!storageOk) toast('저장소를 사용할 수 없어 일정이 저장되지 않습니다.', 4000);
  state.data = store.loadData(state.profiles.active);
  applyTheme(currentTheme());
  updateTodayButton();
  renderProfiles();
  goToToday();
  notifyUpcoming(false);
})();
