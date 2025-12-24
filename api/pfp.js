import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Cache circle masks per size, biar gak hitung ulang tiap request
 * key: innerSize => PNG buffer mask
 */
const maskCache = new Map();

/**
 * Create a circular alpha mask as PNG (no SVG).
 * Alpha 255 inside circle, 0 outside.
 */
async function getCircleMaskPng(size) {
  if (maskCache.has(size)) return maskCache.get(size);

  const r = size / 2;
  const r2 = r * r;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  const raw = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = (dx * dx + dy * dy) <= r2;

      const idx = (y * size + x) * 4;
      raw[idx + 0] = 255; // R
      raw[idx + 1] = 255; // G
      raw[idx + 2] = 255; // B
      raw[idx + 3] = inside ? 255 : 0; // A
    }
  }

  const png = await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();

  maskCache.set(size, png);
  return png;
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    const size = clamp(parseInt(first(q.size ?? "512"), 10) || 512, 128, 1024);

    // ✅ avatar lebih kecil
    const avatarScale = clamp(parseFloat(first(q.avatarScale ?? "0.86")) || 0.86, 0.6, 1);
    const avatarDy = clamp(
      parseInt(first(q.avatarDy ?? "0"), 10) || 0,
      -Math.floor(size * 0.2),
      Math.floor(size * 0.2)
    );

    // 1) avatar URL
    let avatarUrl = def;
    if (uid && avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    if (!avatarUrl) avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 2) fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // 3) resize avatar kecil + FULL ROUND (mask RAW)
    const inner = Math.round(size * avatarScale);
    const maskPng = await getCircleMaskPng(inner);

    const avatarRounded = await sharp(avatarBuf)
      .resize(inner, inner)
      .ensureAlpha()
      .composite([{ input: maskPng, blend: "dest-in" }])
      .png()
      .toBuffer();

    // 4) canvas transparan + taruh avatar bulat di tengah
    const x = Math.round((size - inner) / 2);
    let y = Math.round((size - inner) / 2) + avatarDy;
    y = clamp(y, 0, size - inner);

    let canvas = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: avatarRounded, top: y, left: x }]);

    // 5) dekorasi: biarkan apa adanya (full size overlay)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);
      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        canvas = canvas.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    const outBuf = await canvas.png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    // cache pendek dulu biar enak test
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("error");
  }
}
