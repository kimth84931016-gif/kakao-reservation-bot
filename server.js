const express = require("express");
const app = express();

app.use(express.json());

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

function normalizeDate(value) {
  if (!value) return null;

  const s = String(value).trim();

  // 2026-03-17 또는 2026-03-17T00:00:00+09:00
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

  // 17일
  const dOnly = s.match(/(\d{1,2})\s*일/);
  if (dOnly) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(dOnly[1]).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizeHour(value) {
  if (!value) return null;

  const s = String(value).trim();

  // 13:00 또는 13:00:00
  const hm = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (hm) return parseInt(hm[1], 10);

  // 오후 1시 / 13시
  const h = s.match(/(\d{1,2})\s*시/);
  if (h) {
    let hour = parseInt(h[1], 10);
    if (s.includes("오후") && hour < 12) hour += 12;
    if (s.includes("오전") && hour === 12) hour = 0;
    return hour;
  }

  // 숫자만
  if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);

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

function extractFromUtterance(utterance) {
  if (!utterance) return { date: null, time: null };

  const text = String(utterance).trim();

  let date = null;
  let time = null;

  // 2026년 3월 17일 / 3월 17일 / 17일
  const ymd = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) {
    date = `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  } else {
    date = normalizeDate(text);
  }

  // 13시 / 오후 1시 / 13:00
  const hhmm = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (hhmm) {
    time = hhmm[1];
  } else {
    const h = text.match(/(오전\s*\d{1,2}\s*시|오후\s*\d{1,2}\s*시|\d{1,2}\s*시)/);
    if (h) {
      time = h[1];
    }
  }

  return { date, time };
}

function extractDateTime(body) {
  const params = body?.action?.params || {};
  const detailParams = body?.action?.detailParams || {};
  const utterance = body?.userRequest?.utterance || "";

  let date =
    params.date ||
    params.sysdate ||
    detailParams.date?.value ||
    detailParams.sysdate?.value;

  let time =
    params.time ||
    params.systime ||
    detailParams.time?.value ||
    detailParams.systime?.value;

  // detailParams 전체를 훑어서 sys.date / sys.time 비슷한 것 찾기
  for (const key of Object.keys(detailParams)) {
    const item = detailParams[key];
    const origin = item?.origin || "";
    const value = item?.value || "";

    if (!date) {
      if (String(value).includes("T00:00:00") || String(origin).includes("일")) {
        date = value || origin;
      }
    }

    if (!time) {
      if (
        /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value)) ||
        String(origin).includes("시")
      ) {
        time = value || origin;
      }
    }
  }

  // 그래도 없으면 사용자 문장에서 직접 추출
  if (!date || !time) {
    const fromUtterance = extractFromUtterance(utterance);
    if (!date) date = fromUtterance.date;
    if (!time) time = fromUtterance.time;
  }

  return { date, time };
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
    console.log("FULL BODY:", JSON.stringify(req.body, null, 2));

    const extracted = extractDateTime(req.body);

    console.log("extracted:", extracted);

    const message = await checkReservation(extracted.date, extracted.time);

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
