const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbyI2bLRMzsLz-5cBTFdy_Hapb7NdzKOS6H1CaealHDFztnaULyQPLW2K23NeMQBjY6V/exec";

/* ---------------------------
 * 공통 유틸
 * --------------------------- */

function safeString(v) {
  return String(v || "").trim();
}

function getNested(obj, paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = obj;
    let ok = true;

    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        ok = false;
        break;
      }
    }

    if (ok && cur != null) return cur;
  }
  return "";
}

function extractUtterance(body) {
  return safeString(
    getNested(body, [
      "userRequest.utterance",
      "utterance",
      "message",
      "text"
    ])
  );
}

function extractUserId(body) {
  return safeString(
    getNested(body, [
      "userRequest.user.id",
      "user.id",
      "userId",
      "action.params.userId"
    ])
  );
}

function jsonResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text
          }
        }
      ]
    }
  };
}

function isCancelIntent(text) {
  return /취소/.test(text);
}

function isReserveIntent(text) {
  return /예약/.test(text);
}

function getKstNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = ("0" + (date.getMonth() + 1)).slice(-2);
  const d = ("0" + date.getDate()).slice(-2);
  return `${y}-${m}-${d}`;
}

function extractDateTime(utterance) {
  const text = safeString(utterance);
  const now = getKstNow();

  let date = "";
  let time = "";
  let hour = null;
  let period = "";

  if (/내일/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    date = formatDateYYYYMMDD(d);
  } else {
    let m = text.match(/(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?/);
    if (m) {
      date = `${m[1]}-${("0" + m[2]).slice(-2)}-${("0" + m[3]).slice(-2)}`;
    } else {
      m = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
      if (m) {
        date = `${now.getFullYear()}-${("0" + m[1]).slice(-2)}-${("0" + m[2]).slice(-2)}`;
      } else {
        m = text.match(/(\d{1,2})일/);
        if (m) {
          date = `${now.getFullYear()}-${("0" + (now.getMonth() + 1)).slice(-2)}-${("0" + m[1]).slice(-2)}`;
        }
      }
    }
  }

  if (/오후|PM|pm/.test(text)) period = "오후";
  if (/오전|AM|am/.test(text)) period = "오전";

  let tm = text.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/);
  if (tm) {
    hour = parseInt(tm[1], 10);
    const minute = parseInt(tm[2] || "0", 10);

    if (period === "오후" && hour < 12) hour += 12;
    if (period === "오전" && hour === 12) hour = 0;

    time = `${("0" + hour).slice(-2)}:${("0" + minute).slice(-2)}`;
  } else {
    tm = text.match(/(\d{1,2}):(\d{2})/);
    if (tm) {
      hour = parseInt(tm[1], 10);
      const minute = parseInt(tm[2], 10);

      if (period === "오후" && hour < 12) hour += 12;
      if (period === "오전" && hour === 12) hour = 0;

      time = `${("0" + hour).slice(-2)}:${("0" + minute).slice(-2)}`;
    }
  }

  return { date, time, hour, period };
}

/* ---------------------------
 * Apps Script 호출
 * --------------------------- */

async function postToScript(payload) {
  const res = await fetch(WRITE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  console.log("SCRIPT RAW RESULT:", raw);

  try {
    return JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      message: "Apps Script JSON 파싱 실패",
      raw
    };
  }
}

async function writeSheetLog({
  logAction = "",
  userId = "",
  result = "",
  datetime = "",
  memo = ""
}) {
  return postToScript({
    action: "writeLog",
    logAction,
    userId,
    result,
    datetime,
    memo
  });
}

function fireAndForgetLog(payload) {
  writeSheetLog(payload).catch((err) => {
    console.error("writeSheetLog error:", err.message);
  });
}

async function ensureMapping(userId) {
  return await postToScript({
    action: "ensureMapping",
    userId
  });
}

async function getName(userId) {
  return await postToScript({
    action: "getName",
    userId
  });
}

async function findReservation(date, userId) {
  return await postToScript({
    action: "findReservation",
    date,
    userId
  });
}

async function reserve(date, time, name, userId) {
  return await postToScript({
    action: "reserve",
    date,
    time,
    name,
    userId,
    status: "예약완료"
  });
}

async function cancel(date, userId) {
  return await postToScript({
    action: "cancel",
    date,
    userId
  });
}

/* ---------------------------
 * 메인 처리
 * --------------------------- */

app.get("/", (req, res) => {
  res.send("OK");
});

async function handleWebhook(req, res) {
  try {
    const body = req.body || {};
    const utterance = extractUtterance(body);
    const userId = extractUserId(body);

    console.log("utterance:", utterance);
    console.log("userId:", userId);

    fireAndForgetLog({
      logAction: "utterance",
      userId,
      result: "received",
      datetime: "",
      memo: utterance
    });

    if (!utterance || !userId) {
      fireAndForgetLog({
        logAction: "validation",
        userId,
        result: "fail",
        datetime: "",
        memo: "utterance 또는 userId 누락"
      });

      return res.json(jsonResponse("요청 정보를 확인할 수 없습니다."));
    }

    const parsed = extractDateTime(utterance);

    console.log("extracted:", parsed);

    fireAndForgetLog({
      logAction: "extract",
      userId,
      result: parsed.date && parsed.time ? "parsed" : "fail",
      datetime: parsed.date && parsed.time ? `${parsed.date} ${parsed.time}` : "",
      memo: JSON.stringify(parsed)
    });

    if (!parsed.date) {
      const replyText = "날짜를 이해하지 못했습니다. 예: 17일 13시 예약 가능할까요?";

      fireAndForgetLog({
        logAction: "reply",
        userId,
        result: "sent",
        datetime: "",
        memo: replyText
      });

      return res.json(jsonResponse(replyText));
    }

    if (isReserveIntent(utterance) && !isCancelIntent(utterance)) {
      if (!parsed.time) {
        const replyText = "시간을 이해하지 못했습니다. 예: 17일 13시 예약 가능할까요?";

        fireAndForgetLog({
          logAction: "reply",
          userId,
          result: "sent",
          datetime: parsed.date,
          memo: replyText
        });

        return res.json(jsonResponse(replyText));
      }

      const ensureResult = await ensureMapping(userId);
      fireAndForgetLog({
        logAction: "ensureMapping",
        userId,
        result: ensureResult.ok ? "success" : "fail",
        datetime: parsed.date,
        memo: JSON.stringify(ensureResult)
      });

      const nameResult = await getName(userId);
      fireAndForgetLog({
        logAction: "getName",
        userId,
        result: nameResult.ok ? "success" : "fail",
        datetime: parsed.date,
        memo: JSON.stringify(nameResult)
      });

      const displayName = safeString(nameResult.name) || "미등록";

      const foundResult = await findReservation(parsed.date, userId);
      fireAndForgetLog({
        logAction: "findReservation",
        userId,
        result: foundResult.found ? "found" : "not_found",
        datetime: parsed.date,
        memo: JSON.stringify(foundResult)
      });

      if (foundResult.ok && foundResult.found) {
        const replyText =
          `${parsed.date}에는 이미 예약이 있습니다.\n하루에 1건만 예약 가능합니다.`;

        fireAndForgetLog({
          logAction: "reply",
          userId,
          result: "sent",
          datetime: `${parsed.date} ${parsed.time}`,
          memo: replyText
        });

        return res.json(jsonResponse(replyText));
      }

      const reserveResult = await reserve(parsed.date, parsed.time, displayName, userId);
      fireAndForgetLog({
        logAction: "reserve_result",
        userId,
        result: reserveResult.ok ? "success" : "fail",
        datetime: `${parsed.date} ${parsed.time}`,
        memo: JSON.stringify(reserveResult)
      });

      if (reserveResult.ok) {
        const replyText = "예약 확정되었습니다.";

        fireAndForgetLog({
          logAction: "reply",
          userId,
          result: "sent",
          datetime: `${parsed.date} ${parsed.time}`,
          memo: replyText
        });

        return res.json(jsonResponse(replyText));
      }

      const replyText = reserveResult.message || "예약 처리 중 문제가 발생했습니다.";

      fireAndForgetLog({
        logAction: "reply",
        userId,
        result: "sent",
        datetime: `${parsed.date} ${parsed.time}`,
        memo: replyText
      });

      return res.json(jsonResponse(replyText));
    }

    if (isCancelIntent(utterance)) {
      const foundResult = await findReservation(parsed.date, userId);
      fireAndForgetLog({
        logAction: "findReservation_cancel",
        userId,
        result: foundResult.found ? "found" : "not_found",
        datetime: parsed.date,
        memo: JSON.stringify(foundResult)
      });

      if (!foundResult.ok || !foundResult.found) {
        const replyText = "취소할 예약을 찾지 못했습니다.";

        fireAndForgetLog({
          logAction: "reply",
          userId,
          result: "sent",
          datetime: parsed.date,
          memo: replyText
        });

        return res.json(jsonResponse(replyText));
      }

      const cancelResult = await cancel(parsed.date, userId);
      fireAndForgetLog({
        logAction: "cancel_result",
        userId,
        result: cancelResult.ok ? "success" : "fail",
        datetime: parsed.date,
        memo: JSON.stringify(cancelResult)
      });

      const replyText = cancelResult.ok
        ? "예약 취소되셨습니다."
        : (cancelResult.message || "예약 취소 중 문제가 발생했습니다.");

      fireAndForgetLog({
        logAction: "reply",
        userId,
        result: "sent",
        datetime: parsed.date,
        memo: replyText
      });

      return res.json(jsonResponse(replyText));
    }

    const fallback = "이해하기 어려워요";

    fireAndForgetLog({
      logAction: "reply",
      userId,
      result: "sent",
      datetime: "",
      memo: fallback
    });

    return res.json(jsonResponse(fallback));
  } catch (err) {
    console.error("webhook error:", err);
    return res.json(jsonResponse("처리 중 오류가 발생했습니다."));
  }
}

app.post("/", handleWebhook);
app.post("/webhook", handleWebhook);

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
