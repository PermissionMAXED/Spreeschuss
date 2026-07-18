import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { embedToGlb, externalUris, parseGlb } from "./gltf.mjs";

export const CURATED_SCHEMA_VERSION = 1;
export const MAX_CURATED_FILE_BYTES = 10 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function safeRelative(baseDirectory, uri) {
  const segments = join(baseDirectory, uri).replaceAll("\\", "/").split("/");
  if (segments.includes("..")) throw new Error(`unsafe glTF resource URI "${uri}"`);
  return segments.join("/");
}

/**
 * Builds one deterministic self-contained GLB from a cached source model,
 * embedding every external buffer/image. Returns the output bytes plus the
 * exact input files consumed (path, hash, bytes) for provenance.
 */
export async function buildCuratedGlb(sourceRoot, sourcePath) {
  const modelBytes = await readFile(join(sourceRoot, sourcePath));
  const inputs = [{ path: sourcePath, bytes: modelBytes.length, sha256: sha256(modelBytes) }];
  const isBinary = sourcePath.toLowerCase().endsWith(".glb");
  const { json, bin } = isBinary
    ? parseGlb(modelBytes, sourcePath)
    : { json: JSON.parse(modelBytes.toString("utf8")), bin: null };

  const resources = new Map();
  for (const uri of externalUris(json)) {
    const relative = safeRelative(dirname(sourcePath), uri);
    const bytes = await readFile(join(sourceRoot, relative));
    resources.set(uri, bytes);
    inputs.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const output = embedToGlb(json, bin, (uri) => {
    const bytes = resources.get(uri);
    if (!bytes) throw new Error(`unresolved glTF resource "${uri}" in ${sourcePath}`);
    return bytes;
  });
  validateCuratedGlb(output, sourcePath);
  return { output, inputs };
}

/** A curated GLB must be renderable, self-contained, and within size limits. */
export function validateCuratedGlb(bytes, label) {
  const { json } = parseGlb(bytes, label);
  if (!Array.isArray(json.meshes) || json.meshes.length === 0) {
    throw new Error(`${label}: curated GLB contains no renderable meshes`);
  }
  const remaining = externalUris(json);
  if (remaining.length > 0) {
    throw new Error(`${label}: curated GLB still references external resources: ${remaining.join(", ")}`);
  }
  if (bytes.length > MAX_CURATED_FILE_BYTES) {
    throw new Error(`${label}: curated GLB is ${bytes.length} bytes, above the 10 MB limit`);
  }
}

/**
 * Runs the full deterministic model curation over a locked cache. Returns
 * files to commit (outputs plus verbatim licenses), the machine manifest, and
 * the human provenance document. Identical cache + spec always produce
 * byte-identical results.
 */
export async function curateModels({
  root,
  sourceDir,
  lock,
  specs,
  specSha256,
  licenseRoot,
  manifestPath,
  budgetBytes,
}) {
  const outputs = new Map();
  const licenses = new Map();
  const keys = {};
  const usedSources = new Map();
  let totalOutputBytes = 0;

  for (const spec of specs) {
    const locked = lock.sources[spec.sourceId];
    if (!locked) throw new Error(`${spec.key}: source ${spec.sourceId} is not locked; run assets:cache first`);
    const sourceRoot = join(root, sourceDir, spec.sourceId);
    const { output, inputs } = await buildCuratedGlb(sourceRoot, spec.sourcePath);
    if (outputs.has(spec.output)) throw new Error(`duplicate curated output path ${spec.output}`);
    outputs.set(spec.output, output);
    totalOutputBytes += output.length;
    usedSources.set(spec.sourceId, locked);
    keys[spec.key] = {
      fallback: spec.fallback,
      purpose: spec.purpose,
      mode: spec.mode,
      source: {
        id: spec.sourceId,
        path: spec.sourcePath,
        revision: locked.kind === "github-commit" ? locked.commit : locked.archive.sha256,
      },
      inputs,
      output: { path: spec.output, bytes: output.length, sha256: sha256(output) },
    };
  }

  const sources = {};
  for (const sourceId of [...usedSources.keys()].sort((left, right) => left.localeCompare(right))) {
    const locked = usedSources.get(sourceId);
    const licenseBytes = await readFile(join(root, sourceDir, sourceId, locked.license.entry));
    if (sha256(licenseBytes) !== locked.license.sha256) {
      throw new Error(`${sourceId}: cached license no longer matches the locked evidence`);
    }
    const licensePath = `${licenseRoot}/${sourceId}/License.txt`;
    licenses.set(licensePath, licenseBytes);
    sources[sourceId] = {
      kind: locked.kind,
      title: locked.title,
      creator: locked.creator,
      ...(locked.pageUrl ? { pageUrl: locked.pageUrl } : {}),
      ...(locked.repoUrl ? { repoUrl: locked.repoUrl, commit: locked.commit } : {}),
      downloadUrl: locked.downloadUrl,
      archiveSha256: locked.archive.sha256,
      license: {
        path: licensePath,
        sourceEntry: locked.license.entry,
        bytes: licenseBytes.length,
        sha256: locked.license.sha256,
        spdx: locked.license.spdx,
        evidence: locked.license.evidence,
      },
    };
  }

  const manifest = {
    schemaVersion: CURATED_SCHEMA_VERSION,
    domain: "models",
    generator: "scripts/asset-cache/curate.mjs",
    spec: { path: "scripts/asset-cache/curation-spec.mjs", sha256: specSha256 },
    budget: { maxRuntimeBytes: budgetBytes },
    totalOutputBytes,
    sources,
    keys,
  };
  return {
    outputs,
    licenses,
    manifest,
    manifestPath,
    document: curatedDocument(manifest),
  };
}

export function curatedDocument(manifest) {
  const keyRows = Object.entries(manifest.keys).map(([key, record]) =>
    `| \`${key}\` | ${record.purpose} | ${record.source.id} | \`${record.source.path}\` | `
    + `\`${record.output.path}\` | ${record.output.bytes} |`);
  const sourceSections = Object.entries(manifest.sources).map(([sourceId, source]) => {
    const origin = source.pageUrl
      ? `- Official page: ${source.pageUrl}`
      : `- Repository: ${source.repoUrl} @ \`${source.commit}\``;
    return `## ${source.title}

- Source id: \`${sourceId}\` (${source.creator}, ${source.license.spdx})
${origin}
- Locked archive SHA-256: \`${source.archiveSha256}\`
- Verbatim license: \`${source.license.path}\` (from \`${source.license.sourceEntry}\`; SHA-256 \`${source.license.sha256}\`)`;
  });
  return `# Curated asset provenance

Deterministically generated by \`npm run assets:curate\` from the locked source
cache (\`assets/sources.lock.json\`) and the checked-in curation spec
(\`${manifest.spec.path}\`, SHA-256 \`${manifest.spec.sha256}\`). Only the
optimized outputs listed here and the verbatim source licenses are committed;
complete sources stay in the ignored \`.asset-cache/\`.

Total curated output: **${Object.keys(manifest.keys).length} planned keys / ${manifest.totalOutputBytes} bytes**.

| Planned key | Purpose | Source | Genuine source file | Curated output | Bytes |
| --- | --- | --- | --- | --- | ---: |
${keyRows.join("\n")}

${sourceSections.join("\n\n")}
`;
}
