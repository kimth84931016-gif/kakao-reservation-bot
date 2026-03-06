const express = require("express");
const app = express();

app.use(express.json());

app.post("/", async (req, res) => {
  try {

    const date = req.body.action?.params?.date;
    const time = req.body.action?.params?.time;

    console.log("예약 요청:", date, time);

    let message = "예약 확정 되셨습니다.";

    if (!date || !time) {
      message = "담당자 확인 후 연락드리겠습니다.";
    }

    res.json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: message
            }
          }
        ]
      }
    });

  } catch (error) {

    res.json({
      version: "2.0",
      template: {
        outputs: [
          {
            simpleText: {
              text: "담당자 확인 후 연락드리겠습니다."
            }
          }
        ]
      }
    });

  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("server start");
});
