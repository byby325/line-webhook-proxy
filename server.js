import express from "express";

const app = express();

// 重要：用 raw body，確保轉發時 body 完全一致（給 GAS 驗簽用）
app.use(express.raw({ type: "*/*" }));

// Health check / Verify friendly
app.get("/", (_req, res) => res.status(200).send("OK"));
app.head("/", (_req, res) => res.status(200).end());

// 讓 /webhook 也能 GET/HEAD（有人會用這個路徑當 webhook）
app.get("/webhook", (_req, res) => res.status(200).send("OK"));
app.head("/webhook", (_req, res) => res.status(200).end());

// LINE Webhook 入口（同時支援 / 與 /webhook）
app.post(["/", "/webhook"], async (req, res) => {
  // ✅ 先回 200，避免 LINE timeout / 重送
  res.status(200).send("OK");

  // ✅ 收到事件先印 log，確認 LINE 有沒有打進來
  console.log(
    "INBOUND",
    req.method,
    req.originalUrl,
    "len=",
    req.body?.length || 0,
    "sig=",
    !!req.headers["x-line-signature"],
    "ua=",
    req.headers["user-agent"] || ""
  );

  const gasUrl = (process.env.GAS_URL || "").trim();
  if (!gasUrl) {
    console.error("Missing GAS_URL env var");
    return;
  }

  // GAS_URL 必須是完整 URL
  if (!/^https?:\/\//i.test(gasUrl)) {
    console.error("Invalid GAS_URL (must be full URL):", gasUrl);
    return;
  }

  // 原樣帶上 headers（包含 x-line-signature）
  const headers = { ...req.headers };

  // 移除 hop-by-hop headers（避免轉發不穩）
  delete headers.host;
  delete headers["content-length"];
  delete headers.connection;

  // accept-encoding 不一定要刪，但保守起見拿掉，讓回傳更好 debug
  delete headers["accept-encoding"];

  // 加上 forwarded 資訊（可選）
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-for"] =
    (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]) + ", " : "") +
    (req.socket?.remoteAddress || "");

  // 轉發前先印目的地（debug 很有用）
  console.log("FORWARD_TO", gasUrl);

  try {
    const r = await fetch(gasUrl, {
      method: "POST",
      headers,
      body: req.body, // raw bytes
      redirect: "follow" // 關鍵：跟隨 302
    });

    const txt = await r.text().catch(() => "");
    console.log("FORWARDED_RESULT", r.status, txt.slice(0, 200));
  } catch (e) {
    console.error("Forward to GAS failed:", e);
  }
});

// ✅ Zeabur 常用 8080；同時綁定 0.0.0.0 讓外部可連
const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => console.log("Listening on", port));
