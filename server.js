const express = require("express");
const app = express();

app.use(express.json());

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

// ===== 유틸 =====

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();

  // 2026-03-13 또는 2026-03-13T00:00:00+09:00
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 2026년 3월 13일
  const ymd = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  }

  // 3월 13일
  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const now = new Date();
    return `${now.getFullYear()}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
  }

  // 13일
  const dOnly = s.match(/(\d{1,2})\s*일/);
  if (dOnly) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(dOnly[1]).padStart(2, "0")}`;
  }

  return null;
}

function normalizeHour(value) {
  if (!value) return null;
  const s = String(value).trim();

  // 13:00 / 09:00 / 13:00:00
  const hm = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (hm) return parseInt(hm[1], 10);

  // 오전 9시 / 오후 1시 / 13시 / 09시
  const h = s.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (h) {
    let hour = parseInt(h[2], 10);
    if (h[1] === "오후" && hour < 12) hour += 12;
    if (h[1] === "오전" && hour === 12) hour = 0;
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

// ===== 사용자 문장에서 직접 추출 =====

function extractFromUtterance(utterance) {
  const text = String(utterance || "").trim();

  let date = null;
  let time = null;

  // 날짜
  const ymd = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) {
    date = `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  } else {
    const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (md) {
      const now = new Date();
      date = `${now.getFullYear()}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
    } else {
      const dOnly = text.match(/(\d{1,2})\s*일/);
      if (dOnly) {
        const now = new Date();
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(dOnly[1]).padStart(2, "0")}`;
      }
    }
  }

  // 시간
  const hhmm = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (hhmm) {
    time = hhmm[1];
  } else {
    const h = text.match(/(오전|오후)?\s*\d{1,2}\s*시/);
    if (h) time = h[0];
  }

  return { date, time };
}

// ===== 상태 확인 =====

async function checkReservation(utterance) {
  const extracted = extractFromUtterance(utterance);

  const date = normalizeDate(extracted.date);
  const hour = normalizeHour(extracted.time);
  const period = getPeriod(hour);

  console.log("utterance:", utterance);
  console.log("extracted:", extracted);
  console.log("normalized date:", date);
  console.log("hour:", hour);
  console.log("period:", period);

  if (!date || period === null) {
    return "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 13시 예약 가능할까요?";
  }

  const response = await fetch(CSV_URL);
  const csvText = await response.text();
  const rows = parseCsv(csvText);

  const row = rows.find((r) => normalizeDate(r["날짜"]) === date);

  if (!row) {
    return "담당자 확인 후 연락드리겠습니다.";
  }

  const status = (row[period] || "").trim();

  if (status === "가능") return "예약 확정 되셨습니다.";
  if (status === "마감") return "예약 마감되었습니다.";

  return "담당자 확인 후 연락드리겠습니다.";
}

// ===== 라우트 =====

app.get("/", (req, res) => {
  res.send("ok");
});

app.post("/", async (req, res) => {
  try {
    const utterance = req.body?.userRequest?.utterance || "";
    const message = await checkReservation(utterance);

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
