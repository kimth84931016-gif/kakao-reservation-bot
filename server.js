const express = require("express");
const app = express();

app.use(express.json());

/**
 * 1) 예약 가능 여부 판단 시트 CSV
 *    시트명: 챗봇상태
 *    컬럼 예: 날짜,오전,오후
 */
const STATUS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

/**
 * 2) 예약 원본 시트 CSV
 *    시트명: 예약목록
 *    컬럼 예: 날짜,시간,이름,채팅방명,상태
 */
const RESERVATION_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=0&single=true&output=csv";

/**
 * 3) 채팅방명 매핑 시트 CSV
 *    시트명: 채팅방명 매핑
 *    컬럼 예: 채팅방명,표시이름
 */
const MAPPING_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=510794396&single=true&output=csv";

/**
 * 4) Apps Script 웹앱 URL
 */
const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbz2Ec2FfO_cnkagYdiY1qwK40A8igO4_EJi4Y7kq6jMYlX0J-G7mxImB8GaXadi1Q4/exec";

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

function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

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

function extractFromUtterance(utterance) {
  const text = String(utterance || "").trim();

  let date = null;
  let time = null;

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

  const hhmm = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (hhmm) {
    time = hhmm[1];
  } else {
    const h = text.match(/(오전|오후)?\s*\d{1,2}\s*시/);
    if (h) time = h[0];
  }

  return { date, time };
}

function detectIntent(utterance) {
  const text = String(utterance || "").trim();

  if (/취소/.test(text)) return "cancel";
  if (/가능|될까요|되나요|있을까요|있나요/.test(text)) return "check";
  if (/예약/.test(text)) return "reserve";

  return "unknown";
}

/**
 * 카카오 요청 payload에서 채팅방명 후보 찾기
 * 실제 field가 다르면 여기만 수정하면 됨
 */
function getRoomName(body) {
  return (
    body?.userRequest?.roomName ||
    body?.userRequest?.chatRoomName ||
    body?.userRequest?.channel?.name ||
    body?.action?.clientExtra?.roomName ||
    body?.context?.roomName ||
    body?.roomName ||
    null
  );
}

async function fetchCsvRows(url) {
  const response = await fetch(url);
  const text = await response.text();
  return parseCsvWithHeader(text);
}

async function getMappedName(roomName) {
  const rows = await fetchCsvRows(MAPPING_CSV_URL);
  const found = rows.find(
    (r) => String(r["채팅방명"] || "").trim() === String(roomName || "").trim()
  );

  if (!found) return null;
  return String(found["표시이름"] || "").trim() || null;
}

async function findExistingReservation(roomName, date) {
  const rows = await fetchCsvRows(RESERVATION_CSV_URL);

  return (
    rows.find((r) => {
      const rowDate = normalizeDate(r["날짜"]);
      const rowRoom = String(r["채팅방명"] || "").trim();
      const rowStatus = String(r["상태"] || "").trim();

      return (
        rowRoom === String(roomName || "").trim() &&
        rowDate === date &&
        rowStatus === "예약완료"
      );
    }) || null
  );
}

async function getAvailability(date, period) {
  const rows = await fetchCsvRows(STATUS_CSV_URL);

  const row = rows.find((r) => normalizeDate(r["날짜"]) === date);
  if (!row) return null;

  return String(row[period] || "").trim();
}

async function saveReservation({ date, time, roomName, name }) {
  const payload = {
    action: "reserve",
    date,
    time,
    name,
    roomName,
    status: "예약완료",
  };

  const response = await fetch(WRITE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await response.text();
  console.log("WRITE RESULT:", text);
  return text;
}

async function cancelReservation({ date, roomName }) {
  const payload = {
    action: "cancel",
    date,
    roomName,
  };

  const response = await fetch(WRITE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await response.text();
  console.log("CANCEL RESULT:", text);
  return text;
}

/* ---------------------------
 * 비즈니스 로직
 * --------------------------- */

async function handleCheck(utterance) {
  const extracted = extractFromUtterance(utterance);
  const date = normalizeDate(extracted.date);
  const hour = normalizeHour(extracted.time);
  const period = getPeriod(hour);

  console.log("CHECK utterance:", utterance);
  console.log("CHECK extracted:", extracted);
  console.log("CHECK normalized date:", date);
  console.log("CHECK hour:", hour);
  console.log("CHECK period:", period);

  if (!date || period === null) {
    return {
      message: "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 13시 예약 가능할까요?",
    };
  }

  const status = await getAvailability(date, period);

  if (status === "가능") {
    return {
      message: `${date} ${formatHour(hour)} 예약 가능합니다.`,
    };
  }

  if (status === "마감") {
    return {
      message: `${date} ${formatHour(hour)}은(는) 예약 마감되었습니다.`,
    };
  }

  return {
    message: "담당자 확인 후 연락드리겠습니다.",
  };
}

async function handleReserve(utterance, roomName) {
  const extracted = extractFromUtterance(utterance);
  const date = normalizeDate(extracted.date);
  const hour = normalizeHour(extracted.time);
  const period = getPeriod(hour);

  console.log("RESERVE utterance:", utterance);
  console.log("RESERVE extracted:", extracted);
  console.log("RESERVE normalized date:", date);
  console.log("RESERVE hour:", hour);
  console.log("RESERVE period:", period);
  console.log("RESERVE roomName:", roomName);

  if (!roomName) {
    return {
      message: "채팅방 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다.",
      shouldSave: false,
    };
  }

  if (!date || period === null) {
    return {
      message: "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 13시 예약할게요",
      shouldSave: false,
    };
  }

  // 하루 1건 제한: 같은 채팅방 + 같은 날짜 + 예약완료 이미 있으면 막기
  const existing = await findExistingReservation(roomName, date);
  if (existing) {
    return {
      message: `${date}에는 이미 예약이 있습니다. 하루에 1건만 예약 가능합니다.`,
      shouldSave: false,
    };
  }

  const status = await getAvailability(date, period);

  if (status === "마감") {
    return {
      message: `${date} ${formatHour(hour)}은(는) 예약 마감되었습니다.`,
      shouldSave: false,
    };
  }

  if (status !== "가능") {
    return {
      message: "담당자 확인 후 연락드리겠습니다.",
      shouldSave: false,
    };
  }

  const mappedName = await getMappedName(roomName);
  const name = mappedName || "이름미등록";

  return {
    message: `${date} ${formatHour(hour)} 예약이 확정되었습니다.`,
    shouldSave: true,
    date,
    time: formatHour(hour),
    roomName,
    name,
  };
}

async function handleCancel(utterance, roomName) {
  const extracted = extractFromUtterance(utterance);
  const date = normalizeDate(extracted.date);

  console.log("CANCEL utterance:", utterance);
  console.log("CANCEL extracted:", extracted);
  console.log("CANCEL normalized date:", date);
  console.log("CANCEL roomName:", roomName);

  if (!roomName) {
    return {
      message: "채팅방 정보를 확인할 수 없어 담당자 확인 후 연락드리겠습니다.",
      shouldCancel: false,
    };
  }

  if (!date) {
    return {
      message: "취소할 날짜를 함께 말씀해 주세요. 예: 3월 17일 예약 취소할게요",
      shouldCancel: false,
    };
  }

  const existing = await findExistingReservation(roomName, date);

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
    roomName,
  };
}

async function processRequest(body) {
  const utterance = body?.userRequest?.utterance || "";
  const roomName = getRoomName(body);
  const intent = detectIntent(utterance);

  console.log("intent:", intent);
  console.log("roomName:", roomName);

  if (intent === "cancel") {
    return { intent, ...(await handleCancel(utterance, roomName)) };
  }

  if (intent === "check") {
    return { intent, ...(await handleCheck(utterance)) };
  }

  if (intent === "reserve") {
    return { intent, ...(await handleReserve(utterance, roomName)) };
  }

  return {
    intent: "unknown",
    message: "예약 가능 조회, 예약, 취소 중 어떤 요청인지 다시 말씀해 주세요.",
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
    // 필요하면 처음 1~2회만 켜서 실제 payload 구조 확인
    // console.log(JSON.stringify(req.body, null, 2));

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
        roomName: result.roomName,
        name: result.name,
      })
        .then(() => {
          console.log(
            "예약 기록 완료:",
            result.date,
            result.time,
            result.name,
            result.roomName
          );
        })
        .catch((err) => {
          console.error("saveReservation error:", err);
        });
    }

    if (result.shouldCancel) {
      cancelReservation({
        date: result.date,
        roomName: result.roomName,
      })
        .then(() => {
          console.log("예약 취소 완료:", result.date, result.roomName);
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
