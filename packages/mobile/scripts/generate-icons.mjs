/**
 * Generate every Android launcher icon and splash asset from the single
 * source-of-truth brand SVG (`packages/web/public/icon.svg`), so the phone app
 * and the PWA can never drift apart.
 *
 * Run with:  npm run assets -w @urlm/mobile
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const resRoot = path.resolve(here, '../android/app/src/main/res');
const source = path.resolve(here, '../../web/public/icon.svg');

const BRAND_BACKGROUND = '#04060e';

/** Android density buckets: folder → scale factor applied to 48dp base sizes. */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

async function main() {
  const svg = await readFile(source);

  for (const [bucket, scale] of DENSITIES) {
    const launcher = Math.round(48 * scale);
    const foreground = Math.round(108 * scale);
    const dir = path.join(resRoot, `mipmap-${bucket}`);
    await mkdir(dir, { recursive: true });

    // Legacy square + round icons (full-bleed brand mark).
    const flat = await sharp(svg, { density: 384 }).resize(launcher, launcher).png().toBuffer();
    await writeFile(path.join(dir, 'ic_launcher.png'), flat);
    await writeFile(path.join(dir, 'ic_launcher_round.png'), flat);

    // Adaptive foreground: the mark occupies the inner 72dp of the 108dp canvas
    // (the safe zone every launcher mask respects).
    const mark = Math.round(72 * scale);
    const inset = Math.round((foreground - mark) / 2);
    const background = await sharp({
      create: {
        width: foreground,
        height: foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const scaled = await sharp(svg, { density: 384 }).resize(mark, mark).png().toBuffer();
    const composed = await sharp(background)
      .composite([{ input: scaled, top: inset, left: inset }])
      .png()
      .toBuffer();
    await writeFile(path.join(dir, 'ic_launcher_foreground.png'), composed);
  }

  // Splash screens: brand background with the mark centred, portrait + landscape.
  const splashes = [
    ['drawable', 480, 480],
    ['drawable-port-mdpi', 320, 480],
    ['drawable-port-hdpi', 480, 800],
    ['drawable-port-xhdpi', 720, 1280],
    ['drawable-port-xxhdpi', 960, 1600],
    ['drawable-port-xxxhdpi', 1280, 1920],
    ['drawable-land-mdpi', 480, 320],
    ['drawable-land-hdpi', 800, 480],
    ['drawable-land-xhdpi', 1280, 720],
    ['drawable-land-xxhdpi', 1600, 960],
    ['drawable-land-xxxhdpi', 1920, 1280],
  ];

  for (const [folder, width, height] of splashes) {
    const dir = path.join(resRoot, folder);
    await mkdir(dir, { recursive: true });
    const markSize = Math.round(Math.min(width, height) * 0.32);
    const mark = await sharp(svg, { density: 384 }).resize(markSize, markSize).png().toBuffer();
    const canvas = await sharp({
      create: { width, height, channels: 4, background: BRAND_BACKGROUND },
    })
      .png()
      .toBuffer();
    const composed = await sharp(canvas)
      .composite([
        { input: mark, top: Math.round((height - markSize) / 2), left: Math.round((width - markSize) / 2) },
      ])
      .png()
      .toBuffer();
    await writeFile(path.join(dir, 'splash.png'), composed);
  }

  // Each write above is a real PNG that Android can use as-is.
  process.stdout.write(`icons + splashes generated from ${path.relative(process.cwd(), source)}\n`);
}

main().catch((error) => {
  process.stderr.write(`icon generation failed: ${error?.message ?? error}\n`);
  process.exit(1);
});
