import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    // OUTPUT SIZE
    const size = clamp(parseInt(first(q.size ?? "512"), 10) || 512, 128, 1024);

    // ✅ KEY: avatar smaller, decoration stays full
    const avatarScale = clamp(parseFloat(first(q.avatarScale ?? "0.88")) || 0.88, 0.6, 1); // default kecil
    const avatarDy = clamp(parseInt(first(q.avatarDy ?? "0"), 10) || 0, -Math.floor(size * 0.2), Math.floor(size * 0.2));

    // Optional: round result (default ON)
    const round = String(first(q.round ?? "1")) !== "0";

    // 1) Determine avatar URL
    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    }
    if (!avatarUrl) avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 2) Fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // 3) Prepare canvas
    let canvas = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    // 4) Put avatar smaller in center
    const inner = Math.round(size * avatarScale);
    const x = Math.round((size - inner) / 2);
    let y = Math.round((size - inner) / 2) + avatarDy;
    y = clamp(y, 0, size - inner);

    const avatarPng = await sharp(avatarBuf).resize(inner, inner).png().toBuffer();
    canvas = canvas.composite([{ input: avatarPng, top: y, left: x }]);

    // 5) Overlay decoration FULL SIZE (unchanged)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);
      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        canvas = canvas.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    let outBuf = await canvas.png().toBuffer();

    // 6) Optional: make it circular
    if (round) {
      const r = size / 2;
      const circleMask = Buffer.from(`
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${r}" cy="${r}" r="${r}" fill="white"/>
</svg>`);
      outBuf = await sharp(outBuf)
        .composite([{ input: circleMask, blend: "dest-in" }])
        .png()
        .toBuffer();
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("error");
  }
}
