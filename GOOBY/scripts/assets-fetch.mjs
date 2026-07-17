import { existsSync } from "node:fs";
import { resolve } from "node:path";

const manifest = resolve("assets.vendor.json");
if (!existsSync(manifest)) {
  console.log("No vendor manifest: Gooby will use its complete procedural fallback library.");
  process.exit(0);
}

console.log("Vendor manifest detected. Asset downloads are intentionally delegated to the future asset specialist.");
