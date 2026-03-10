const express = require("express");
const app = express();

app.use(express.json());

const STATUS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSkuiyWVse5fkRy2DOIe3umh2_PhkAlWthbYtP6AIxU8XGnMPl7vpFdaaMB3aucwGqe31FURworghkx/pub?gid=374063695&single=true&output=csv";

const WRITE_URL =
  "https://script.google.com/macros/s/AKfycbz2Ec2FfO_cnkagYdiY1qwK40A8igO4_EJi4Y7kq6jMYlX0J-G7mxImB8GaXadi1Q4/exec";

function parseCsvLine(line) {
  return line.split(",").map(v => v.trim());
}

function parseCsvWithHeader(text) {
  const lines = text.trim().split("\n");
  const headers = parseCsvLine(lines[0]);

  const rows = [];

  for (let i = 1; i < lines.length; i++) {

    const cols = parseCsvLine(lines[i]);
    const row = {};

    headers.forEach((h, idx) => {
      row[h] = cols[idx];
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

  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);

  if (md) {

    const now = new Date();

    return `${now.getFullYear()}-${String(md[1]).padStart(2,"0")}-${String(md[2]).padStart(2,"0")}`;

  }

  const dOnly = s.match(/(\d{1,2})\s*일/);

  if (dOnly) {

    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(dOnly[1]).padStart(2,"0")}`;

  }

  return null;

}

function normalizeHour(value) {

  if (!value) return null;

  const s = String(value).trim();

  if (s === "오전") return 9;
  if (s === "오후") return 13;

  const h = s.match(/(\d{1,2})/);

  if (h) return parseInt(h[1]);

  return null;

}

function getPeriod(hour) {

  if (hour >= 9 && hour <= 11) return "오전";
  if (hour >= 13 && hour <= 16) return "오후";

  return null;

}

function formatHour(hour){

  return `${String(hour).padStart(2,"0")}:00`;

}

function extractFromUtterance(text){

  const dateMatch = text.match(/(\d{1,2})\s*일/);
  const hourMatch = text.match(/(\d{1,2})\s*시/);

  return {

    date: dateMatch ? dateMatch[0] : null,
    time: hourMatch ? hourMatch[0] : null

  };

}

function extractMultipleDates(text){

  const matches = [...text.matchAll(/(\d{1,2})\s*일/g)];

  const now = new Date();

  return matches.map(m => {

    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;

  });

}

function getThisWeekDates(){

  const today = new Date();
  const dates = [];

  for(let i=0;i<7;i++){

    const d = new Date(today);
    d.setDate(today.getDate()+i);

    dates.push(d.toISOString().slice(0,10));

  }

  return dates;

}

function detectIntent(text){

  if(/취소/.test(text)) return "cancel";

  if(/이번주/.test(text)) return "week";

  if(/가능|남는 시간|가능한 날/.test(text) && /\d+일.*\d+일/.test(text)) return "multi";

  if(/예약/.test(text)) return "reserve";

  return "unknown";

}

async function callScript(payload){

  const res = await fetch(WRITE_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });

  return res.json();

}

async function getMappedName(userId){

  const r = await callScript({
    action:"getName",
    userId
  });

  if(!r.ok) return null;

  return r.name;

}

async function ensureMapping(userId){

  return callScript({
    action:"ensureMapping",
    userId
  });

}

async function findExistingReservation(userId,date){

  const r = await callScript({
    action:"findReservation",
    userId,
    date
  });

  if(!r.ok) return null;

  return r.found;

}

async function saveReservation({date,time,userId,name}){

  return callScript({
    action:"reserve",
    date,
    time,
    userId,
    name
  });

}

async function cancelReservation({date,userId}){

  return callScript({
    action:"cancel",
    date,
    userId
  });

}

async function getAvailability(date,period){

  const rows = await fetchCsvRows(STATUS_CSV_URL);

  const row = rows.find(r => normalizeDate(r["날짜"]) === date);

  if(!row) return null;

  return row[period];

}

async function getAvailableSlots(dates){

  const rows = await fetchCsvRows(STATUS_CSV_URL);

  const result = [];

  for(const date of dates){

    const row = rows.find(r => normalizeDate(r["날짜"]) === date);

    if(!row) continue;

    const slots=[];

    if(row["오전"]==="가능") slots.push("오전");
    if(row["오후"]==="가능") slots.push("오후");

    if(slots.length>0){

      result.push(`${date} (${slots.join(", ")})`);

    }

  }

  if(result.length===0){

    return "현재 예약 가능한 시간이 없습니다.";

  }

  return `예약 가능한 시간\n\n${result.join("\n")}`;

}

async function processRequest(body){

  const utterance = body.userRequest.utterance;
  const userId = body.userRequest.user.id;

  const intent = detectIntent(utterance);

  if(intent==="multi"){

    const dates = extractMultipleDates(utterance);

    const message = await getAvailableSlots(dates);

    return {message};

  }

  if(intent==="week"){

    const dates = getThisWeekDates();

    const message = await getAvailableSlots(dates);

    return {message};

  }

  if(intent==="cancel"){

    const {date} = extractFromUtterance(utterance);

    const d = normalizeDate(date);

    await cancelReservation({date:d,userId});

    return {message:`${d} 예약이 취소되었습니다.`};

  }

  if(intent==="reserve"){

    const {date,time} = extractFromUtterance(utterance);

    const d = normalizeDate(date);
    const hour = normalizeHour(time);

    const period = getPeriod(hour);

    const exist = await findExistingReservation(userId,d);

    if(exist){

      return {message:`${d} 이미 예약이 있습니다.`};

    }

    const status = await getAvailability(d,period);

    if(status!=="가능"){

      return {message:"예약 마감되었습니다."};

    }

    const name = await getMappedName(userId) || "미등록";

    await saveReservation({
      date:d,
      time:formatHour(hour),
      userId,
      name
    });

    return {message:"예약 확정 되셨습니다."};

  }

  return {message:"다시 말씀해 주세요."};

}

app.post("/",async(req,res)=>{

  const userId = req.body.userRequest.user.id;

  ensureMapping(userId);

  const result = await processRequest(req.body);

  res.json({
    version:"2.0",
    template:{
      outputs:[
        {
          simpleText:{
            text:result.message
          }
        }
      ]
    }
  });

});

app.listen(process.env.PORT || 3000);
