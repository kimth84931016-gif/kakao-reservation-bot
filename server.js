const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbw_2W5WUG3VFjH4t-hSKHMwuqeLxC4m3yUQQDpE5XV6gc3jtBi7AObTMKxftNZCejNb/exec";

/* ---------------------------
 * 공통 유틸
 * --------------------------- */

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

function getUserId(body) {
  return body?.userRequest?.user?.id || null;
}

function detectIntent(text) {
  const utterance = String(text || "").trim();

  if (/취소/.test(utterance)) return "cancel";
  if (/예약/.test(utterance)) return "reserve";

  return "unknown";
}

function buildKakaoResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: String(text || ""),
          },
        },
      ],
    },
  };
}

function uniq(arr) {
  return [...new Set(arr)];
}

function formatDateShort(date) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${parseInt(m[2], 10)}월 ${parseInt(m[3], 10)}일`;
}

/* ---------------------------
 * 복수 날짜 추출
 * --------------------------- */

function extractDatesFromUtterance(text) {
  const utterance = String(text || "").trim();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const dates = [];

  const ymdRegex = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  let match;
  while ((match = ymdRegex.exec(utterance)) !== null) {
    dates.push(
      `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`
    );
  }

  if (dates.length > 0) return uniq(dates);

  const mdRegex = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while ((match = mdRegex.exec(utterance)) !== null) {
    dates.push(
      `${currentYear}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`
    );
  }

  if (dates.length > 0) return uniq(dates);

  const dayOnlyRegex = /(\d{1,2})\s*일/g;
  while ((match = dayOnlyRegex.exec(utterance)) !== null) {
    dates.push(
      `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`
    );
  }

  return uniq(dates);
}

function extractTimeFromUtterance(text) {
  const utterance = String(text || "").trim();

  const hhmm = utterance.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (hhmm) return hhmm[1];

  const hourText = utterance.match(/(오전|오후)?\s*\d{1,2}\s*시/);
  if (hourText) return hourText[0];

  if (/오전/.test(utterance)) return "오전";
  if (/오후/.test(utterance)) return "오후";

  return null;
}

/* ---------------------------
 * Apps Script 호출
 * --------------------------- */

async function callScript(payload, timeoutMs = 7000) {
  try {
    const response = await fetchWithTimeout(
      WRITE_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "follow",
      },
      timeoutMs
    );

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
  } catch (err) {
    console.error("callScript error:", err);
    return {
      ok: false,
      message: "Apps Script 호출 실패",
      error: String(err),
    };
  }
}

async function ensureMapping(userId) {
  return callScript(
    {
      action: "ensureMapping",
      userId,
    },
    7000
  );
}

async function prepareReserve({ date, period, userId }) {
  return callScript(
    {
      action: "prepareReserve",
      date,
      period,
      userId,
    },
    7000
  );
}

async function findExistingReservation(userId, date) {
  return callScript(
    {
      action: "findReservation",
      userId,
      date,
    },
    7000
  );
}

async function saveReservation({ date, time, userId, name }) {
  return callScript(
    {
      action: "reserve",
      date,
      time,
      name,
      userId,
      status: "예약완료",
    },
    12000
  );
}

async function cancelReservation({ date, userId }) {
  return callScript(
    {
      action: "cancel",
      date,
      userId,
    },
    12000
  );
}

/* ---------------------------
 * 문구 조합
 * --------------------------- */

function buildReserveMessage(successDates, closedDates, duplicateDates, failedDates) {
  const messages = [];

  if (successDates.length > 0) {
    if (successDates.length === 1) {
      messages.push(`${formatDateShort(successDates[0])} 예약 확정되셨습니다.`);
    } else {
      messages.push(
        `${successDates.map(formatDateShort).join(", ")} 예약 확정되셨습니다.`
      );
    }
  }

  if (closedDates.length > 0) {
    messages.push(`${closedDates.map(formatDateShort).join(", ")} 예약 마감되었습니다.`);
  }

  if (duplicateDates.length > 0) {
    messages.push(
      `${duplicateDates.map(formatDateShort).join(", ")}에는 이미 예약이 있습니다.`
    );
  }

  if (failedDates.length > 0 && messages.length === 0) {
    return null;
  }

  return messages.join("\n");
}

function buildCancelMessage(successDates, notFoundDates) {
  const messages = [];

  if (successDates.length > 0) {
    if (successDates.length === 1) {
      messages.push(`${successDates[0]} 예약 취소되셨습니다.`);
    } else {
      messages.push(`${successDates.join(", ")} 예약 취소되셨습니다.`);
    }
  }

  if (notFoundDates.length > 0) {
    messages.push(`${notFoundDates.join(", ")}에 취소할 예약이 없습니다.`);
  }

  if (messages.length === 0) return null;
  return messages.join("\n");
}

/* ---------------------------
 * 비즈니스 로직
 * --------------------------- */

async function handleReserveLike(utterance, userId) {
  const dates = extractDatesFromUtterance(utterance);
  const rawTime = extractTimeFromUtterance(utterance);
  const hour = normalizeHour(rawTime);
  const period = getPeriod(hour);

  console.log("RESERVE utterance:", utterance);
  console.log("RESERVE dates:", dates);
  console.log("RESERVE rawTime:", rawTime);
  console.log("RESERVE hour:", hour);
  console.log("RESERVE period:", period);
  console.log("RESERVE userId:", userId);

  if (!userId) {
    return { noReply: true };
  }

  if (!dates.length || period === null) {
    return {
      message:
        "날짜와 시간을 정확히 말씀해 주세요. 예: 3월 13일 오전 예약할게요 / 3월 13일 13시 예약할게요 / 20일 21일 13시 예약할게요",
      shouldSaveList: [],
    };
  }

  const successDates = [];
  const successItems = [];
  const closedDates = [];
  const duplicateDates = [];
  const failedDates = [];

  for (const date of dates) {
    try {
      const precheck = await prepareReserve({
        date,
        period,
        userId,
      });

      console.log("prepareReserve 결과:", date, precheck);

      if (!precheck.ok) {
        failedDates.push(date);
        continue;
      }

      if (precheck.result === "duplicate") {
        duplicateDates.push(date);
        continue;
      }

      if (precheck.result === "closed") {
        closedDates.push(date);
        continue;
      }

      if (precheck.result !== "ok") {
        failedDates.push(date);
        continue;
      }

      successDates.push(date);
      successItems.push({
        date,
        time: formatHour(hour),
        userId,
        name: precheck.name || "미등록",
      });
    } catch (err) {
      console.error("handleReserveLike item error:", date, err);
      failedDates.push(date);
    }
  }

  const message = buildReserveMessage(
    successDates,
    closedDates,
    duplicateDates,
    failedDates
  );

  if (!message) {
    return { noReply: true };
  }

  return {
    message,
    shouldSaveList: successItems,
  };
}

async function handleCancel(utterance, userId) {
  const dates = extractDatesFromUtterance(utterance);

  console.log("CANCEL utterance:", utterance);
  console.log("CANCEL dates:", dates);
  console.log("CANCEL userId:", userId);

  if (!userId) {
    return { noReply: true };
  }

  if (!dates.length) {
    return {
      message: "취소할 날짜를 함께 말씀해 주세요. 예: 3월 17일 예약 취소할게요 / 19일 20일 예약 취소할게요",
      shouldCancelList: [],
    };
  }

  const successDates = [];
  const cancelItems = [];
  const notFoundDates = [];

  for (const date of dates) {
    try {
      const existing = await findExistingReservation(userId, date);
      console.log("findReservation 결과:", date, existing);

      if (!existing.ok) {
        continue;
      }

      if (!existing.found) {
        notFoundDates.push(date);
        continue;
      }

      successDates.push(date);
      cancelItems.push({
        date,
        userId,
      });
    } catch (err) {
      console.error("handleCancel item error:", date, err);
    }
  }

  const message = buildCancelMessage(successDates, notFoundDates);

  if (!message) {
    return { noReply: true };
  }

  return {
    message,
    shouldCancelList: cancelItems,
  };
}

async function processRequest(body) {
  const utterance = body?.userRequest?.utterance || "";
  const userId = getUserId(body);
  const intent = detectIntent(utterance);

  console.log("intent:", intent);
  console.log("userId:", userId);

  if (intent === "cancel") {
    return { intent, ...(await handleCancel(utterance, userId)) };
  }

  if (intent === "reserve") {
    return { intent, ...(await handleReserveLike(utterance, userId)) };
  }

  return {
    intent: "unknown",
    noReply: true,
  };
}

/* ---------------------------
 * 공통 핸들러
 * --------------------------- */

async function handleWebhook(req, res) {
  try {
    const utterance = req.body?.userRequest?.utterance || "";
    const intent = detectIntent(utterance);

    console.log("incoming utterance:", utterance);
    console.log("detected intent:", intent);

    if (intent === "unknown") {
      return res.status(204).end();
    }

    const result = await processRequest(req.body);

    if (result.noReply) {
      return res.status(204).end();
    }

    res.json(buildKakaoResponse(result.message));

    const userId = getUserId(req.body);

    if (userId) {
      ensureMapping(userId).catch((err) => {
        console.error("ensureMapping error:", err);
      });
    }

    if (Array.isArray(result.shouldSaveList) && result.shouldSaveList.length > 0) {
      Promise.allSettled(
        result.shouldSaveList.map((item) =>
          saveReservation({
            date: item.date,
            time: item.time,
            userId: item.userId,
            name: item.name,
          })
        )
      )
        .then((results) => {
          console.log("복수 예약 기록 완료:", results);
        })
        .catch((err) => {
          console.error("saveReservation list error:", err);
        });
    }

    if (Array.isArray(result.shouldCancelList) && result.shouldCancelList.length > 0) {
      Promise.allSettled(
        result.shouldCancelList.map((item) =>
          cancelReservation({
            date: item.date,
            userId: item.userId,
          })
        )
      )
        .then((results) => {
          console.log("복수 예약 취소 처리 결과:", results);
        })
        .catch((err) => {
          console.error("cancelReservation list error:", err);
        });
    }
  } catch (error) {
    console.error("handleWebhook error:", error);
    return res.status(204).end();
  }
}

/* ---------------------------
 * 라우터
 * --------------------------- */

app.get("/", (req, res) => {
  res.send("ok");
});

app.post("/", handleWebhook);
app.post("/webhook", handleWebhook);

app.listen(PORT, () => {
  console.log(`server start on ${PORT}`);
});
