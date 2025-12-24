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

    // Required / optional params
    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} (optional)

    // Tuning params (optional)
    const size = clamp(parseInt(first(q.size ?? "512"), 10) || 512, 128, 1024);
    const scale = clamp(parseFloat(first(q.scale ?? "0.84")) || 0.84, 0.6, 1); // default kecil dikit
    const dy = clamp(parseInt(first(q.dy ?? "0"), 10) || 0, -Math.floor(size * 0.2), Math.floor(size * 0.2));
    const round = String(first(q.round ?? "1")) !== "0"; // default: round ON

    // 1) Determine avatar URL
    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    }
    // fallback kalau def kosong
    if (!avatarUrl) {
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;
    }

    // 2) Fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // 3) Base avatar as PNG square
    let composed = sharp(avatarBuf).resize(size, size).png();

    // 4) Overlay decoration (if exists)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);
      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        composed = composed.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    // 5) Shrink + padding (safe area) so decoration edges won't get cut
    const mergedBuf = await composed.png().toBuffer();

    const inner = Math.round(size * scale);
    const x = Math.round((size - inner) / 2);
    let y = Math.round((size - inner) / 2) + dy;
    y = clamp(y, 0, size - inner);

    let outBuf = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp(mergedBuf).resize(inner, inner).png().toBuffer(),
          top: y,
          left: x,
        },
      ])
      .png()
      .toBuffer();

    // 6) Make it FULL ROUND (circle mask) so it looks like avatar even in square container
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

    // 7) Response
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("error");
  }
}
