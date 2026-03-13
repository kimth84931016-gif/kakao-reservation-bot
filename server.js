const express = require("express");
const app = express();

app.use(express.json());

const STATUS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbyKHS3G5ohU4iiVmII4q_YHtmy-UqrLwXucdxN-VsRFe3axvK0zF_PTUCuuR0NY0SoS/exec";

/* -------------------- 공통 -------------------- */

const pad = (n) => String(n).padStart(2, "0");
const today = () => new Date();

const getUserId = (body) => body?.userRequest?.user?.id || null;
const getUtterance = (body) => body?.userRequest?.utterance || "";

function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const split = (line) => {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], next = line[i + 1];
      if (ch === '"') {
        if (q && next === '"') cur += '"', i++;
        else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = split(line);
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] || ""]));
  });
}

async function fetchRows(url) {
  const res = await fetch(url);
  return parseCsv(await res.text());
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const now = today();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${now.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;

  m = s.match(/(\d{1,2})\s*일/);
  if (m) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`;

  return null;
}

function normalizeHour(v) {
  if (!v) return null;
  const s = String(v).trim();

  if (s === "오전") return 9;
  if (s === "오후") return 13;

  let m = s.match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (m) return +m[1];

  m = s.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (m) {
    let h = +m[2];
    if (m[1] === "오후" && h < 12) h += 12;
    if (m[1] === "오전" && h === 12) h = 0;
    return h;
  }

  if (/^\d{1,2}$/.test(s)) return +s;
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
  let date = null, time = null;

  const ymd = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const dOnly = s.match(/(\d{1,2})\s*일/);
  const hhmm = s.match(/\d{1,2}:\d{2}(?::\d{2})?/);
  const htxt = s.match(/(오전|오후)?\s*\d{1,2}\s*시/);

  if (ymd) date = `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`;
  else if (md) date = `${today().getFullYear()}-${pad(md[1])}-${pad(md[2])}`;
  else if (dOnly) date = `${today().getFullYear()}-${pad(today().getMonth() + 1)}-${pad(dOnly[1])}`;

  if (hhmm) time = hhmm[0];
  else if (htxt) time = htxt[0];
  else if (/오전/.test(s)) time = "오전";
  else if (/오후/.test(s)) time = "오후";

  return { date, time };
}

function extractDates(text) {
  const now = today();
  return [...String(text || "").matchAll(/(\d{1,2})\s*일/g)].map(
    (m) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m[1])}`
  );
}

function next7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function detectIntent(text) {
  const s = String(text || "").trim();
  if (/취소/.test(s)) return "cancel";
  if (/이번주/.test(s)) return "week";
  if (/남는 시간|가능한 시간대|예약 가능한 시간/.test(s) && /\d{1,2}일/.test(s)) return "single";
  if (/가능|남는 시간|가능한 날/.test(s) && /\d+일.*\d+일/.test(s)) return "multi";
  if (/예약/.test(s)) return "reserve";
  return "unknown";
}

/* -------------------- Apps Script -------------------- */

async function callScript(payload) {
  const res = await fetch(WRITE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await res.text();
  console.log("SCRIPT RAW RESULT:", text);

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, message: "Apps Script가 JSON이 아닌 응답을 반환했습니다.", raw: text };
  }
}

const ensureMapping = (userId) => callScript({ action: "ensureMapping", userId });

async function getMappedName(userId) {
  const r = await callScript({ action: "getName", userId });
  return r.ok ? String(r.name || "").trim() || null : null;
}

async function findReservation(userId, date) {
  const r = await callScript({ action: "findReservation", userId, date });
  return r.ok && r.found ? r.row || { found: true } : null;
}

const saveReservation = ({ date, time, userId, name }) =>
  callScript({ action: "reserve", date, time, name, userId, status: "예약완료" });

const cancelReservation = ({ date, userId }) =>
  callScript({ action: "cancel", date, userId });

/* -------------------- 상태 조회 -------------------- */

async function getRowsByDate() {
  const rows = await fetchRows(STATUS_CSV_URL);
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

async function getSingleDateSlots(date) {
  const map = await getRowsByDate();
  const row = map[date];
  if (!row) return "해당 날짜의 예약 정보를 찾지 못했습니다.";

  const slots = getAvailablePeriods(row);
  return slots.length
    ? `${date} 예약 가능한 시간은 ${slots.join(", ")} 입니다.`
    : `${date}에는 예약 가능한 시간이 없습니다.`;
}

async function getMultiDateSlots(dates) {
  const map = await getRowsByDate();
  const lines = dates
    .map((date) => {
      const slots = getAvailablePeriods(map[date]);
      return slots.length ? `${date} (${slots.join(", ")})` : null;
    })
    .filter(Boolean);

  return lines.length
    ? `예약 가능한 시간\n\n${lines.join("\n")}`
    : "현재 예약 가능한 시간이 없습니다.";
}

async function getAvailability(date, period) {
  const map = await getRowsByDate();
  return String(map[date]?.[period] || "").trim() || null;
}

/* -------------------- 처리 -------------------- */

async function handleReserve(utterance, userId) {
  const { date, time } = extractDateTime(utterance);
  const hour = normalizeHour(time);
  const period = getPeriod(hour);

  console.log("RESERVE:", { utterance, date, time, hour, period, userId });

  if (!userId) {
    return { message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다." };
  }

  if (!date || !period) {
    return {
      message: "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 오전 예약할게요 / 3월 13일 13시 예약할게요",
    };
  }

  if (await findReservation(userId, date)) {
    return { message: `${date}에는 이미 예약이 있습니다. 하루에 1건만 예약 가능합니다.` };
  }

  const status = await getAvailability(date, period);
  if (status === "마감") return { message: "예약 마감되었습니다." };
  if (status !== "가능") return { message: "담당자 확인 후 연락드리겠습니다." };

  return {
    message: "예약 확정되셨습니다.",
    shouldSave: true,
    date,
    time: formatHour(hour),
    userId,
    name: (await getMappedName(userId)) || "미등록",
  };
}

async function handleCancel(utterance, userId) {
  const { date } = extractDateTime(utterance);

  console.log("CANCEL:", { utterance, date, userId });

  if (!userId) {
    return { message: "사용자 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다." };
  }

  if (!date) {
    return { message: "취소할 날짜를 함께 말씀해 주세요. 예: 3월 17일 예약 취소할게요" };
  }

  if (!(await findReservation(userId, date))) {
    return { message: `${date}에 취소할 예약이 없습니다.` };
  }

  return {
    message: `${date} 예약이 취소되었습니다.`,
    shouldCancel: true,
    date,
    userId,
  };
}

async function processRequest(body) {
  const utterance = getUtterance(body);
  const userId = getUserId(body);
  const intent = detectIntent(utterance);

  console.log("intent:", intent, "userId:", userId);

  if (intent === "single") {
    const { date } = extractDateTime(utterance);
    return { message: await getSingleDateSlots(normalizeDate(date)) };
  }

  if (intent === "multi") {
    return { message: await getMultiDateSlots(extractDates(utterance)) };
  }

  if (intent === "week") {
    return { message: await getMultiDateSlots(next7Days()) };
  }

  if (intent === "cancel") return handleCancel(utterance, userId);
  if (intent === "reserve") return handleReserve(utterance, userId);

  return { message: "다시 말씀해 주세요." };
}

/* -------------------- 라우터 -------------------- */

app.get("/", (_, res) => res.send("ok"));

app.post("/", async (req, res) => {
  try {
    const userId = getUserId(req.body);
    if (userId) ensureMapping(userId).catch((e) => console.error("ensureMapping error:", e));

    const result = await processRequest(req.body);

    res.json({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: result.message } }],
      },
    });

    if (result.shouldSave) {
      saveReservation(result)
        .then((r) => {
          console.log("예약 기록 완료:", result.date, result.time, result.name, result.userId);
          console.log("예약 저장 응답:", r);
        })
        .catch((e) => console.error("saveReservation error:", e));
    }

    if (result.shouldCancel) {
      cancelReservation(result)
        .then((r) => {
          console.log("예약 취소 완료:", result.date, result.userId);
          console.log("예약 취소 응답:", r);
        })
        .catch((e) => console.error("cancelReservation error:", e));
    }
  } catch (error) {
    console.error(error);
    res.json({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: "담당자 확인 후 연락드리겠습니다." } }],
      },
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("server start"));
