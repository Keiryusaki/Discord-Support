import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Create circular image using SVG clipPath (like CSS border-radius)
function createCircularSvg(base64Image, size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <clipPath id="circleClip">
          <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/>
        </clipPath>
      </defs>
      <image 
        width="${size}" 
        height="${size}" 
        xlink:href="data:image/png;base64,${base64Image}"
        clip-path="url(#circleClip)"
      />
    </svg>
  `);
}

export default async function handler(req, res) {
  try {
    const q = req.query ?? {};

    const uid = String(first(q.uid ?? "")).trim();        // {User.id}
    const avatar = String(first(q.avatar ?? "")).trim();  // {User.avatar}
    const decor = String(first(q.decor ?? "")).trim();    // {User.avatarDecorationData.asset}
    const def = String(first(q.def ?? "")).trim();        // {User.defaultAvatarURL} optional

    const size = 512;

    // avatar URL
    let avatarUrl = def;
    if (uid && avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${uid}/${avatar}.png?size=${size}`;
    }
    if (!avatarUrl) {
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;
    }

    // fetch avatar
    const a = await fetch(avatarUrl);
    if (!a.ok) return res.status(502).send("failed fetch avatar");
    const avatarBuf = Buffer.from(await a.arrayBuffer());

    // Avatar size settings - scale down to fit inside decoration
    const avatarSize = 400; // smaller to fit inside decoration frame
    const offset = Math.floor((size - avatarSize) / 2); // center offset

    // Resize avatar and convert to base64
    const resizedAvatar = await sharp(avatarBuf)
      .resize(avatarSize, avatarSize)
      .png()
      .toBuffer();
    
    const base64Avatar = resizedAvatar.toString("base64");

    // Create circular avatar using SVG clipPath (like CSS border-radius: 100%)
    const circularSvg = createCircularSvg(base64Avatar, avatarSize);
    const circularAvatar = await sharp(circularSvg).png().toBuffer();

    // Create base canvas with circular avatar centered
    let base = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent
      },
    })
      .png()
      .composite([{ input: circularAvatar, top: offset, left: offset }]);

    // overlay decoration (full size)
    if (decor) {
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=false`;
      const d = await fetch(decorUrl);

      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
        base = base.composite([{ input: decorPng, top: 0, left: 0 }]);
      }
    }

    const out = await base.png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store"); // biar gak ke-cache pas reset
    return res.status(200).send(out);
  } catch (e) {
    console.error(e);
    return res.status(500).send("error");
  }
}
