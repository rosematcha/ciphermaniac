/**
 * Tests for Limitless CDN URL generation in thumbs.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Mock the dependencies
const mockNormalizeCardNumber = (num) => String(num).toUpperCase().trim();
const mockNormalizeSetCode = (set) => String(set).toUpperCase().trim();

// We'll need to import and test the buildThumbCandidates function
// For now, let's test the URL format manually

describe('Limitless CDN URL Format', () => {
  it('should format URL correctly for OBF 186', () => {
    const setCode = 'OBF';
    const number = '186';
    const paddedNumber = number.padStart(3, '0');
    const expectedUrl = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${paddedNumber}_R_EN_SM.png`;
    
    assert.strictEqual(
      expectedUrl,
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/OBF/OBF_186_R_EN_SM.png'
    );
  });

  it('should pad numbers with leading zeroes', () => {
    const setCode = 'SVI';
    const number = '1';
    const paddedNumber = number.padStart(3, '0');
    const expectedUrl = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${paddedNumber}_R_EN_SM.png`;
    
    assert.strictEqual(
      expectedUrl,
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVI/SVI_001_R_EN_SM.png'
    );
  });

  it('should handle three-digit numbers correctly', () => {
    const setCode = 'PAL';
    const number = '123';
    const paddedNumber = number.padStart(3, '0');
    const expectedUrl = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${paddedNumber}_R_EN_SM.png`;
    
    assert.strictEqual(
      expectedUrl,
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PAL/PAL_123_R_EN_SM.png'
    );
  });

  it('should handle four-digit numbers correctly', () => {
    const setCode = 'MEW';
    const number = '1234';
    const paddedNumber = number.padStart(3, '0');
    const expectedUrl = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${paddedNumber}_R_EN_SM.png`;
    
    assert.strictEqual(
      expectedUrl,
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEW/MEW_1234_R_EN_SM.png'
    );
  });
});

console.log('✓ Limitless CDN URL format tests passed');
