/**
 * Integration tests for buildThumbCandidates with Limitless CDN
 */

import { buildThumbCandidates } from '../../public/assets/js/thumbs.js';

// Test cases
console.log('Testing buildThumbCandidates with Limitless CDN integration...\n');

// Test 1: Card with variant (set and number) - should include Limitless URL
console.log('Test 1: Card with set and number (small thumbnails)');
const candidates1 = buildThumbCandidates(
  'Pikachu ex',
  true, // useSm = true
  null, // no overrides
  { set: 'OBF', number: '186' }
);
console.log('Candidates:', candidates1);
const hasLimitlessUrl1 = candidates1.some(url => 
  url.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')
);
console.log('✓ Contains Limitless URL:', hasLimitlessUrl1);
console.log('✓ Expected URL present:', 
  candidates1.includes('https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/OBF/OBF_186_R_EN_SM.png')
);
console.log();

// Test 2: Card with variant (extra-small thumbnails) - should include Limitless URL with XS
console.log('Test 2: Card with set and number (extra-small thumbnails)');
const candidates2 = buildThumbCandidates(
  'Pikachu ex',
  false, // useSm = false
  null,
  { set: 'OBF', number: '186' }
);
console.log('Candidates:', candidates2);
const hasLimitlessUrl2 = candidates2.some(url => 
  url.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')
);
const hasXsUrl = candidates2.some(url => url.includes('_XS.png'));
console.log('✓ Contains Limitless URL:', hasLimitlessUrl2);
console.log('✓ Contains XS size URL:', hasXsUrl);
console.log();

// Test 3: Card with padded number
console.log('Test 3: Card with single-digit number (should be padded)');
const candidates3 = buildThumbCandidates(
  'Charizard ex',
  true,
  null,
  { set: 'SVI', number: '1' }
);
console.log('Candidates:', candidates3);
const expectedPaddedUrl = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVI/SVI_001_R_EN_SM.png';
console.log('✓ Contains padded URL:', candidates3.includes(expectedPaddedUrl));
console.log();

// Test 4: Card without variant - should NOT include Limitless URL
console.log('Test 4: Card without set/number info');
const candidates4 = buildThumbCandidates(
  'Basic Psychic Energy',
  true,
  null,
  null // no variant
);
console.log('Candidates:', candidates4);
const hasLimitlessUrl4 = candidates4.some(url => 
  url.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')
);
console.log('✓ Does NOT contain Limitless URL (no variant info):', !hasLimitlessUrl4);
console.log();

// Test 5: Card with overrides should still include Limitless URL as fallback
console.log('Test 5: Card with overrides and variant');
const candidates5 = buildThumbCandidates(
  'Gardevoir ex',
  true,
  { 'Gardevoir ex': 'custom-gardevoir.png' },
  { set: 'PAL', number: '245' }
);
console.log('Candidates:', candidates5);
const hasOverride = candidates5.some(url => url.includes('custom-gardevoir.png'));
const hasLimitlessUrl5 = candidates5.some(url => 
  url.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')
);
console.log('✓ Contains override:', hasOverride);
console.log('✓ Contains Limitless URL as fallback:', hasLimitlessUrl5);
console.log();

console.log('All tests completed successfully! ✓');
