let current = new Date();
current.setDate(1);

const calendar = document.getElementById('calendar');
const monthTitle = document.getElementById('monthTitle');
const popup = document.getElementById('popup');
const overlay = document.getElementById('overlay');
const memoInput = document.getElementById('memoInput');
const popupDate = document.getElementById('popupDate');

const resetBtn = document.getElementById('resetBtn');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');

let selectedDate = '';

let holidays = new Map();

async function fetchHolidays(year, month) {
  const serviceKey = '8JrZ7bV8ldqfBkPw2jiJG8RBfL559YI%2Fk2FYcNRGLUiIE9XSl7Oae%2BeLSnTOmotMf35yk8pBsSIB0NWvhoJOaw%3D%3D';
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${serviceKey}&solYear=${year}&solMonth=${String(month).padStart(2, '0')}&_type=json`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('네트워크 응답 오류');
    const data = await res.json();

    holidays.clear();

    const items = data.response?.body?.items?.item;

    if (Array.isArray(items)) {
      for (const day of items) {
        if (day?.isHoliday === 'Y') {
          const d = day.locdate.toString();
          const formatted = `${d.slice(0,4)}-${String(parseInt(d.slice(4,6))).padStart(2,'0')}-${String(parseInt(d.slice(6,8))).padStart(2,'0')}`;
          holidays.set(formatted, day.dateName);
        }
      }
    } else if (items && items.isHoliday === 'Y') {
      const d = items.locdate.toString();
      const formatted = `${d.slice(0,4)}-${String(parseInt(d.slice(4,6))).padStart(2,'0')}-${String(parseInt(d.slice(6,8))).padStart(2,'0')}`;
      holidays.set(formatted, items.dateName);
    }
  } catch (e) {
    console.error('공휴일 API 호출 실패:', e);
    holidays.clear();
  }
}

async function buildCalendar() {
  const year = current.getFullYear();
  const month = current.getMonth();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  await fetchHolidays(year, month + 1);

  monthTitle.innerText = `${year}년 ${month + 1}월`;

  let html = '<tr>';
  ['일', '월', '화', '수', '목', '금', '토'].forEach(
    (day) => (html += `<th>${day}</th>`)
  );
  html += '</tr><tr>';

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();
  const startOffset = firstDay;

  let day = 1;
  let nextDay = 1;

  for (let i = 0; i < 6 * 7; i++) {
    let dateClass = '';
    let displayDate = '';
    let fullDate = '';

    const weekDay = i % 7;
    if (i < startOffset) {
      const prevDate = prevLastDate - startOffset + i + 1;
      fullDate = `${year}-${String(month).padStart(2,'0')}-${String(prevDate).padStart(2,'0')}`;
      displayDate = prevDate;
      dateClass = 'dimmed';
    } else if (day <= lastDate) {
      fullDate = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      displayDate = day;

      if (holidays.has(fullDate)) {
        dateClass += ' holiday';
      } else {
        if (weekDay === 0) dateClass += ' sun';
        if (weekDay === 6) dateClass += ' sat';
      }

      day++;
    } else {
      fullDate = `${year}-${String(month + 2).padStart(2,'0')}-${String(nextDay).padStart(2,'0')}`;
      displayDate = nextDay;
      nextDay++;
      dateClass = 'dimmed';
    }

    // 저장 데이터 읽기
    const saved = JSON.parse(localStorage.getItem(fullDate) || '{}');
    const colorClass = saved.color || '';
    const memo = saved.memo || '';
    const memoColor = saved.memoColor || 'black';

    const rawHolidayName = holidays.get(fullDate) || '';
    const holidayName = rawHolidayName.includes('임시공휴일') ? '임시공휴일' : rawHolidayName;

    if (fullDate === todayStr) {
      dateClass += ' today';
    }

    // holidayName 있을 때와 없을 때 메모 CSS 클래스 분기 처리
    const memoClass = holidayName ? 'memo below-holiday' : 'memo';

    html += `<td class="${colorClass}" onclick="openPopup('${fullDate}')">
               <div class="date ${dateClass}">${displayDate}</div>
               ${holidayName ? `<div class="holiday-name">${holidayName}</div>` : ''}
               <div class="${memoClass}" style="color:${memoColor};">${memo}</div>
             </td>`;
    if (i % 7 === 6) html += '</tr><tr>';
  }

  html += '</tr>';
  calendar.innerHTML = html;

  requestAnimationFrame(() => {
    const tds = calendar.querySelectorAll('td');

    tds.forEach(td => {
      const holidayNameEl = td.querySelector('.holiday-name');
      const memoEl = td.querySelector('.memo');

      if (memoEl) {
        const isMobile = window.innerWidth <= 480;
        const baseMarginTop = isMobile ? 20 : 20;

        if (holidayNameEl) {
          const holidayHeight = holidayNameEl.offsetHeight;
          const newMarginTop = baseMarginTop - holidayHeight;
          memoEl.style.marginTop = (newMarginTop > 0 ? newMarginTop : 0) + 'px';
        } else {
          memoEl.style.marginTop = baseMarginTop + 'px';
        }
      }
    });
  });
}

function changeMonth(offset) {
  const newMonth = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  // 2025년 이전까지 허용
  if (newMonth.getFullYear() <= 2025) {
    current = newMonth;
    buildCalendar();
  }
}

function openPopup(dateStr) {
  selectedDate = dateStr;
  popupDate.innerText = dateStr;
  const saved = JSON.parse(localStorage.getItem(dateStr) || '{}');
  memoInput.value = saved.memo || '';
  document.querySelectorAll('input[name="color"]').forEach((r) => {
    r.checked = r.value === (saved.color || '');
  });
  document.querySelectorAll('input[name="memoColor"]').forEach((r) => {
    r.checked = r.value === (saved.memoColor || 'black');
  });
  popup.style.display = 'block';
  overlay.style.display = 'block';
}

function closePopup() {
  popup.style.display = 'none';
  overlay.style.display = 'none';
}

function saveMemo() {
  const memo = memoInput.value.trim();
  const color = document.querySelector('input[name="color"]:checked').value;
  const memoColor = document.querySelector('input[name="memoColor"]:checked').value;

  localStorage.setItem(
    selectedDate,
    JSON.stringify({ memo, color, memoColor })
  );
  closePopup();
  buildCalendar();
}

function resetAll() {
  if (confirm('메모와 색깔을 모두 초기화하시겠습니까?')) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        localStorage.removeItem(key);
        i--;
      }
    }
    buildCalendar();
  }
}

resetBtn.addEventListener('click', resetAll);
prevMonthBtn.addEventListener('click', () => changeMonth(-1));
nextMonthBtn.addEventListener('click', () => changeMonth(1));
saveBtn.addEventListener('click', saveMemo);
cancelBtn.addEventListener('click', closePopup);
overlay.addEventListener('click', closePopup);

buildCalendar();