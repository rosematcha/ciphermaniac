#!/usr/bin/env node
/**
 * Generate Open Graph image (1200x630) for social media sharing
 *
 * This creates a branded image with the Ciphermaniac logo and tagline
 * for use in social media previews (Twitter, Facebook, Discord, etc.)
 */

import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const imagesDir = join(projectRoot, 'public', 'assets', 'images');

// OG Image dimensions (recommended by most platforms)
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Brand colors from the site
const BRAND_YELLOW = '#fee475';
const BG_DARK = '#1a1a2e';
const BG_GRADIENT_END = '#16213e';

async function generateOgImage() {
  const svgPath = join(imagesDir, 'logo.svg');
  const outputPath = join(imagesDir, 'og-image.png');

  if (!existsSync(svgPath)) {
    console.error('Error: logo.svg not found at', svgPath);
    process.exit(1);
  }

  console.log('Generating Open Graph image (1200x630)...');

  // Create the logo at a good size for the OG image
  const logoSize = 200;
  const logoBuffer = await sharp(readFileSync(svgPath), { density: 300 })
    .resize(logoSize, logoSize, {
      fit: 'contain',
      // eslint-disable-next-line id-length -- Sharp API requires r, g, b for RGB colors
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  // Create SVG for the background and text
  const svgOverlay = `
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${BG_DARK};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${BG_GRADIENT_END};stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <!-- Background -->
      <rect width="100%" height="100%" fill="url(#bgGradient)"/>
      
      <!-- Decorative elements -->
      <circle cx="100" cy="100" r="300" fill="${BRAND_YELLOW}" opacity="0.03"/>
      <circle cx="1100" cy="530" r="400" fill="${BRAND_YELLOW}" opacity="0.03"/>
      
      <!-- Title text -->
      <text x="${OG_WIDTH / 2}" y="380" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-size="72" 
            font-weight="700" 
            fill="${BRAND_YELLOW}" 
            text-anchor="middle">
        Ciphermaniac
      </text>
      
      <!-- Tagline -->
      <text x="${OG_WIDTH / 2}" y="450" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-size="32" 
            font-weight="400" 
            fill="#94a3b8" 
            text-anchor="middle">
        Pokemon TCG Meta Analysis
      </text>
      
      <!-- Subtitle -->
      <text x="${OG_WIDTH / 2}" y="510" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-size="24" 
            font-weight="400" 
            fill="#64748b" 
            text-anchor="middle">
        Tournament Data • Deck Archetypes • Card Statistics
      </text>
    </svg>
  `;

  // Create base image with SVG overlay
  const baseImage = await sharp(Buffer.from(svgOverlay)).png().toBuffer();

  // Composite the logo on top
  await sharp(baseImage)
    .composite([
      {
        input: logoBuffer,
        top: 100,
        left: Math.floor((OG_WIDTH - logoSize) / 2)
      }
    ])
    .png({ quality: 90 })
    .toFile(outputPath);

  console.log('✅ Generated og-image.png (1200x630)');
  console.log(`   Output: ${outputPath}`);
}

generateOgImage().catch(console.error);
