import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const garden = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const cannon = readFileSync(new URL("../carrot-cannon/index.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../delivery-dash/index.ts", import.meta.url), "utf8");

test("Garden armor charging uses real pointer and keyboard holds", () => {
  for (const eventName of ["pointerdown", "pointerup", "pointercancel", "keydown", "keyup"]) {
    assert.match(garden, new RegExp(`"${eventName}"`));
  }
  assert.match(garden, /beginGardenBonk\(this\.state, slot\)/);
  assert.match(garden, /releaseGardenBonk\(this\.state, slot\)/);
  assert.match(garden, /const lateKeys:[^=]+=\s*\{\s*q:\s*9,\s*w:\s*10,\s*e:\s*11\s*\}/s);
});

test("Cannon preserves pointer drag and keyboard/switch fire parity", () => {
  for (const eventName of ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown"]) {
    assert.match(cannon, new RegExp(`"${eventName}"`));
  }
  assert.match(cannon, /event\.key === " " \|\| event\.key === "Enter"/);
  assert.match(cannon, /data-action="fire"/);
});

test("Delivery steering stays held until key or pointer release and clears on blur", () => {
  assert.match(delivery, /private pressedKeys = new Set<string>\(\)/);
  assert.match(delivery, /document\.addEventListener\("keydown"/);
  assert.match(delivery, /document\.addEventListener\("keyup"/);
  assert.match(delivery, /this\.pressedKeys\.add\(event\.key\.toLowerCase\(\)\)/);
  assert.match(delivery, /this\.pressedKeys\.delete\(key\)/);
  assert.match(delivery, /view\?\.addEventListener\("blur", this\.onInputBlur\)/);
  assert.match(delivery, /button\.setPointerCapture\(event\.pointerId\)/);
});
