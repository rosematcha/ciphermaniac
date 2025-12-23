#!/usr/bin/env node
/**
 * Generate favicon PNG files from SVG logo for SEO/Google compatibility
 *
 * Google requires PNG favicons at specific sizes for search result display.
 * This script converts the SVG logo to all required PNG sizes.
 */

import sharp from 'sharp';
import { copyFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const publicDir = join(projectRoot, 'public');
const imagesDir = join(publicDir, 'assets', 'images');

// Favicon sizes required for full compatibility
const FAVICON_SIZES = [
  { size: 16, name: 'favicon-16x16.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 48, name: 'favicon-48x48.png' },
  { size: 96, name: 'favicon-96x96.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'android-chrome-192x192.png' },
  { size: 512, name: 'android-chrome-512x512.png' }
];

async function generateFavicons() {
  const svgPath = join(imagesDir, 'logo.svg');

  if (!existsSync(svgPath)) {
    console.error('Error: logo.svg not found at', svgPath);
    process.exit(1);
  }

  const svgBuffer = readFileSync(svgPath);

  console.log('Generating favicon PNG files from logo.svg...\n');

  for (const { size, name } of FAVICON_SIZES) {
    const outputPath = join(imagesDir, name);

    try {
      await sharp(svgBuffer, { density: 300 })
        .resize(size, size, {
          fit: 'contain',
          // eslint-disable-next-line id-length -- Sharp API requires r, g, b for RGB colors
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);

      console.log(`  ✓ ${name} (${size}x${size})`);
    } catch (err) {
      console.error(`  ✗ Failed to generate ${name}:`, err.message);
    }
  }

  // Also generate a standard favicon.ico (using 48x48 as base)
  const icoPath = join(publicDir, 'favicon.ico');
  try {
    await sharp(svgBuffer, { density: 300 })
      .resize(48, 48, {
        fit: 'contain',
        // eslint-disable-next-line id-length -- Sharp API requires r, g, b for RGB colors
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(icoPath.replace('.ico', '.png'));

    // Sharp can't create .ico directly, but we can use the 48x48 PNG
    // and rename it - browsers accept PNG with .ico extension
    copyFileSync(icoPath.replace('.ico', '.png'), icoPath);

    console.log(`  ✓ favicon.ico (48x48 PNG)`);
  } catch (err) {
    console.error(`  ✗ Failed to generate favicon.ico:`, err.message);
  }

  console.log('\n✅ Favicon generation complete!');
  console.log('\nGenerated files in public/assets/images/:');
  FAVICON_SIZES.forEach(({ name }) => console.log(`  - ${name}`));
  console.log('  - favicon.ico (in public/)');
}

generateFavicons().catch(console.error);
