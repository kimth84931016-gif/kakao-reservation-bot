const express = require("express");
const app = express();

app.use(express.json());

const STATUS_CSV_URL =
  "https://script.google.com/macros/s/AKfycbxNzjKCiDcgjz4pwzvO3T-JNJD8jVBDlJ54BJZGU8tMCLMTkluQbLA0z6YumuGRTPIh/exec";

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbyiCWKewmo2kZZbsz63UqaLPRdyihRk0iBwN7z846ufA1r64NelsT74UryTQ5DPhic_/exec";

/* ---------------------------
 * 공통 유틸
 * --------------------------- */

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result.map((v) => String(v || "").trim());
}

function parseCsvWithHeader(text) {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};

    headers.forEach((header, idx) => {
      row[header] = (cols[idx] || "").trim();
    });

    rows.push(row);
  }

  return rows;
}

async function fetchCsvRows(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCsvWithHeader(text);
}

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const ymd = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  }

  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const now = new Date();
    return `${now.getFullYear()}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
  }

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

  if (s === "오전") return 9;
  if (s === "오후") return 13;

  const hm = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (hm) return parseInt(hm[1], 10);

  const h = s.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (h) {
    let hour = parseInt(h[2], 10);
    if (h[1] === "오후" && hour < 12) hour += 12;
    if (h[1] === "오전" && hour === 12) hour = 0;
    return hour;
  }

  if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);

  return null;
}

function getPeriod(hour) {
  if (hour >= 9 && hour <= 11) return "오전";
  if (hour >= 13 && hour <= 16) return "오후";
  return null;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function extractFromUtterance(text) {
  const utterance = String(text || "").trim();

  let date = null;
  let time = null;

  const ymd = utterance.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) {
    date = `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  } else {
    const md = utterance.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (md) {
      const now = new Date();
      date = `${now.getFullYear()}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
    } else {
      const dOnly = utterance.match(/(\d{1,2})\s*일/);
      if (dOnly) {
        const now = new Date();
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(dOnly[1]).padStart(2, "0")}`;
      }
    }
  }

  const hhmm = utterance.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (hhmm) {
    time = hhmm[1];
    return { date, time };
  }

  const hourText = utterance.match(/(오전|오후)?\s*\d{1,2}\s*시/);
  if (hourText) {
    time = hourText[0];
    return { date, time };
  }

  if (/오전/.test(utterance)) {
    time = "오전";
    return { date, time };
  }

  if (/오후/.test(utterance)) {
    time = "오후";
    return { date, time };
  }

  return { date, time };
}

function extractMultipleDates(text) {
  const matches = [...String(text || "").matchAll(/(\d{1,2})\s*일/g)];
  const now = new Date();

  return matches.map((m) => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  });
}

function getThisWeekDates() {
  const today = new Date();
  const dates = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  return dates;
}

function detectIntent(text) {
  const utterance = String(text || "").trim();

  if (/취소/.test(utterance)) return "cancel";

  if (/이번주/.test(utterance)) return "week";

  if (/남는 시간|가능한 시간대|예약 가능한 시간/.test(utterance) && /\d{1,2}일/.test(utterance)) {
    return "single_day_slots";
  }

  if (/가능|남는 시간|가능한 날/.test(utterance) && /\d+일.*\d+일/.test(utterance)) {
    return "multi";
  }

  if (/예약/.test(utterance)) return "reserve";

  return "unknown";
}

function getUserId(body) {
  return body?.userRequest?.user?.id || null;
}

/* ---------------------------
 * Apps Script 호출
 * --------------------------- */

async function callScript(payload) {
  const response = await fetch(WRITE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await response.text();
  console.log("SCRIPT RAW RESULT:", text);

  try {
    return JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      message: "Apps Script가 JSON이 아닌 응답을 반환했습니다.",
      raw: text,
    };
  }
}

async function ensureMapping(userId) {
  return callScript({
    action: "ensureMapping",
    userId,
  });
}

async function getMappedName(userId) {
  const result = await callScript({
    action: "getName",
    userId,
  });

  if (!result.ok) return null;
  return String(result.name || "").trim() || null;
}

async function findExistingReservation(userId, date) {
  const result = await callScript({
    action: "findReservation",
    userId,
    date,
  });

  if (!result.ok) return null;
  return result.found ? result.row || { found: true } : null;
}

async function saveReservation({ date, time, userId, name }) {
  return callScript({
    action: "reserve",
    date,
    time,
    name,
    userId,
    status: "예약완료",
  });
}

async function cancelReservation({ date, userId }) {
  return callScript({
    action: "cancel",
    date,
    userId,
  });
}

/* ---------------------------
 * 상태 시트 조회
 * --------------------------- */

async function getAvailability(date, period) {
  const rows = await fetchCsvRows(STATUS_CSV_URL);
  const row = rows.find((r) => normalizeDate(r["날짜"]) === date);

  if (!row) return null;

  return String(row[period] || "").trim();
}

async function getAvailableSlots(dates) {
  const rows = await fetchCsvRows(STATUS_CSV_URL);
  const result = [];

  for (const date of dates) {
    const row = rows.find((r) => normalizeDate(r["날짜"]) === date);
    if (!row) continue;

    const slots = [];
    if (String(row["오전"] || "").trim() === "가능") slots.push("오전");
    if (String(row["오후"] || "").trim() === "가능") slots.push("오후");

    if (slots.length > 0) {
      result.push(`${date} (${slots.join(", ")})`);
    }
  }

  if (result.length === 0) {
    return "현재 예약 가능한 시간이 없습니다.";
  }

  return `예약 가능한 시간\n\n${result.join("\n")}`;
}

async function getSingleDateSlots(date) {
  const rows = await fetchCsvRows(STATUS_CSV_URL);
  const row = rows.find((r) => normalizeDate(r["날짜"]) === date);

  if (!row) {
    return "해당 날짜의 예약 정보를 찾지 못했습니다.";
  }

  const slots = [];
  if (String(row["오전"] || "").trim() === "가능") slots.push("오전");
  if (String(row["오후"] || "").trim() === "가능") slots.push("오후");

  if (slots.length === 0) {
    return `${date}에는 예약 가능한 시간이 없습니다.`;
  }

  return `${date} 예약 가능한 시간은 ${slots.join(", ")} 입니다.`;
}

/* ---------------------------
 * 비즈니스 로직
 * --------------------------- */

async function handleReserveLike(utterance, userId) {
  const extracted = extractFromUtterance(utterance);
  const date = normalizeDate(extracted.date);
  const hour = normalizeHour(extracted.time);
  const period = getPeriod(hour);

  console.log("RESERVE-LIKE utterance:", utterance);
  console.log("RESERVE-LIKE extracted:", extracted);
  console.log("RESERVE-LIKE normalized date:", date);
  console.log("RESERVE-LIKE hour:", hour);
  console.log("RESERVE-LIKE period:", period);
  console.log("RESERVE-LIKE userId:", userId);

  if (!userId) {
    return {
      message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다.",
      shouldSave: false,
    };
  }

  if (!date || period === null) {
    return {
      message:
        "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 오전 예약할게요 / 3월 13일 13시 예약할게요",
      shouldSave: false,
    };
  }

  const existing = await findExistingReservation(userId, date);
  if (existing) {
    return {
      message: `${date}에는 이미 예약이 있습니다. 하루에 1건만 예약 가능합니다.`,
      shouldSave: false,
    };
  }

  const status = await getAvailability(date, period);

  if (status === "마감") {
    return {
      message: "예약 마감되었습니다.",
      shouldSave: false,
    };
  }

  if (status !== "가능") {
    return {
      message: "담당자 확인 후 연락드리겠습니다.",
      shouldSave: false,
    };
  }

  const mappedName = await getMappedName(userId);
  const name = mappedName || "미등록";

  return {
    message: "예약 확정되셨습니다.",
    shouldSave: true,
    date,
    time: formatHour(hour),
    userId,
    name,
  };
}

async function handleCancel(utterance, userId) {
  const extracted = extractFromUtterance(utterance);
  const date = normalizeDate(extracted.date);

  console.log("CANCEL utterance:", utterance);
  console.log("CANCEL extracted:", extracted);
  console.log("CANCEL normalized date:", date);
  console.log("CANCEL userId:", userId);

  if (!userId) {
    return {
      message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다.",
      shouldCancel: false,
    };
  }

  if (!date) {
    return {
      message: "취소할 날짜를 함께 말씀해 주세요. 예: 3월 17일 예약 취소할게요",
      shouldCancel: false,
    };
  }

  const existing = await findExistingReservation(userId, date);

  if (!existing) {
    return {
      message: `${date}에 취소할 예약이 없습니다.`,
      shouldCancel: false,
    };
  }

  return {
    message: `${date} 예약이 취소되었습니다.`,
    shouldCancel: true,
    date,
    userId,
  };
}

async function processRequest(body) {
  const utterance = body?.userRequest?.utterance || "";
  const userId = getUserId(body);
  const intent = detectIntent(utterance);

  console.log("intent:", intent);
  console.log("userId:", userId);

  if (intent === "single_day_slots") {
    const extracted = extractFromUtterance(utterance);
    const date = normalizeDate(extracted.date);
    const message = await getSingleDateSlots(date);
    return { message };
  }

  if (intent === "multi") {
    const dates = extractMultipleDates(utterance);
    const message = await getAvailableSlots(dates);
    return { message };
  }

  if (intent === "week") {
    const dates = getThisWeekDates();
    const message = await getAvailableSlots(dates);
    return { message };
  }

  if (intent === "cancel") {
    return { intent, ...(await handleCancel(utterance, userId)) };
  }

  if (intent === "reserve") {
    return { intent, ...(await handleReserveLike(utterance, userId)) };
  }

  return {
    message: "다시 말씀해 주세요.",
  };
}

/* ---------------------------
 * 라우터
 * --------------------------- */

app.get("/", (req, res) => {
  res.send("ok");
});

app.post("/", async (req, res) => {
  try {
    const userId = getUserId(req.body);

    if (userId) {
      ensureMapping(userId).catch((err) => {
        console.error("ensureMapping error:", err);
      });
    }

    const result = await processRequest(req.body);

    res.json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: result.message,
            },
          },
        ],
      },
    });

    if (result.shouldSave) {
      saveReservation({
        date: result.date,
        time: result.time,
        userId: result.userId,
        name: result.name,
      })
        .then((scriptResult) => {
          console.log(
            "예약 기록 완료:",
            result.date,
            result.time,
            result.name,
            result.userId
          );
          console.log("예약 저장 응답:", scriptResult);
        })
        .catch((err) => {
          console.error("saveReservation error:", err);
        });
    }

    if (result.shouldCancel) {
      cancelReservation({
        date: result.date,
        userId: result.userId,
      })
        .then((scriptResult) => {
          console.log("예약 취소 완료:", result.date, result.userId);
          console.log("예약 취소 응답:", scriptResult);
        })
        .catch((err) => {
          console.error("cancelReservation error:", err);
        });
    }
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
