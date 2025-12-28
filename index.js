const express = require('express');
const { Client } = require('@line/bot-sdk');
const { OpenAI } = require('openai');
const { google } = require('googleapis');

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const lineClient = new Client(lineConfig);

// 修改後的寫入功能：加入 date 參數
async function saveToSheet(item, amount, date) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_EMAIL,
      null,
      process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SHEET_ID;
    const targetSheet = 'MR202512'; 

    // 使用傳入的 date，如果 ChatGPT 沒提供則用今天
    const recordDate = date || new Date().toLocaleDateString('zh-TW');

    const rowData = [
      recordDate, // A: 消費日
      recordDate, // B: 入帳日
      item,       // C: 明細
      '',         // D: (空)
      '',         // E: (空)
      amount      // F: 金額
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: `${targetSheet}!A1`, // 修改為 A1，讓它從頭尋找最後一行
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData],
      },
    });
    return true;
  } catch (error) {
    console.error('Google Sheet Error:', error);
    return false;
  }
}

app.post('/webhook', express.json(), async (req, res) => {
  console.log('收到 Webhook 請求:', JSON.stringify(req.body));
  const events = req.body.events;

  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;

      try {
        // 取得今天日期作為 ChatGPT 的參考基準
        const todayInfo = new Date().toLocaleDateString('zh-TW');

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { 
              role: "system", 
              content: `你是一個記帳助手。今天是 ${todayInfo}。
              請從文字中提取『項目』、『金額』及『日期』。
              若使用者說『昨天』或『前天』，請根據今天日期計算出正確的 YYYY/MM/DD。
              請只回傳 JSON：{"item": "...", "amount": 100, "date": "YYYY/MM/DD"}。`
            },
            { role: "user", content: userMessage }
          ],
          response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);

        if (data && data.item && data.amount) {
          // 將解析出來的日期傳入寫入功能
          const success = await saveToSheet(data.item, data.amount, data.date);
          
          if (success) {
            await lineClient.replyMessage(event.replyToken, {
              type: 'text',
              text: `✅ 已記錄到 MR202512\n日期：${data.date || todayInfo}\n項目：${data.item}\n金額：$${data.amount}`
            });
          }
        }
      } catch (err) {
        console.error('Process Error:', err);
      }
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
