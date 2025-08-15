import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
//import { createCanvas, loadImage, registerFont } from "canvas";
//// from:
// import { createCanvas, loadImage, registerFont } from "canvas";
// to:
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";

dotenv.config();

// --- Setup ---------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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

// --- Routes --------------------------------------------------------------

// Home
app.get("/", (req, res) => {
  console.log("[INFO] GET /");
  res.send(
    `<h2>Twitter Login Demo</h2>
     <a href="/login">Login with Twitter</a>`
  );
});

// Step 1: Redirect to Twitter
app.get("/login", async (req, res) => {
  console.log("[INFO] GET /login — starting Twitter auth flow");
  try {
    const authLink = await client.generateAuthLink(
      `${process.env.CALLBACK_URL}/callback`
    );
    req.session.oauth_token = authLink.oauth_token;
    req.session.oauth_token_secret = authLink.oauth_token_secret;
    console.log("[DEBUG] Temporary OAuth token:", authLink.oauth_token);
    res.redirect(authLink.url);
  } catch (err) {
    console.error("[ERROR] Failed to generate auth link:", err);
    res.status(500).send("Auth error");
  }
});

// Step 2: Callback from Twitter
app.get("/callback", async (req, res) => {
  console.log("[INFO] GET /callback — returning from Twitter");

  const { oauth_token, oauth_verifier } = req.query;
  const savedToken = req.session.oauth_token;
  const savedSecret = req.session.oauth_token_secret;

  console.log("[DEBUG] oauth_token (from query):", oauth_token);
  console.log("[DEBUG] oauth_verifier:", oauth_verifier);

  if (!oauth_token || !oauth_verifier || !savedToken || !savedSecret) {
    console.error("[ERROR] Missing OAuth parameters or session values");
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

    console.log("[INFO] Successfully logged in");
    console.log("[DEBUG] AccessToken:", accessToken);
    console.log("[DEBUG] AccessSecret:", accessSecret);

    const user = await userClient.v1.verifyCredentials();
    console.log("[INFO] Twitter user:", user.screen_name);
    console.log("[DEBUG] Profile image (original):", user.profile_image_url_https);

    // Prefer high-res if available
    let profileImageUrl = user.profile_image_url_https;
    if (profileImageUrl.includes("_normal")) {
      profileImageUrl = profileImageUrl.replace("_normal", "_400x400");
    }

    req.session.user = {
      name: user.name,
      screen_name: user.screen_name,
      image: profileImageUrl,
    };

    res.redirect("/card");
  } catch (err) {
    console.error("[ERROR] Twitter login failed:", err);
    res.status(500).send("Login failed");
  }
});

// Step 3: Generate dynamic card

// Register Manrope Bold (true bold glyphs)
GlobalFonts.registerFromPath(path.join(process.cwd(), "public/fonts/Manrope-Bold.ttf"), "Manrope");

app.get("/card", async (req, res) => {
  console.log("[INFO] GET /card — generating card");

  if (!req.session.user) {
    console.warn("[WARN] No user session found, redirecting to /");
    return res.redirect("/");
  }

  const { screen_name, image } = req.session.user;

  try {
    const bg = await loadImage(path.join(__dirname, "assets/card.png"));
    const pfp = await loadImage(image);

    const canvas = createCanvas(3000, 1700);
    const ctx = canvas.getContext("2d");

    // Draw background
    ctx.drawImage(bg, 0, 0, 3000, 1700);

    // --- Draw PFP with rounded corners ---
    const x = 325;
    const y = 285;
    const w = 1085 - 325;
    const h = 1060 - 285;
    const r = 50; // keep if you like the bigger rounding

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
    // ------------------------------------

    // --- Twitter handle with tight vertical gold gradient ---
    const handle = "@" + screen_name;

    const boxX = 255;
    const boxY = 1270;
    const boxW = 1165 - 255;
    const boxH = 1400 - 1270;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let fontSize = 100;
    ctx.font = `${fontSize}px Manrope`; // true bold from Manrope-Bold.ttf
    let textWidth = ctx.measureText(handle).width;

    while (textWidth > boxW && fontSize > 10) {
      fontSize -= 2;
      ctx.font = `${fontSize}px Manrope`;
      textWidth = ctx.measureText(handle).width;
    }

    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;

    const gradient = ctx.createLinearGradient(
      0,
      centerY - fontSize / 2,
      0,
      centerY + fontSize / 2
    );
    gradient.addColorStop(0, "#fdde45");
    gradient.addColorStop(1, "#ffcf01");

    ctx.fillStyle = gradient;
    ctx.fillText(handle, centerX, centerY);

    // --- Fairscore (4.x/5) in 2420×272 → 2645×332 ---
    const scoreBoxX = 2420;
    const scoreBoxY = 272;
    const scoreBoxW = 2645 - 2420; // 225
    const scoreBoxH = 332 - 272;   // 60
    const scoreCenterY = scoreBoxY + scoreBoxH / 2;

    // Random 4.x with one decimal
    const scoreVal = (Math.random() * 1 + 3.9).toFixed(1); // "4.7"
    const numText = scoreVal;
    const slashText = "/";
    const maxText = "5";

    // Match FAIRSCORE size: start at 70 and fit
    let scoreFontSize = 70;
    ctx.font = `${scoreFontSize}px Manrope`;

    // Fit all three pieces with spacing
    const measureAll = () => {
      const numW = ctx.measureText(numText).width;
      const slashW = ctx.measureText(slashText).width;
      const fiveW = ctx.measureText(maxText).width;
      const gapBeforeSlash = 5; // extra spacing you wanted
      const gapAfterSlash = 5;
      return {
        total:
          numW + gapBeforeSlash + slashW + gapAfterSlash + fiveW,
        numW,
        slashW,
        fiveW,
        gapBeforeSlash,
        gapAfterSlash,
      };
    };

    let dims = measureAll();
    while (dims.total > scoreBoxW && scoreFontSize > 10) {
      scoreFontSize -= 2;
      ctx.font = `${scoreFontSize}px Manrope`;
      dims = measureAll();
    }

// Right-align text inside the box
ctx.textAlign = "right";
ctx.textBaseline = "middle";

// Gradient for numbers
const gradient2 = ctx.createLinearGradient(
  scoreBoxX,
  scoreBoxY,
  scoreBoxX + scoreBoxW,
  scoreBoxY + scoreBoxH
);
gradient2.addColorStop(0, "#fdde45");
gradient2.addColorStop(1, "#ffcf01");

// Start cursor at right edge of box
let cursorX = scoreBoxX + scoreBoxW;

// Draw "5" with gradient
ctx.fillStyle = gradient2;
ctx.fillText(maxText, cursorX, scoreCenterY);
cursorX -= dims.fiveW + dims.gapAfterSlash;

// Draw "/" in white
ctx.fillStyle = "#ffffff";
ctx.fillText(slashText, cursorX, scoreCenterY);
cursorX -= dims.slashW + dims.gapBeforeSlash;

// Draw "4.x" with gradient
ctx.fillStyle = gradient2;
ctx.fillText(numText, cursorX, scoreCenterY);

// Helper: draw a right-aligned, gold-gradient number inside a box
function drawGoldNumberRight(ctx, text, boxX, boxY, boxW, boxH, startFont = 70) {
  const centerY = boxY + boxH / 2;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  // Fit text to box width
  let fontSize = startFont;
  ctx.font = `${fontSize}px Manrope`;
  while (ctx.measureText(text).width > boxW && fontSize > 10) {
    fontSize -= 2;
    ctx.font = `${fontSize}px Manrope`;
  }

  // Fresh gradient per box (same as score)
  const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
  grad.addColorStop(0, "#fdde45");
  grad.addColorStop(1, "#ffcf01");

  ctx.fillStyle = grad;
  ctx.fillText(text, boxX + boxW, centerY); // right edge anchor
}

// Random int helpers (inclusive)
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Number formatter (commas for thousands, no decimals)
const formatNumber = (n) => n.toLocaleString("en-US");

// 1) 2420x 604y to 2645x 666y: 1–100
drawGoldNumberRight(ctx,
  formatNumber(randInt(1, 100)),
  2420, 604, 2645 - 2420, 666 - 604,
  70
);

// 2) 2420x 940y to 2645x 998y: 100–1000
drawGoldNumberRight(ctx,
  formatNumber(randInt(100, 1000)),
  2420, 940, 2645 - 2420, 998 - 940,
  70
);

// 3) 2420x 1269y to 2645x 1334y: 1000–10000
drawGoldNumberRight(ctx,
  formatNumber(randInt(1000, 10000)),
  2420, 1269, 2645 - 2420, 1334 - 1269,
  70
);
// --- Draw disclaimer text centered ---
const disclaimer = "SAMPLE CARD PRELAUNCH DOES NOT REFLECT ACTUAL SCORES";

const boxXd = 208;
const boxYd = 1444;
const boxWd = 2800 - 208;
const boxHd = 1545 - 1444;

const centerXd = boxXd + boxWd / 2;
const centerYd = boxYd + boxHd / 2;

ctx.textAlign = "center";
ctx.textBaseline = "middle";

// Smaller font; shrink-to-fit if needed
let fontSized = 48;
// You loaded Manrope-Bold.ttf, so no need to prefix "bold" here:
ctx.font = `${fontSized}px Manrope`;

while (ctx.measureText(disclaimer).width > boxWd && fontSized > 10) {
  fontSized -= 2;
  ctx.font = `${fontSized}px Manrope`;
}

// Gradient (same gold as elsewhere)
const disclaimerGrad = ctx.createLinearGradient(boxXd, boxYd, boxXd + boxWd, boxYd + boxHd);
disclaimerGrad.addColorStop(0, "#fdde45");
disclaimerGrad.addColorStop(1, "#ffcf01");

ctx.fillStyle = disclaimerGrad;
ctx.fillText(disclaimer, centerXd, centerYd); // <-- use the disclaimer center
    // --- End of card drawing ---
    res.setHeader("Content-Type", "image/png");
    res.send(canvas.toBuffer("image/png"));
  } catch (err) {
    console.error("[ERROR] Failed to generate card:", err);
    res.status(500).send("Card generation failed");
  }
});

// --- Start ---------------------------------------------------------------
//const PORT = process.env.PORT || 3000;
//app.listen(PORT, () => {
//  console.log(`[INFO] Server running on http://localhost:${PORT}`);
//});
//
export default app
