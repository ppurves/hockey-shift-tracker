// Renders assets/icon.svg to the PNG icon set in public/icons. Run: npm run icons
import sharp from 'sharp';
import { readFile, copyFile } from 'node:fs/promises';

const svg = await readFile('assets/icon.svg');
const out = 'public/icons';
const sizes = { 'apple-touch-icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
for (const [name, size] of Object.entries(sizes)) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`${out}/${name}`);
}
// Maskable: shrink artwork into the 80% safe zone on a full-bleed background.
const inner = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#1f4e79' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(`${out}/icon-maskable-512.png`);
await copyFile('assets/icon.svg', `${out}/icon.svg`);
console.log('icons written to', out);
