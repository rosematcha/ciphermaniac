/* Build optimized CSS */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stylesDir = path.join(__dirname, '..', 'public', 'assets', 'styles');
const outputFile = path.join(__dirname, '..', 'public', 'assets', 'style-optimized.css');
const coreOutputFile = path.join(__dirname, '..', 'public', 'assets', 'style-core.css');
const cardsOutputFile = path.join(__dirname, '..', 'public', 'assets', 'style-cards.css');
const archetypeOutputFile = path.join(__dirname, '..', 'public', 'assets', 'style-archetype.css');

console.log('🔨 Building optimized CSS...');

try {
  const buildBundle = (outputPath, files, title, suffix = '') => {
    let combinedCSS = `/* ==========================================================================
     ${title}
     Generated: ${new Date().toISOString()}
     ========================================================================== */\n`;

    files.forEach(file => {
      const filePath = path.join(stylesDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        combinedCSS += `\n\n/* ${file} */\n${content}`;
        console.log(`✓ Added ${file}`);
      } else {
        console.log(`⚠️  Missing ${file}`);
      }
    });

    fs.writeFileSync(outputPath, `${combinedCSS}${suffix}`, 'utf8');
    const stats = fs.statSync(outputPath);
    console.log(`✅ Built CSS bundle: ${outputPath}`);
    console.log(`📊 Size: ${stats.size} bytes`);
  };

  const optimizedFiles = [
    'abstracts/_variables.css',
    'base/_reset.css',
    'components/_buttons.css',
    'components/_cards.css',
    'components/_forms.css',
    'layout/_header.css',
    'layout/_toolbar.css',
    'layout/_grid.css',
    'pages/_home.css',
    'pages/_card-detail.css',
    'pages/_trends.css',
    'pages/_archetypes.css',
    'pages/_archetype.css',
    'pages/_archetype-home.css',
    'pages/_archetype-trends.css',
    'pages/_binder.css',
    'pages/_about.css',
    'pages/_incidents.css',
    'pages/_feedback.css',
    'pages/_player.css',
    'pages/_players.css',
    'pages/_tools.css',
    'pages/_responsive.css',
    'main.css'
  ];

  const coreFiles = [
    'abstracts/_variables.css',
    'base/_reset.css',
    'components/_buttons.css',
    'components/_cards.css',
    'components/_forms.css',
    'layout/_header.css',
    'layout/_toolbar.css',
    'layout/_grid.css',
    'main.css'
  ];

  const cardsFiles = ['pages/_responsive.css'];
  const archetypeFiles = ['pages/_archetype.css', 'pages/_responsive.css'];

  const lowEndMotionSuffix = `\n\n/* Motion defer for low-end devices during first meaningful paint */\n.motion-deferred .card-entering,\n.motion-deferred .grid .card,\n.motion-deferred .archetype-page,\n.motion-deferred .archetype-main {\n  animation: none !important;\n  transition: none !important;\n}\n`;

  buildBundle(outputFile, optimizedFiles, 'Ciphermaniac - Optimized CSS Build');
  buildBundle(coreOutputFile, coreFiles, 'Ciphermaniac - Core CSS Bundle', lowEndMotionSuffix);
  buildBundle(cardsOutputFile, cardsFiles, 'Ciphermaniac - Cards CSS Bundle');
  buildBundle(archetypeOutputFile, archetypeFiles, 'Ciphermaniac - Archetype CSS Bundle');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
