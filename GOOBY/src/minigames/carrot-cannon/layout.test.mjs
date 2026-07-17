import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("Cannon exposes 44px switch controls that fit narrow portrait screens", () => {
  assert.match(css, /\.cc-game button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  assert.match(source, /role="group" aria-label="Carrot cannon aim controls"/);
  for (const action of ["aim-up", "aim-down", "power-down", "power-up", "fire"]) {
    assert.match(source, new RegExp(`data-action="${action}"`));
  }
  assert.match(css, /grid-template-columns:\s*44px 44px 60px 44px 44px/);
  const compactControlWidth = 44 * 4 + 60 + 6 * 4 + 20;
  assert.ok(compactControlWidth <= 375);
});

test("keyboard aiming, drag aiming, hit classes, and visible HP stay wired", () => {
  assert.match(source, /ArrowUp:\s*\[0, -1\]/);
  assert.match(source, /ArrowDown:\s*\[0, 1\]/);
  assert.match(source, /ArrowLeft:\s*\[-1, 0\]/);
  assert.match(source, /ArrowRight:\s*\[1, 0\]/);
  assert.match(source, /event\.key === " " \|\| event\.key === "Enter"/);
  assert.match(source, /pointerdown/);
  assert.match(source, /pointermove/);
  assert.match(source, /pointerup/);
  assert.match(source, /classList\.toggle\("is-hit"/);
  assert.match(source, /classList\.toggle\("is-miss"/);
  assert.match(source, /\$\{target\.hp\}\/\$\{target\.maxHp\} HP/);
  assert.doesNotMatch(source, /new AudioContext|navigator\.vibrate/);
  assert.match(source, /audio\?\.emit/);
  assert.match(source, /haptics\?\.impact/);
});
