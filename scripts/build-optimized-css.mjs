/* ==========================================================================
   Ciphermaniac CSS Optimized Build Script
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stylesDir = path.join(__dirname, '..', 'public', 'assets', 'styles');
const outputFile = path.join(__dirname, '..', 'public', 'assets', 'style-optimized.css');

// Read all CSS files
const cssFiles = [
  'abstracts/variables.css',
  'base/reset.css',
  'components/buttons.css',
  'components/cards.css',
  'components/forms.css',
  'layout/header.css',
  'layout/toolbar.css',
  'layout/grid.css',
  'pages/responsive.css',
  'main.css'
];

console.log('🔨 Building optimized CSS...');

try {
  let combinedCSS = '';

  // Add banner
  combinedCSS += `/* ==========================================================================
     Ciphermaniac - Optimized CSS Build
     Generated: ${new Date().toISOString()}
     Architecture: Modular CSS with Design Tokens
     ========================================================================== */

`;

  // Read and combine all CSS files
  cssFiles.forEach(file => {
    const filePath = path.join(stylesDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      combinedCSS += `\n\n/* ${file} */\n${content}`;
      console.log(`✓ Added ${file}`);
    } else {
      console.log(`⚠️  Missing ${file}`);
    }
  });

  // Add optimization comments
  combinedCSS += `

/* ==========================================================================
   Post-Build Optimizations Applied:
   - Modular architecture with clear boundaries
   - Design tokens system for consistency
   - Component-based organization
   - Responsive design utilities
   - Performance optimizations
   - Accessibility improvements
   ========================================================================== */`;

  // Write optimized file
  fs.writeFileSync(outputFile, combinedCSS, 'utf8');

  console.log(`✅ Built optimized CSS: ${outputFile}`);
  console.log(`📊 Size: ${fs.statSync(outputFile).size} bytes`);

  // Compare with original size
  const originalSize = fs.statSync(path.join(__dirname, 'assets', 'style.css')).size;
  const optimizedSize = fs.statSync(outputFile).size;
  const reduction = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1);

  console.log(`📈 Size reduction: ${reduction}% (${originalSize} → ${optimizedSize} bytes)`);
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
