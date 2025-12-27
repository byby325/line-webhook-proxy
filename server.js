import express from "express";

const app = express();

// 重要：用 raw body，確保轉發時 body 完全一致（給 GAS 驗簽用）
app.use(express.raw({ type: "*/*" }));

// Health check / Verify friendly
app.get("/", (_req, res) => res.status(200).send("OK"));
app.head("/", (_req, res) => res.status(200).end());

// LINE Webhook 入口（根路徑）
app.post("/", (req, res) => {
  // 先回 200，避免 LINE verify/重送 timeout
  res.status(200).send("OK");

  const gasUrl = process.env.GAS_URL;
  if (!gasUrl) {
    console.error("Missing GAS_URL env var");
    return;
  }

  // 原樣帶上 headers（包含 x-line-signature）
  const headers = { ...req.headers };

  // 移除 hop-by-hop headers
  delete headers.host;
  delete headers["content-length"];
  delete headers.connection;
  delete headers["accept-encoding"]; // 避免壓縮造成除錯不便（可留可不留）

  // 加上 forwarded 資訊（可選）
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-for"] =
    (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]) + ", " : "") +
    (req.socket?.remoteAddress || "");

  fetch(gasUrl, {
    method: "POST",
    headers,
    body: req.body,      // raw bytes
    redirect: "follow"   // 關鍵：跟隨 302
  })
    .then(async (r) => {
      const txt = await r.text().catch(() => "");
      console.log("Forwarded to GAS:", r.status, txt.slice(0, 200));
    })
    .catch((e) => {
      console.error("Forward to GAS failed:", e);
    });
});

// ✅ Zeabur 常用 8080；同時綁定 0.0.0.0 讓外部可連
const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => console.log("Listening on", port));
