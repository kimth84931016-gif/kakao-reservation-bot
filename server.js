const express = require("express");
const app = express();

app.use(express.json());

const STATUS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbyqecTeJ79PJou1hmU7mHUvCRqd-zfWoTGkop2rsiSInjSAqd5Q40x-9z4mVNCuS4I3/exec";

/* -------------------- 공통 -------------------- */

const pad = (n) => String(n).padStart(2, "0");

function getUserId(body) {
  return body?.userRequest?.user?.id || null;
}

function getUtterance(body) {
  return String(body?.userRequest?.utterance || "").trim();
}

function cleanMessage(text) {
  return String(text || "")
    .replace(/\n+\.$/, ".")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function kakaoResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: cleanMessage(text),
          },
        },
      ],
    },
  };
}

/* -------------------- CSV -------------------- */

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

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (cols[idx] || "").trim();
    });
    return row;
  });
}

async function fetchCsvRows(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCsvWithHeader(text);
}

/* -------------------- 날짜/시간 -------------------- */

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const now = new Date();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${now.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;

  m = s.match(/(?:^|\s)(\d{1,2})\s*일(?:\s|$)/);
  if (m) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`;

  return null;
}

function normalizeHour(value) {
  if (!value) return null;
  const s = String(value).trim();

  if (s === "오전") return 9;
  if (s === "오후") return 13;

  let m = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (m) return parseInt(m[1], 10);

  m = s.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (m) {
    let hour = parseInt(m[2], 10);
    if (m[1] === "오후" && hour < 12) hour += 12;
    if (m[1] === "오전" && hour === 12) hour = 0;
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
  return `${pad(hour)}:00`;
}

function extractDateTime(text) {
  const s = String(text || "").trim();
  const now = new Date();

  let date = null;
  let time = null;
  let m = null;

  m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  if (!date) {
    m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) date = `${now.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  }

  if (!date) {
    m = s.match(/(?:^|\s)(\d{1,2})\s*일(?:\s|$)/);
    if (m) date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`;
  }

  m = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (m) time = m[1];

  if (!time) {
    m = s.match(/(오전|오후)?\s*\d{1,2}\s*시/);
    if (m) time = m[0];
  }

  if (!time) {
    if (/오전/.test(s)) time = "오전";
    else if (/오후/.test(s)) time = "오후";
  }

  return { date, time };
}

function extractMultipleDates(text) {
  const now = new Date();
  return [...String(text || "").matchAll(/(\d{1,2})\s*일/g)].map(
    (m) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`
  );
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

/* -------------------- intent -------------------- */

function detectIntent(text) {
  const s = String(text || "").trim();

  if (/취소/.test(s)) return "cancel";
  if (/이번주/.test(s)) return "week";

  if (
    /남는 시간|가능한 시간대|예약 가능한 시간/.test(s) &&
    /(\d{1,2}\s*일|\d{1,2}\s*월\s*\d{1,2}\s*일)/.test(s)
  ) {
    return "single";
  }

  if (/가능|남는 시간|가능한 날/.test(s) && /\d+일.*\d+일/.test(s)) {
    return "multi";
  }

  if (/예약/.test(s)) return "reserve";

  return "unknown";
}

/* -------------------- Apps Script -------------------- */

async function callScript(payload) {
  try {
    const response = await fetch(WRITE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });

    const text = await response.text();
    console.log("SCRIPT RAW RESULT:", payload.action, text);

    try {
      return JSON.parse(text);
    } catch {
      return {
        ok: false,
        message: "Apps Script가 JSON이 아닌 응답을 반환했습니다.",
        raw: text,
      };
    }
  } catch (err) {
    console.error("callScript error:", err);
    return {
      ok: false,
      message: "Apps Script 호출 실패",
    };
  }
}

async function ensureMapping(userId) {
  return callScript({ action: "ensureMapping", userId });
}

async function getMappedName(userId) {
  const result = await callScript({ action: "getName", userId });
  if (!result.ok) return null;
  return String(result.name || "").trim() || null;
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

/* -------------------- 상태 조회 -------------------- */

async function getRowsByDate() {
  const rows = await fetchCsvRows(STATUS_CSV_URL);
  return rows.reduce((acc, row) => {
    const date = normalizeDate(row["날짜"]);
    if (date) acc[date] = row;
    return acc;
  }, {});
}

function getAvailablePeriods(row) {
  const slots = [];
  if (String(row?.["오전"] || "").trim() === "가능") slots.push("오전");
  if (String(row?.["오후"] || "").trim() === "가능") slots.push("오후");
  return slots;
}

async function getAvailability(date, period) {
  const map = await getRowsByDate();
  return String(map[date]?.[period] || "").trim() || null;
}

async function getSingleDateSlots(date) {
  if (!date) return "날짜를 다시 말씀해 주세요. 예: 13일 가능한 시간";

  const map = await getRowsByDate();
  const row = map[date];
  if (!row) return "해당 날짜의 예약 정보를 찾지 못했습니다.";

  const slots = getAvailablePeriods(row);
  if (!slots.length) return `${date}에는 예약 가능한 시간이 없습니다.`;

  return `${date} 예약 가능한 시간은 ${slots.join(", ")} 입니다.`;
}

async function getAvailableSlots(dates) {
  const map = await getRowsByDate();
  const result = [];

  for (const date of dates) {
    const row = map[date];
    if (!row) continue;

    const slots = getAvailablePeriods(row);
    if (slots.length) result.push(`${date} (${slots.join(", ")})`);
  }

  if (!result.length) return "현재 예약 가능한 시간이 없습니다.";
  return `예약 가능한 시간\n${result.join("\n")}`;
}

/* -------------------- 로직 -------------------- */

async function handleReserve(utterance, userId) {
  const extracted = extractDateTime(utterance);
  const date = normalizeDate(extracted.date);
  const hour = normalizeHour(extracted.time);
  const period = getPeriod(hour);

  console.log("RESERVE:", { utterance, userId, extracted, date, hour, period });

  if (!userId) {
    return { message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다." };
  }

  if (!date || !period) {
    return {
      message: "날짜와 시간을 정확히 말씀해 주세요. 예: 13일 오전 예약 / 13일 13시 예약",
    };
  }

  const status = await getAvailability(date, period);

  if (status === "마감") return { message: "예약 마감되었습니다." };
  if (status !== "가능") return { message: "담당자 확인 후 연락드리겠습니다." };

  const name = (await getMappedName(userId)) || "미등록";
  const saved = await saveReservation({
    date,
    time: formatHour(hour),
    userId,
    name,
  });

  if (!saved.ok) {
    return { message: saved.message || "예약 처리 중 오류가 발생했습니다. 다시 시도해 주세요." };
  }

  return { message: "예약 확정되셨습니다." };
}

async function handleCancel(utterance, userId) {
  const extracted = extractDateTime(utterance);
  const date = normalizeDate(extracted.date);

  console.log("CANCEL:", { utterance, userId, extracted, date });

  if (!userId) {
    return { message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다." };
  }

  if (!date) {
    return { message: "취소할 날짜를 함께 말씀해 주세요. 예: 13일 예약 취소" };
  }

  const canceled = await cancelReservation({ date, userId });

  if (!canceled.ok) {
    return { message: canceled.message || "취소 처리 중 오류가 발생했습니다. 다시 시도해 주세요." };
  }

  return { message: `${date} 예약이 취소되었습니다.` };
}

async function processRequest(body) {
  const utterance = getUtterance(body);
  const userId = getUserId(body);
  const intent = detectIntent(utterance);

  console.log("intent:", intent);
  console.log("userId:", userId);
  console.log("utterance:", utterance);

  if (intent === "single") {
    const { date } = extractDateTime(utterance);
    return { message: await getSingleDateSlots(normalizeDate(date)) };
  }

  if (intent === "multi") {
    return { message: await getAvailableSlots(extractMultipleDates(utterance)) };
  }

  if (intent === "week") {
    return { message: await getAvailableSlots(getThisWeekDates()) };
  }

  if (intent === "cancel") {
    return await handleCancel(utterance, userId);
  }

  if (intent === "reserve") {
    return await handleReserve(utterance, userId);
  }

  return { message: "다시 말씀해 주세요." };
}

/* -------------------- 라우터 -------------------- */

app.get("/", (_, res) => {
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
    return res.json(kakaoResponse(result.message));
  } catch (err) {
    console.error("POST / error:", err);
    return res.json(kakaoResponse("담당자 확인 후 연락드리겠습니다."));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("server start");
});
