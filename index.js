const express = require('express');
const { Client } = require('@line/bot-sdk');
const { OpenAI } = require('openai');
const { google } = require('googleapis');

const app = express();

// 1. 配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const lineClient = new Client(lineConfig);

// 2. ChatGPT 解析邏輯
async function parseExpense(text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "你是一個記帳助手。請從文字中提取『項目』與『金額』，並以 JSON 格式回傳，例如: {\"item\": \"午餐\", \"amount\": 100}。如果不是記帳訊息，請回傳 null。" },
      { role: "user", content: text }
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

// 3. 處理 Webhook
app.post('/webhook', express.json(), async (req, res) => {
  const events = req.body.events;
  
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userText = event.message.text;
      
      // 呼叫 ChatGPT 解析
      const data = await parseExpense(userText);
      
      if (data && data.item) {
        // 寫入 Google Sheets (此處需實作 Google Auth)
        await addToSheet(data.item, data.amount);
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `✅ 已記錄：${data.item} $${data.amount}`
        });
      }
    }
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
