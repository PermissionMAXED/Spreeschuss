import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { glbResourceUris } from "./audit-lib.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(await readFile(resolve(ROOT, "assets/manifest.json"), "utf8"));
const files = manifest.packs.flatMap((pack) => pack.files);
const counts = { model: 0, image: 0, audio: 0 };

for (const file of files) {
  const bytes = await readFile(resolve(ROOT, "public", file.path));
  if (file.kind === "model") {
    const resourceUris = glbResourceUris(bytes, file.path);
    for (const uri of resourceUris) {
      if (/^(?:[a-z]+:|\/\/|\/)/iu.test(uri)) throw new Error(`${file.path} depends on an external GLTF resource`);
      const dependency = resolve(ROOT, "public", dirname(file.path), decodeURIComponent(uri));
      const fromPublic = relative(resolve(ROOT, "public"), dependency);
      if (fromPublic === ".." || fromPublic.startsWith(`..${sep}`)) {
        throw new Error(`${file.path} has an unsafe GLTF dependency path`);
      }
      await readFile(dependency);
    }
  } else if (file.kind === "image") {
    const pngSignature = "89504e470d0a1a0a";
    if (bytes.subarray(0, 8).toString("hex") !== pngSignature) {
      throw new Error(`${file.path} is not a valid PNG file`);
    }
  } else if (file.kind === "audio") {
    const extension = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
    if (extension === ".wav" && (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WAVE")) {
      throw new Error(`${file.path} is not a valid PCM WAV file`);
    }
    if (![".m4a", ".mp3", ".wav"].includes(extension)) {
      throw new Error(`${file.path} has a forbidden runtime audio extension`);
    }
  } else {
    throw new Error(`${file.path} has unknown kind "${String(file.kind)}"`);
  }
  counts[file.kind] += 1;
}

console.log(
  `Runtime asset check passed: ${counts.model} offline-resolvable GLB models parsed, `
  + `${counts.image} PNG images validated, ${counts.audio} offline audio files validated.`,
);
