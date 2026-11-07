// Run with: node --test tests/display.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextFocus } from '../js/core/display.js';

const box = (left, top, width = 100, height = 40) => ({ left, top, width, height });

// 3x2 grid of cards:   0 1 2
//                      3 4 5
const grid = [box(0, 0), box(150, 0), box(300, 0), box(0, 100), box(150, 100), box(300, 100)];

test('moves right and left within a row', () => {
  assert.equal(pickNextFocus(grid, 0, 'right'), 1);
  assert.equal(pickNextFocus(grid, 1, 'right'), 2);
  assert.equal(pickNextFocus(grid, 2, 'left'), 1);
});

test('moves down and up within a column', () => {
  assert.equal(pickNextFocus(grid, 1, 'down'), 4);
  assert.equal(pickNextFocus(grid, 5, 'up'), 2);
});

test('returns -1 at an edge instead of wrapping', () => {
  assert.equal(pickNextFocus(grid, 0, 'left'), -1);
  assert.equal(pickNextFocus(grid, 2, 'right'), -1);
  assert.equal(pickNextFocus(grid, 0, 'up'), -1);
  assert.equal(pickNextFocus(grid, 3, 'down'), -1);
});

test("prefers the aligned item over a nearer but misaligned one", () => {
  // Item 1 is nearer horizontally (110) but 100px lower; item 2 is further (250) and in line.
  const rects = [box(0, 0), box(110, 100), box(250, 0)];
  assert.equal(pickNextFocus(rects, 0, "right"), 2);
});

test('handles empty or invalid input', () => {
  assert.equal(pickNextFocus([], 0, 'right'), -1);
  assert.equal(pickNextFocus(grid, 99, 'right'), -1);
});
