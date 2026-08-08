import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyV362Risk } from '../src/v362-risk.mjs';

test('V3.6.2 risk becomes high for a VIX surge or elevated option volatility', () => {
  const result = classifyV362Risk({
    vix: 21, vix5dPct: 12, vixThreshold: 18,
    atmIv: 0.25, atmHigh: 0.21, skew: 0.03, skewHigh: 0.04,
    foreign5d: -7000, foreignThreshold: 6300,
    shortAdd1d: 1600, shortAddThreshold: 1375,
  });
  assert.equal(result.level, 'high');
  assert.equal(result.foreignDirection, 'bearish_watch');
  assert.equal(result.shortAlert, 'high_add');
});

test('missing risk data stays unknown and is never treated as zero', () => {
  const result = classifyV362Risk({});
  assert.equal(result.level, 'unknown');
  assert.equal(result.vixLevel, 'unknown');
  assert.equal(result.optionLevel, 'unknown');
  assert.equal(result.foreignDirection, 'unknown');
});

test('normal volatility and small foreign change remain observational', () => {
  const result = classifyV362Risk({
    vix: 15, vix5dPct: -3, vixThreshold: 18,
    atmIv: 0.15, atmHigh: 0.21, skew: 0.02, skewHigh: 0.04,
    foreign5d: -3000, foreignThreshold: 6300,
    shortAdd1d: 500, shortAddThreshold: 1375,
  });
  assert.equal(result.level, 'low');
  assert.equal(result.foreignDirection, 'neutral');
  assert.equal(result.shortAlert, 'small_add');
});
