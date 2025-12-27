import express from "express";

const app = express();

// 用 raw body，確保轉發時 body 完全一致（給 GAS 驗簽用）
app.use(express.raw({ type: "*/*" }));

app.get("/", (_req, res) => res.status(200).send("OK"));
app.head("/", (_req, res) => res.status(200).end());

// LINE Webhook 入口（你也可以改成 /webhook）
app.post("/", (req, res) => {
  // 先回 200，避免 LINE verify/重送
  res.status(200).send("OK");

  // 背後非同步轉發到 GAS
  const gasUrl = process.env.GAS_URL;
  if (!gasUrl) {
    console.error("Missing GAS_URL env var");
    return;
  }

  // 原樣帶上 headers（包含 x-line-signature）
  const headers = { ...req.headers };

  // 有些 hop-by-hop header 會讓轉發不穩，移掉
  delete headers.host;
  delete headers["content-length"];

  fetch(gasUrl, {
    method: "POST",
    headers,
    body: req.body,          // raw bytes
    redirect: "follow"       // 關鍵：跟隨 302
  }).then(async (r) => {
    const txt = await r.text().catch(() => "");
    console.log("Forwarded to GAS:", r.status, txt.slice(0, 200));
  }).catch((e) => {
    console.error("Forward to GAS failed:", e);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));