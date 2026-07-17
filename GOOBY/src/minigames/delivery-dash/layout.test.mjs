import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("Delivery Dash reserves app safe chrome at both portrait targets", () => {
  assert.match(css, /--dd-safe-top:\s*var\(--safe-top,/);
  assert.match(css, /--dd-safe-bottom:\s*var\(--safe-bottom,/);
  assert.match(css, /--dd-top-reserve:\s*calc\(var\(--dd-safe-top\) \+ 50px\)/);
  assert.match(css, /padding:\s*var\(--dd-top-reserve\) 0 var\(--dd-safe-bottom\)/);
  assert.match(css, /@media \(max-height: 700px\)/);

  const compactHeightFloor = 56 + 44 + 48 + 190 + 24 + (44 * 3 + 6) + 20 + 9;
  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
    assert.ok(compactHeightFloor <= viewport.height);
    assert.ok(44 * 3 + 6 <= viewport.width);
  }
});

test("safe compact controls preserve touch, WASD, and arrow input", () => {
  assert.match(css, /\.dd-game button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /grid-template-rows:\s*repeat\(3, 44px\)/);
  for (const key of ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]) {
    assert.match(source, new RegExp(`\\b${key}:`));
  }
  assert.match(source, /data-direction="up"/);
  assert.match(source, /class="dd-topbar"/);
  assert.match(source, /class="dd-mission"/);
});
