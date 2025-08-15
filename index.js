import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";
import fs from "fs/promises"; // NEW

dotenv.config();

// --- Setup ---------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Parse form posts (tweet text)
app.use(express.urlencoded({ extended: true }));

// Serve /assets & NEW: /cards (public images)
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/cards", express.static(path.join(__dirname, "public/cards"), { // NEW
  maxAge: "1h",
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=3600, immutable");
  }
}));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "devsecret",
    resave: false,
    saveUninitialized: true,
  })
);

const client = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
});

// Ensure cards dir exists (NEW)
const CARDS_DIR = path.join(__dirname, "public/cards");
async function ensureCardsDir() {
  try { await fs.mkdir(CARDS_DIR, { recursive: true }); } catch {}
}
await ensureCardsDir();

// --- Home --------------------------------------------------------------
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Score Card Simulator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --gold: #ffd000; --bg: #000000; --text: #ffffff; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text); font-family: Manrope, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    .wrap { min-height: 100%; display: grid; place-items: center; padding: 40px 20px; }
    .card { width: 100%; max-width: 760px; text-align: center; }
    .logo { width: 500px; height: auto; margin: 0 auto 28px auto; display: block; filter: drop-shadow(0 2px 12px rgba(0,0,0,0.45)); user-select: none; }
    h1 { margin: 0 0 16px 0; font-weight: 800; letter-spacing: 0.2px; font-size: clamp(28px, 4vw, 40px); color: var(--gold); }
    p { margin: 0 auto 28px auto; max-width: 60ch; line-height: 1.6; opacity: 0.95; font-size: clamp(16px, 2.2vw, 18px); }
    .cta {
      display: inline-flex; align-items: center; gap: 10px; padding: 14px 20px; border-radius: 999px;
      background: var(--gold); color: #111; text-decoration: none; font-weight: 800; font-size: 16px; border: 0; cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease; box-shadow: 0 8px 24px rgba(255, 208, 0, 0.25);
    }
    .cta:hover { transform: translateY(-1px); filter: brightness(1.05); }
    .cta:active { transform: translateY(0); filter: brightness(0.98); }
    .tw { width: 18px; height: 18px; display: inline-block; }
    footer { margin-top: 22px; opacity: 0.55; font-size: 12px; }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <img class="logo" src="/assets/logo.png" alt="Logo" draggable="false" />
      <h1>Score Card Simulator</h1>
      <p>
        Generate a sleek, mock score card based on your X profile. We’ll ask you
        to connect your account, pull your profile picture and handle, and instantly
        render a preview card with simulated metrics—perfect for demos and prelaunch teasers.
      </p>
      <a class="cta" href="/login" aria-label="Connect with X">
        <svg class="tw" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2H21.5l-7.61 8.707L22.5 22h-6.17l-4.826-5.602L5.92 22H2.66l8.2-9.383L1.9 2h6.24l4.36 5.064L18.244 2Zm-2.158 18h1.706L7.99 4H6.18l9.906 16Z"/>
        </svg>
        Connect with X
      </a>
      <footer>
        By continuing you agree to simulate non-production scores.<br>
        Made with ❤️ by <strong>FAIRSCALE</strong>
      </footer>
    </section>
  </main>
</body>
</html>`);
});

// --- Auth: Step 1 (redirect to Twitter) -------------------------------
app.get("/login", async (req, res) => {
  try {
    const authLink = await client.generateAuthLink(
      `${process.env.CALLBACK_URL}/callback`
    );
    req.session.oauth_token = authLink.oauth_token;
    req.session.oauth_token_secret = authLink.oauth_token_secret;
    res.redirect(authLink.url);
  } catch (err) {
    console.error("[ERROR] Failed to generate auth link:", err);
    res.status(500).send("Auth error");
  }
});

// --- Auth: Step 2 (callback) ------------------------------------------
app.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;
  const savedToken = req.session.oauth_token;
  const savedSecret = req.session.oauth_token_secret;

  if (!oauth_token || !oauth_verifier || !savedToken || !savedSecret) {
    return res.status(400).send("Missing auth params");
  }

  try {
    const loginClient = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY,
      appSecret: process.env.TWITTER_CONSUMER_SECRET,
      accessToken: savedToken,
      accessSecret: savedSecret,
    });

    const { client: userClient, accessToken, accessSecret } =
      await loginClient.login(oauth_verifier);

    const user = await userClient.v1.verifyCredentials();

    // Prefer high-res if available
    let profileImageUrl = user.profile_image_url_https;
    if (profileImageUrl.includes("_normal")) {
      profileImageUrl = profileImageUrl.replace("_normal", "_400x400");
    }

    req.session.user = {
      name: user.name,
      screen_name: user.screen_name,
      image: profileImageUrl,
      accessToken,   // store for posting later
      accessSecret,  // store for posting later
    };

    res.redirect("/preview");
  } catch (err) {
    console.error("[ERROR] Twitter login failed:", err);
    res.status(500).send("Login failed");
  }
});

// --- Canvas font -------------------------------------------------------
GlobalFonts.registerFromPath(
  path.join(process.cwd(), "public/fonts/Manrope-Bold.ttf"),
  "Manrope"
);

// --- Helper: render card to Buffer (used by /card and /post) ----------
async function renderCardBuffer(sessionUser) {
  const { screen_name, image } = sessionUser;

  const bg = await loadImage(path.join(__dirname, "assets/card.png"));
  const pfp = await loadImage(image);

  const canvas = createCanvas(3000, 1700);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.drawImage(bg, 0, 0, 3000, 1700);

  // PFP rounded
  const x = 325, y = 285, w = 1085 - 325, h = 1060 - 285, r = 50;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(pfp, x, y, w, h);
  ctx.restore();

  // Handle gradient
  const handle = "@" + screen_name;
  const boxX = 255, boxY = 1270, boxW = 1165 - 255, boxH = 1400 - 1270;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let fontSize = 100; ctx.font = `${fontSize}px Manrope`;
  while (ctx.measureText(handle).width > boxW && fontSize > 10) {
    fontSize -= 2; ctx.font = `${fontSize}px Manrope`;
  }
  const centerX = boxX + boxW / 2, centerY = boxY + boxH / 2;
  const gradient = ctx.createLinearGradient(0, centerY - fontSize / 2, 0, centerY + fontSize / 2);
  gradient.addColorStop(0, "#fdde45"); gradient.addColorStop(1, "#ffcf01");
  ctx.fillStyle = gradient; ctx.fillText(handle, centerX, centerY);

  // Score (right-aligned)
  const scoreBoxX = 2420, scoreBoxY = 272, scoreBoxW = 2645 - 2420, scoreBoxH = 332 - 272;
  const scoreCenterY = scoreBoxY + scoreBoxH / 2;
  const scoreVal = (Math.random() * 1 + 3.9).toFixed(1);
  const numText = scoreVal, slashText = "/", maxText = "5";

  let scoreFontSize = 70; ctx.font = `${scoreFontSize}px Manrope`;
  const measureAll = () => {
    const numW = ctx.measureText(numText).width;
    const slashW = ctx.measureText(slashText).width;
    const fiveW = ctx.measureText(maxText).width;
    const gapBeforeSlash = 5, gapAfterSlash = 5;
    return { total: numW + gapBeforeSlash + slashW + gapAfterSlash + fiveW, numW, slashW, fiveW, gapBeforeSlash, gapAfterSlash };
  };
  let dims = measureAll();
  while (dims.total > scoreBoxW && scoreFontSize > 10) {
    scoreFontSize -= 2; ctx.font = `${scoreFontSize}px Manrope`; dims = measureAll();
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const gradient2 = ctx.createLinearGradient(scoreBoxX, scoreBoxY, scoreBoxX + scoreBoxW, scoreBoxY + scoreBoxH);
  gradient2.addColorStop(0, "#fdde45"); gradient2.addColorStop(1, "#ffcf01");
  let cursorX = scoreBoxX + scoreBoxW;
  ctx.fillStyle = gradient2; ctx.fillText(maxText, cursorX, scoreCenterY); cursorX -= dims.fiveW + dims.gapAfterSlash;
  ctx.fillStyle = "#ffffff"; ctx.fillText(slashText, cursorX, scoreCenterY); cursorX -= dims.slashW + dims.gapBeforeSlash;
  ctx.fillStyle = gradient2; ctx.fillText(numText, cursorX, scoreCenterY);

  // Helper numbers (right aligned)
  const drawGoldNumberRight = (text, bx, by, bw, bh, startFont = 70) => {
    const cY = by + bh / 2;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    let fs = startFont; ctx.font = `${fs}px Manrope`;
    while (ctx.measureText(text).width > bw && fs > 10) { fs -= 2; ctx.font = `${fs}px Manrope`; }
    const grad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    grad.addColorStop(0, "#fdde45"); grad.addColorStop(1, "#ffcf01");
    ctx.fillStyle = grad; ctx.fillText(text, bx + bw, cY);
  };
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const fmt = (n) => n.toLocaleString("en-US");

  drawGoldNumberRight(fmt(randInt(1, 1000)),     2420,  604, 2645-2420, 666-604, 70);
  drawGoldNumberRight(fmt(randInt(100, 1000)),  2420,  940, 2645-2420, 998-940, 70);
  drawGoldNumberRight(fmt(randInt(1000, 10000)),2420, 1269, 2645-2420,1334-1269,70);

  // Disclaimer
  const disclaimer = "SAMPLE CARD PRELAUNCH DOES NOT REFLECT ACTUAL SCORES";
  const boxXd = 208, boxYd = 1444, boxWd = 2800 - 208, boxHd = 1545 - 1444;
  const centerXd = boxXd + boxWd / 2, centerYd = boxYd + boxHd / 2;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let fontSized = 48; ctx.font = `${fontSized}px Manrope`;
  while (ctx.measureText(disclaimer).width > boxWd && fontSized > 10) { fontSized -= 2; ctx.font = `${fontSized}px Manrope`; }
  const disclaimerGrad = ctx.createLinearGradient(boxXd, boxYd, boxXd + boxWd, boxYd + boxHd);
  disclaimerGrad.addColorStop(0, "#fdde45"); disclaimerGrad.addColorStop(1, "#ffcf01");
  ctx.fillStyle = disclaimerGrad; ctx.fillText(disclaimer, centerXd, centerYd);

  return canvas.toBuffer("image/png");
}

// --- NEW: save to /public/cards/<screen_name>.png ----------------------
async function saveCardImage(sessionUser) {
  await ensureCardsDir();
  const safe = String(sessionUser.screen_name).replace(/[^a-zA-Z0-9_]/g, "_");
  const filePath = path.join(CARDS_DIR, `${safe}.png`);
  const png = await renderCardBuffer(sessionUser);
  await fs.writeFile(filePath, png);
  return `/cards/${encodeURIComponent(safe)}.png`; // public URL path
}

// --- Preview page (image + actions) ------------------------------------
app.get("/preview", async (req, res) => {
  if (!req.session.user) return res.redirect("/");

  // Save/update a public copy for Web Intent (NEW)
  const publicPath = await saveCardImage(req.session.user);
  const { screen_name } = req.session.user;
  const defaultTweet = `Score Card Simulator for @${screen_name} — tag @fairforsol #FairForSol`;

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Preview — Score Card</title>
  <style>
    :root { --gold:#ffd000; --bg:#000; --text:#fff; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family: Manrope, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    .wrap { min-height:100vh; display:grid; place-items:center; padding:32px 16px; }
    .box { width:100%; max-width:1100px; text-align:center; }
    h1 { margin:0 0 16px; color:var(--gold); font-weight:800; font-size:clamp(22px,3.6vw,32px); }
    .imgwrap { overflow:auto; margin:16px auto 24px; border-radius:12px; border:1px solid #222; background:#111; padding:12px; }
    img { max-width:100%; height:auto; display:block; margin:0 auto; }
    .row { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
    .btn {
      appearance:none; border:0; cursor:pointer; text-decoration:none;
      padding:12px 18px; border-radius:999px; font-weight:800; font-size:14px;
      background:var(--gold); color:#111; box-shadow:0 8px 24px rgba(255,208,0,.18);
      transition:transform .12s ease, filter .12s ease;
    }
    .btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
    .btn:active { transform: translateY(0); filter: brightness(.98); }
    .ghost { background:#1f1f1f; color:#fff; box-shadow:none; border:1px solid #2a2a2a; }

    .tweetbox { margin: 14px auto 6px; max-width: 700px; display: grid; gap: 8px; text-align: left; }
    .tweetbox label { font-size: 12px; opacity: .75; }
    .tweetbox textarea {
      width: 100%; min-height: 70px; padding: 10px 12px; border-radius: 10px; border: 1px solid #2a2a2a;
      background: #0f0f0f; color: #fff; font: inherit; resize: vertical;
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="box">
      <h1>Preview for @${screen_name}</h1>
      <div class="imgwrap">
        <img src="${publicPath}?t=${Date.now()}" alt="Generated score card" /> <!-- now public -->
      </div>

      <form method="post" action="/post" style="margin:0" id="tweetForm">
        <div class="tweetbox">
          <label for="text">Share on X and tag <strong>@fairforsol</strong>:</label>
          <textarea id="text" name="text">${defaultTweet}</textarea>
        </div>
        <div class="row">
          <a class="btn" href="${publicPath}" download="scorecard.png">Download PNG</a>
          <button type="submit" class="btn">Share on X (auto-post)</button>
          <a class="btn ghost" href="#" id="openComposer">Open X Composer</a>
          <a class="btn ghost" href="/">Back</a>
        </div>
      </form>
    </section>
  </main>

  <script>
    const openComposer = document.getElementById('openComposer');
    const textarea = document.getElementById('text');
    const publicUrl = new URL(${JSON.stringify(publicPath)}, window.location.origin).toString();

    openComposer.addEventListener('click', (e) => {
      e.preventDefault();
      const text = textarea.value || '';
      const params = new URLSearchParams({ text, url: publicUrl });
      const intent = 'https://twitter.com/intent/tweet?' + params.toString();
      window.open(intent, '_blank', 'noopener,noreferrer');
    });
  </script>
</body>
</html>`);
});

// --- Card image (session-gated legacy endpoint still available) --------
app.get("/card", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  try {
    const png = await renderCardBuffer(req.session.user);
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", 'attachment; filename="scorecard.png"');
    }
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    console.error("[ERROR] Failed to generate card:", err);
    res.status(500).send("Card generation failed");
  }
});

// --- Post to Twitter (still supported) --------------------------------
app.post("/post", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { screen_name, accessToken, accessSecret } = req.session.user || {};
  if (!accessToken || !accessSecret) {
    console.error("[ERROR] Missing access tokens in session");
    return res.status(400).send("Cannot post: missing permissions. Please login again.");
  }

  const userText =
    (typeof req.body?.text === "string" && req.body.text.trim()) ||
    `Score Card Simulator for @${screen_name} — tag @fairforsol #FairForSol`;

  try {
    const rwClient = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY,
      appSecret: process.env.TWITTER_CONSUMER_SECRET,
      accessToken,
      accessSecret
    }).readWrite;

    const buffer = await renderCardBuffer(req.session.user);
    const mediaId = await rwClient.v1.uploadMedia(buffer, { type: "png" });

    try {
      await rwClient.v1.createMediaMetadata(mediaId, {
        alt_text: { text: "Simulated score card image generated by the Score Card Simulator." }
      });
    } catch (metaErr) {
      console.warn("[WARN] Media alt text failed:", metaErr?.data || metaErr?.message || metaErr);
    }

    await rwClient.v1.tweet(userText, { media_ids: mediaId });
    res.redirect("/preview");
  } catch (err) {
    console.error("[ERROR] Failed to post tweet:", err?.data || err?.message || err);
    res.status(500).send("Posting to X failed");
  }
});

// --- Export for Vercel --------------------------------------------------
// if (process.env.VERCEL !== "1") {
//   const PORT = process.env.PORT || 3000;
//   app.listen(PORT, () => console.log(`[INFO] http://localhost:${PORT}`));
// }

export default app;
