import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const folder = new URL('../extension/icons/', import.meta.url);
const source = await readFile(new URL('icon.svg', folder));
for (const size of [16, 32, 48, 128]) {
  await writeFile(new URL(`icon${size}.png`, folder), await sharp(source).resize(size, size).png().toBuffer());
}
console.log('Generated Majapi icons at 16, 32, 48 and 128 pixels.');
