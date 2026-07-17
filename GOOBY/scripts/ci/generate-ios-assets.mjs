import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "../..");
const appIconDir = resolve(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const splashDir = resolve(root, "ios/App/App/Assets.xcassets/Splash.imageset");

const iconSlots = [
  ["Icon-20.png", 20, "ipad", "20x20", "1x"],
  ["Icon-20@2x.png", 40, "iphone", "20x20", "2x"],
  ["Icon-20@2x-ipad.png", 40, "ipad", "20x20", "2x"],
  ["Icon-20@3x.png", 60, "iphone", "20x20", "3x"],
  ["Icon-29.png", 29, "ipad", "29x29", "1x"],
  ["Icon-29@2x.png", 58, "iphone", "29x29", "2x"],
  ["Icon-29@2x-ipad.png", 58, "ipad", "29x29", "2x"],
  ["Icon-29@3x.png", 87, "iphone", "29x29", "3x"],
  ["Icon-40.png", 40, "ipad", "40x40", "1x"],
  ["Icon-40@2x.png", 80, "iphone", "40x40", "2x"],
  ["Icon-40@2x-ipad.png", 80, "ipad", "40x40", "2x"],
  ["Icon-40@3x.png", 120, "iphone", "40x40", "3x"],
  ["Icon-60@2x.png", 120, "iphone", "60x60", "2x"],
  ["Icon-60@3x.png", 180, "iphone", "60x60", "3x"],
  ["Icon-76.png", 76, "ipad", "76x76", "1x"],
  ["Icon-76@2x.png", 152, "ipad", "76x76", "2x"],
  ["Icon-83.5@2x.png", 167, "ipad", "83.5x83.5", "2x"],
  ["Icon-1024.png", 1024, "ios-marketing", "1024x1024", "1x"],
];

const palette = {
  apricot: [241, 158, 82],
  apricotLight: [250, 190, 116],
  brown: [91, 55, 47],
  cream: [255, 242, 213],
  creamShade: [244, 215, 177],
  pink: [239, 143, 137],
  white: [255, 255, 255],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodeRgbPng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    pixels.copy(rows, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ellipse(x, y, cx, cy, rx, ry, rotation = 0) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  const localX = dx * cosine + dy * sine;
  const localY = -dx * sine + dy * cosine;
  return (localX * localX) / (rx * rx) + (localY * localY) / (ry * ry) <= 1;
}

function line(x, y, ax, ay, bx, by, width) {
  const abx = bx - ax;
  const aby = by - ay;
  const projection = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(x - (ax + abx * projection), y - (ay + aby * projection)) <= width;
}

function bunnyPixel(x, y) {
  let color = null;
  if (ellipse(x, y, 0.35, 0.30, 0.105, 0.255, -0.16)) color = palette.brown;
  if (ellipse(x, y, 0.65, 0.30, 0.105, 0.255, 0.16)) color = palette.brown;
  if (ellipse(x, y, 0.35, 0.30, 0.082, 0.225, -0.16)) color = palette.cream;
  if (ellipse(x, y, 0.65, 0.30, 0.082, 0.225, 0.16)) color = palette.cream;
  if (ellipse(x, y, 0.35, 0.30, 0.038, 0.165, -0.16)) color = palette.pink;
  if (ellipse(x, y, 0.65, 0.30, 0.038, 0.165, 0.16)) color = palette.pink;
  if (ellipse(x, y, 0.50, 0.62, 0.365, 0.32)) color = palette.brown;
  if (ellipse(x, y, 0.50, 0.61, 0.335, 0.29)) color = palette.cream;
  if (ellipse(x, y, 0.28, 0.69, 0.105, 0.065, -0.15)) color = palette.creamShade;
  if (ellipse(x, y, 0.72, 0.69, 0.105, 0.065, 0.15)) color = palette.creamShade;
  if (ellipse(x, y, 0.35, 0.60, 0.075, 0.055)) color = palette.pink;
  if (ellipse(x, y, 0.65, 0.60, 0.075, 0.055)) color = palette.pink;
  if (ellipse(x, y, 0.39, 0.52, 0.038, 0.057)) color = palette.brown;
  if (ellipse(x, y, 0.61, 0.52, 0.038, 0.057)) color = palette.brown;
  if (ellipse(x, y, 0.38, 0.50, 0.012, 0.017)) color = palette.white;
  if (ellipse(x, y, 0.60, 0.50, 0.012, 0.017)) color = palette.white;
  if (ellipse(x, y, 0.50, 0.60, 0.047, 0.036)) color = palette.pink;
  if (line(x, y, 0.50, 0.625, 0.50, 0.67, 0.011)) color = palette.brown;
  if (line(x, y, 0.50, 0.67, 0.455, 0.69, 0.011)) color = palette.brown;
  if (line(x, y, 0.50, 0.67, 0.545, 0.69, 0.011)) color = palette.brown;
  if (x >= 0.455 && x <= 0.498 && y >= 0.682 && y <= 0.755) color = palette.white;
  if (x >= 0.502 && x <= 0.545 && y >= 0.682 && y <= 0.755) color = palette.white;
  return color;
}

function render(width, height, mode) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const distance = Math.min(1, Math.hypot(u - 0.45, v - 0.35));
      let color = mode === "icon"
        ? palette.apricot.map((channel, index) =>
          Math.round(channel * (1 - distance * 0.14) + palette.apricotLight[index] * distance * 0.14))
        : [250, 224, 188];

      if (mode === "icon") {
        if (ellipse(u, v, 0.13, 0.15, 0.055, 0.055) || ellipse(u, v, 0.88, 0.83, 0.075, 0.075)) {
          color = palette.apricotLight;
        }
        color = bunnyPixel(u, v) ?? color;
      } else {
        if (ellipse(u, v, 0.5, 0.5, 0.335, 0.335)) color = [244, 173, 99];
        if (ellipse(u, v, 0.5, 0.5, 0.305, 0.305)) color = [255, 232, 200];
        if (ellipse(u, v, 0.15, 0.19, 0.022, 0.055, -0.55)) color = palette.apricot;
        if (ellipse(u, v, 0.86, 0.81, 0.022, 0.055, 0.55)) color = palette.apricot;
        const localX = (u - 0.5) / 0.43 + 0.5;
        const localY = (v - 0.5) / 0.43 + 0.5;
        color = bunnyPixel(localX, localY) ?? color;
      }

      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return encodeRgbPng(width, height, pixels);
}

await Promise.all([mkdir(appIconDir, { recursive: true }), mkdir(splashDir, { recursive: true })]);
await Promise.all(iconSlots.map(async ([filename, pixels]) => {
  await writeFile(resolve(appIconDir, filename), render(pixels, pixels, "icon"));
}));

await writeFile(resolve(splashDir, "Splash-1x.png"), render(2732, 2732, "splash"));
await Promise.all([
  copyFile(resolve(splashDir, "Splash-1x.png"), resolve(splashDir, "Splash-2x.png")),
  copyFile(resolve(splashDir, "Splash-1x.png"), resolve(splashDir, "Splash-3x.png")),
]);

const iconContents = {
  images: iconSlots.map(([filename, , idiom, size, scale]) => ({ filename, idiom, size, scale })),
  info: { author: "xcode", version: 1 },
};
const splashContents = {
  images: [
    { filename: "Splash-1x.png", idiom: "universal", scale: "1x" },
    { filename: "Splash-2x.png", idiom: "universal", scale: "2x" },
    { filename: "Splash-3x.png", idiom: "universal", scale: "3x" },
  ],
  info: { author: "xcode", version: 1 },
};
await Promise.all([
  writeFile(resolve(appIconDir, "Contents.json"), `${JSON.stringify(iconContents, null, 2)}\n`),
  writeFile(resolve(splashDir, "Contents.json"), `${JSON.stringify(splashContents, null, 2)}\n`),
]);

console.log(`Generated ${iconSlots.length} opaque original Gooby icons and 3 launch images.`);
