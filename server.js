const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbwmE6XyIGCzhtgdPtVTgwtE1sC_fWNNXVk20mU7irJch6S97ZpxlF41gdjEqhSV4_w/exec";

/**
 * 상담 연결 블록(인텐트) ID
 * 사용자가 준 URL:
 * https://chatbot.kakao.com/bot/69a948d47ba2f76e5b31be53/intent/69c107bd10164d295793bd15?scenarioId=69a9498e6de4b64be3c18801
 */
const COUNSEL_BLOCK_ID = "69c107bd10164d295793bd15";

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

function uniq(arr) {
  return [...new Set(arr)];
}

function formatDateShort(date) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${parseInt(m[2], 10)}월 ${parseInt(m[3], 10)}일`;
}

function appendFinalizeGuide(message, guideText) {
  const base = String(message || "").trim();
  const guide = String(guideText || "").trim();

  if (!guide) return base;
  if (!base) return guide;

  return `${base}\n${guide}`;
}

function getReserveFinalizeGuide() {
  return "아래 버튼을 눌러 예약을 마무리해주세요.";
}

function getCancelFinalizeGuide() {
  return "아래 버튼을 눌러 취소를 마무리해주세요.";
}

/**
 * 카카오 응답 생성
 * quickReply가 있으면 버튼 함께 전송
 */
function buildKakaoResponse(text, quickReply = null) {
  const response = {
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

  if (quickReply && quickReply.label && quickReply.blockId) {
    response.template.quickReplies = [
      {
        label: quickReply.label,
        action: "block",
        blockId: quickReply.blockId,
        extra: quickReply.extra || {},
      },
    ];
  }

  return response;
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

async function prepareReserveBulk({ dates, period, userId }) {
  return callScript(
    {
      action: "prepareReserveBulk",
      dates,
      period,
      userId,
    },
    10000
  );
}

async function reserveBulk({ items }) {
  return callScript(
    {
      action: "reserveBulk",
      items,
    },
    20000
  );
}

async function findReservationBulk({ dates, userId }) {
  return callScript(
    {
      action: "findReservationBulk",
      dates,
      userId,
    },
    10000
  );
}

async function cancelBulk({ items }) {
  return callScript(
    {
      action: "cancelBulk",
      items,
    },
    20000
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
      messages.push(`${successDates.map(formatDateShort).join(", ")} 예약 확정되셨습니다.`);
    }
  }

  if (closedDates.length > 0) {
    messages.push(`${closedDates.map(formatDateShort).join(", ")} 예약 마감되었습니다.`);
  }

  if (duplicateDates.length > 0) {
    messages.push(`${duplicateDates.map(formatDateShort).join(", ")}에는 이미 예약이 있습니다.`);
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
      messages.push(`${formatDateShort(successDates[0])} 예약 취소되셨습니다.`);
    } else {
      messages.push(`${successDates.map(formatDateShort).join(", ")} 예약 취소되셨습니다.`);
    }
  }

  if (notFoundDates.length > 0) {
    messages.push(`${notFoundDates.map(formatDateShort).join(", ")}에 취소할 예약이 없습니다.`);
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
      shouldSaveItems: [],
      quickReply: null,
    };
  }

  const precheck = await prepareReserveBulk({
    dates,
    period,
    userId,
  });

  console.log("prepareReserveBulk 결과:", precheck);

  if (!precheck.ok || !Array.isArray(precheck.results)) {
    return { noReply: true };
  }

  const successDates = [];
  const successItems = [];
  const closedDates = [];
  const duplicateDates = [];
  const failedDates = [];

  for (const item of precheck.results) {
    const date = item.date;

    if (!item.ok) {
      failedDates.push(date);
      continue;
    }

    if (item.result === "duplicate") {
      duplicateDates.push(date);
      continue;
    }

    if (item.result === "closed") {
      closedDates.push(date);
      continue;
    }

    if (item.result === "ok") {
      successDates.push(date);
      successItems.push({
        date,
        time: formatHour(hour),
        userId,
        name: item.name || precheck.name || "미등록",
        status: "예약완료",
      });
      continue;
    }

    failedDates.push(date);
  }

  let message = buildReserveMessage(
    successDates,
    closedDates,
    duplicateDates,
    failedDates
  );

  if (!message) {
    return { noReply: true };
  }

  let quickReply = null;

  if (successDates.length > 0) {
    message = appendFinalizeGuide(message, getReserveFinalizeGuide());
    quickReply = {
      label: "상담 연결",
      blockId: COUNSEL_BLOCK_ID,
      extra: {
        finalizeType: "reserve",
      },
    };
  }

  return {
    message,
    shouldSaveItems: successItems,
    quickReply,
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
      shouldCancelItems: [],
      quickReply: null,
    };
  }

  const found = await findReservationBulk({
    dates,
    userId,
  });

  console.log("findReservationBulk 결과:", found);

  if (!found.ok || !Array.isArray(found.results)) {
    return { noReply: true };
  }

  const successDates = [];
  const cancelItems = [];
  const notFoundDates = [];

  for (const item of found.results) {
    const date = item.date;

    if (item.ok && item.found) {
      successDates.push(date);
      cancelItems.push({
        date,
        userId,
      });
    } else {
      notFoundDates.push(date);
    }
  }

  let message = buildCancelMessage(successDates, notFoundDates);

  if (!message) {
    return { noReply: true };
  }

  let quickReply = null;

  if (successDates.length > 0) {
    message = appendFinalizeGuide(message, getCancelFinalizeGuide());
    quickReply = {
      label: "취소 마무리",
      blockId: COUNSEL_BLOCK_ID,
      extra: {
        finalizeType: "cancel",
      },
    };
  }

  return {
    message,
    shouldCancelItems: cancelItems,
    quickReply,
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

    res.json(buildKakaoResponse(result.message, result.quickReply));

    const userId = getUserId(req.body);

    if (userId) {
      ensureMapping(userId).catch((err) => {
        console.error("ensureMapping error:", err);
      });
    }

    if (Array.isArray(result.shouldSaveItems) && result.shouldSaveItems.length > 0) {
      reserveBulk({
        items: result.shouldSaveItems,
      })
        .then((bulkResult) => {
          console.log("reserveBulk 처리 결과:", bulkResult);
        })
        .catch((err) => {
          console.error("reserveBulk error:", err);
        });
    }

    if (Array.isArray(result.shouldCancelItems) && result.shouldCancelItems.length > 0) {
      cancelBulk({
        items: result.shouldCancelItems,
      })
        .then((bulkResult) => {
          console.log("cancelBulk 처리 결과:", bulkResult);
        })
        .catch((err) => {
          console.error("cancelBulk error:", err);
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
