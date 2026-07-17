import { access, readFile } from "node:fs/promises";

const required = [
  "capacitor.config.ts",
  "node_modules/@capacitor/core/package.json",
  "node_modules/@capacitor/ios/package.json",
  "dist/index.html",
];

await Promise.all(required.map((path) => access(path)));
const config = await readFile("capacitor.config.ts", "utf8");
if (!config.includes('appId: "com.gooby.pet"') || !config.includes('webDir: "dist"')) {
  throw new Error("Capacitor appId/webDir contract is missing");
}
console.log("Capacitor thin-shell inputs are present and the web build is ready to sync.");
