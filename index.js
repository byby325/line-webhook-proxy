const express = require('express');
const { Client } = require('@line/bot-sdk');
const { OpenAI } = require('openai');
const { google } = require('googleapis');

const app = express();

// --- 設定區 ---
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const lineClient = new Client(lineConfig);

// Google Sheets 寫入功能
async function saveToSheet(item, amount) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_EMAIL,
      null,
      process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SHEET_ID;
    const targetSheet = 'MR202512'; // 你指定的分頁

    // 準備寫入的資料列
    // A: 消費日, B: 入帳日, C: 明細, D, E (留空), F: 金額
    const today = new Date().toLocaleDateString('zh-TW'); // 格式如 2025/12/28
    const rowData = [
      today,  // A 欄位: 消費日
      today,  // B 欄位: 入帳日 (通常記帳當下即入帳)
      item,   // C 欄位: 明細
      '',     // D 欄位: (空)
      '',     // E 欄位: (空)
      amount  // F 欄位: 金額
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: `${targetSheet}!A:F`,
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

// --- Webhook 處理 ---
app.post('/webhook', express.json(), async (req, res) => {
  const events = req.body.events;

  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;

      try {
        // 1. 叫 ChatGPT 解析文字
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini", // 使用最新最便宜的模型
          messages: [
            { 
              role: "system", 
              content: "你是一個記帳助手。請從使用者的文字中提取『消費項目』與『金額』。請只回傳 JSON 格式，例如：{\"item\": \"午餐\", \"amount\": 150}。如果無法解析，請回傳 null。" 
            },
            { role: "user", content: userMessage }
          ],
          response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);

        if (data && data.item && data.amount) {
          // 2. 寫入 Google Sheet
          const success = await saveToSheet(data.item, data.amount);
          
          if (success) {
            await lineClient.replyMessage(event.replyToken, {
              type: 'text',
              text: `✅ 已記錄到 MR202512\n項目：${data.item}\n金額：$${data.amount}`
            });
          } else {
            throw new Error('Sheet write failed');
          }
        }
      } catch (err) {
        console.error('Process Error:', err);
        // 解析失敗或出錯時的回應
      }
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`伺服器正在運行在埠號 ${PORT}`);
});
