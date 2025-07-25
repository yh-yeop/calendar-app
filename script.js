const calendarEl = document.getElementById("calendar");
const monthYearEl = document.getElementById("monthYear");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");

let currentDate = new Date();
let memoData = JSON.parse(localStorage.getItem("memoData") || "{}");
let holidayData = {};

async function fetchHolidays(year, month) {
  const serviceKey = "8JrZ7bV8ldqfBkPw2jiJG8RBfL559YI/k2FYcNRGLUiIE9XSl7Oae+eLSnTOmotMf35yk8pBsSIB0NWvhoJOaw==";
  const solMonth = String(month).padStart(2, "0");
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&solMonth=${solMonth}&ServiceKey=${serviceKey}&_type=json`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = data?.response?.body?.items?.item;
    if (!items) return;

    holidayData = {};
    (Array.isArray(items) ? items : [items]).forEach(item => {
      holidayData[item.locdate] = item.dateName;
    });
  } catch (e) {
    console.error("공휴일 정보 로드 실패:", e);
  }
}

function getMemoKey(year, month, date) {
  return `${year}-${month + 1}-${date}`;
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();

  calendarEl.innerHTML = "";
  monthYearEl.textContent = `${year}년 ${month + 1}월`;

  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement("div");
    calendarEl.appendChild(empty);
  }

  for (let date = 1; date <= lastDay.getDate(); date++) {
    const cell = document.createElement("div");
    const locdateKey = `${year}${String(month + 1).padStart(2, "0")}${String(date).padStart(2, "0")}`;
    const isHoliday = holidayData[locdateKey];
    const memoKey = getMemoKey(year, month, date);

    cell.classList.add("day");
    if (isHoliday) cell.classList.add("holiday");

    const dateDiv = document.createElement("div");
    dateDiv.className = "date";
    dateDiv.textContent = date;
    cell.appendChild(dateDiv);

    if (isHoliday) {
      const holidayDiv = document.createElement("div");
      holidayDiv.className = "holiday-label";
      holidayDiv.textContent = isHoliday;
      cell.appendChild(holidayDiv);
    }

    const memo = document.createElement("div");
    memo.className = "memo";
    memo.contentEditable = true;
    memo.innerText = memoData[memoKey] || "";

    memo.addEventListener("input", () => {
      memoData[memoKey] = memo.innerText;
      localStorage.setItem("memoData", JSON.stringify(memoData));
    });

    cell.appendChild(memo);
    calendarEl.appendChild(cell);
  }
}

prevMonthBtn.onclick = async () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  await fetchHolidays(currentDate.getFullYear(), currentDate.getMonth() + 1);
  renderCalendar();
};

nextMonthBtn.onclick = async () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  await fetchHolidays(currentDate.getFullYear(), currentDate.getMonth() + 1);
  renderCalendar();
};

(async () => {
  await fetchHolidays(currentDate.getFullYear(), currentDate.getMonth() + 1);
  renderCalendar();
})();