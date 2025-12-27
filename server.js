import express from "express";
import crypto from "crypto";

const app = express();

// ✅ 重要：用 raw body，確保 body 完整一致（GAS 解析、OpenAI 解析都靠它）
app.use(express.raw({ type: "*/*", limit: "2mb" }));

app.get("/", (_req, res) => res.status(200).send("OK"));
app.head("/", (_req, res) => res.status(200).end());

function verifyLineSignature(rawBodyBuffer, channelSecret, signatureB64) {
  if (!channelSecret || !signatureB64) return false;

  const hmac = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBodyBuffer)
    .digest("base64");

  // timing-safe compare
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signatureB64));
  } catch {
    return false;
  }
}

app.post("/", async (req, res) => {
  // ✅ 先回 200，避免 LINE timeout / retry
  res.status(200).send("OK");

  const gasUrl = process.env.GAS_URL; // 必須是完整 https://script.google.com/macros/s/.../exec
  const lineSecret = process.env.LINE_CHANNEL_SECRET; // 必須
  if (!gasUrl || !lineSecret) {
    console.error("Missing env vars: GAS_URL / LINE_CHANNEL_SECRET");
    return;
  }

  const sig = req.headers["x-line-signature"];
  const ua = req.headers["user-agent"] || "";
  console.log(
    `INBOUND POST / len=${req.body?.length ?? 0} sig=${Boolean(sig)} ua=${ua}`
  );

  // ✅ 驗簽（沒有 signature 的就直接擋：例如你自己 curl 測試）
  if (!verifyLineSignature(req.body, lineSecret, String(sig || ""))) {
    console.warn("INVALID SIGNATURE - drop forward");
    return;
  }

  // 轉發 headers（保留 content-type）
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  delete headers.connection;

  console.log("FORWARD_TO", gasUrl);

  // ✅ 10 秒 timeout（避免卡住）
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);

  try {
    const r = await fetch(gasUrl, {
      method: "POST",
      headers,
      body: req.body,          // raw bytes
      redirect: "follow",
      signal: ac.signal
    });
    const txt = await r.text().catch(() => "");
    console.log("FORWARDED_RESULT", r.status, txt.slice(0, 200));
  } catch (e) {
    console.error("FORWARD_FAILED", e);
  } finally {
    clearTimeout(t);
  }
});

// ✅ Zeabur 常用 8080；綁 0.0.0.0 才能對外
const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => console.log("Listening on", port));
