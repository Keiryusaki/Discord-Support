import sharp from "sharp";

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Create circle mask - white circle on transparent background
function createCircleMaskSvg(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
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
    const avatarSize = 450; // slightly smaller than 512 to fit inside decoration frame
    const padding = Math.floor((size - avatarSize) / 2); // padding untuk center

    // Step 1: Resize avatar
    const resizedAvatar = await sharp(avatarBuf)
      .resize(avatarSize, avatarSize)
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Step 2: Create circle mask (grayscale values for alpha)
    const maskRaw = await sharp(createCircleMaskSvg(avatarSize))
      .resize(avatarSize, avatarSize)
      .extractChannel(0) // ambil 1 channel saja (grayscale)
      .raw()
      .toBuffer();

    // Step 3: Apply mask to alpha channel
    const pixelCount = avatarSize * avatarSize;
    for (let i = 0; i < pixelCount; i++) {
      // resizedAvatar is RGBA (4 channels), maskRaw is grayscale (1 channel)
      // Set alpha channel (index 3) to mask value
      resizedAvatar[i * 4 + 3] = maskRaw[i];
    }

    // Step 4: Convert back to PNG and extend dengan padding
    let base = sharp(resizedAvatar, {
      raw: { width: avatarSize, height: avatarSize, channels: 4 }
    })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png();

    // overlay decoration (full size)
    let isAnimated = false;
    let out;

    if (decor) {
      // Try animated version first (passthrough=true keeps animation)
      const decorUrl = `https://cdn.discordapp.com/avatar-decoration-presets/${decor}.png?size=${size}&passthrough=true`;
      const d = await fetch(decorUrl);

      if (d.ok) {
        const decorBuf = Buffer.from(await d.arrayBuffer());
        
        // Check if decoration is animated
        const decorMeta = await sharp(decorBuf).metadata();
        isAnimated = decorMeta.pages > 1; // multiple pages = animated

        if (isAnimated) {
          // Get avatar as static buffer first
          const avatarStatic = await base.toBuffer();
          
          // Get animation metadata
          const { pages, delay, loop } = decorMeta;
          
          // Extract all frames and composite with avatar
          const frames = [];
          for (let i = 0; i < pages; i++) {
            const frame = await sharp(decorBuf, { page: i })
              .resize(size, size)
              .toBuffer();
            
            // Composite: avatar (background) + decoration frame (foreground)
            const composited = await sharp(avatarStatic)
              .composite([{ input: frame, top: 0, left: 0 }])
              .png()
              .toBuffer();
            
            frames.push(composited);
          }
          
          // Stack frames vertically for animated WebP
          const frameHeight = size;
          const totalHeight = frameHeight * frames.length;
          
          // Create vertical strip of all frames
          const stackedFrames = await sharp({
            create: {
              width: size,
              height: totalHeight,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
          })
            .composite(frames.map((f, i) => ({
              input: f,
              top: i * frameHeight,
              left: 0
            })))
            .png()
            .toBuffer();
          
          // Convert to animated WebP
          out = await sharp(stackedFrames, { animated: true })
            .webp({ 
              loop: loop || 0,
              delay: delay || Array(pages).fill(80),
              pageHeight: frameHeight
            })
            .toBuffer();
            
        } else {
          // Static decoration
          const decorPng = await sharp(decorBuf).resize(size, size).png().toBuffer();
          base = base.composite([{ input: decorPng, top: 0, left: 0 }]);
          out = await base.png().toBuffer();
        }
      } else {
        out = await base.png().toBuffer();
      }
    } else {
      out = await base.png().toBuffer();
    }

    res.setHeader("Content-Type", isAnimated ? "image/webp" : "image/png");
    res.setHeader("Cache-Control", "no-store"); // biar gak ke-cache pas reset
    return res.status(200).send(out);
  } catch (e) {
    console.error(e);
    return res.status(500).send("error");
  }
}
