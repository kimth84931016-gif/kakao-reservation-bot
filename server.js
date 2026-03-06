const express = require("express");
const app = express();

app.use(express.json());

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

/*
날짜 정규화
카카오에서 오는 값 예시
2026-03-17
2026-03-17T00:00:00+09:00
3월 17일
*/
function normalizeDate(value) {
  if (!value) return null;

  const s = String(value).trim();

  // ISO 형식 앞 10자리만 사용
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  // 3월 17일
  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const year = new Date().getFullYear();
    const month = String(md[1]).padStart(2, "0");
    const day = String(md[2]).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

/*
시간 정규화
카카오에서 올 수 있는 값
13
13:00
13:00:00
오후 1시
13시
*/
function normalizeHour(value) {
  if (!value) return null;

  const s = String(value).trim();

  // 13:00 또는 13:00:00
  const hm = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (hm) return parseInt(hm[1], 10);

  // 13시 / 오후 1시
  const h = s.match(/(\d{1,2})\s*시/);
  if (h) {
    let hour = parseInt(h[1], 10);

    if (s.includes("오후") && hour < 12) hour += 12;
    if (s.includes("오전") && hour === 12) hour = 0;

    return hour;
  }

  // 숫자만
  if (/^\d{1,2}$/.test(s)) {
    return parseInt(s, 10);
  }

  return null;
}

function getPeriod(hour) {
  if (hour >= 9 && hour <= 11) return "오전";
  if (hour >= 13 && hour <= 16) return "오후";
  return null;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");

    rows.push({
      날짜: (cols[0] || "").trim(),
      오전: (cols[1] || "").trim(),
      오후: (cols[2] || "").trim(),
    });
  }

  return rows;
}

async function checkReservation(dateValue, timeValue) {

  const date = normalizeDate(dateValue);
  const hour = normalizeHour(timeValue);
  const period = getPeriod(hour);

  console.log("date raw:", dateValue);
  console.log("time raw:", timeValue);
  console.log("normalized date:", date);
  console.log("hour:", hour);
  console.log("period:", period);

  if (!date || period === null) {
    return "담당자 확인 후 연락드리겠습니다.";
  }

  const response = await fetch(CSV_URL);
  const csvText = await response.text();
  const rows = parseCsv(csvText);

  console.log("rows:", rows);

  const row = rows.find((r) => normalizeDate(r["날짜"]) === date);

  if (!row) {
    return "담당자 확인 후 연락드리겠습니다.";
  }

  const status = (row[period] || "").trim();

  if (status === "가능") {
    return "예약 확정 되셨습니다.";
  }

  if (status === "마감") {
    return "예약 마감되었습니다.";
  }

  return "담당자 확인 후 연락드리겠습니다.";
}

app.get("/", (req, res) => {
  res.send("ok");
});

app.post("/", async (req, res) => {

  try {

    const params = req.body.action?.params || {};

    console.log("params:", params);

    const date = params.date;
    const time = params.time;

    const message = await checkReservation(date, time);

    res.json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: message,
            },
          },
        ],
      },
    });

  } catch (error) {

    console.error(error);

    res.json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: "담당자 확인 후 연락드리겠습니다.",
            },
          },
        ],
      },
    });

  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("server start");
});
