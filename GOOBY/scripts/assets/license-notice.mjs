import { createHash } from "node:crypto";

export const LICENSE_NOTICE_ID = "kenney-asset-licenses";
export const LICENSE_NOTICE_CANONICAL_PATH = "assets/LICENSES.md";
export const LICENSE_NOTICE_BUNDLED_PATH = "assets/LICENSES.md";

/**
 * Committed markdown fragments contributed by the audio and sticker asset
 * domains. They merge into the generated license notice in this fixed order
 * so the composed document stays deterministic. Absent fragments are simply
 * omitted, which keeps generation total when a domain has not landed yet.
 */
export const DOMAIN_NOTICE_FRAGMENTS = [
  { id: "audio", path: "assets/audio/NOTICE.md" },
  { id: "stickers", path: "assets/stickers/NOTICE.md" },
];

const digest = (value) => createHash("sha256").update(value).digest("hex");

function includedPacks(packs) {
  return packs.filter((pack) => pack.license && Array.isArray(pack.files) && pack.files.length > 0);
}

function normalizedNotice(source) {
  return source
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim().length === 0 ? "" : line)
    .join("\n")
    .trim();
}

export function licenseNoticeDocument(packs, licenseSources, domainSections = []) {
  const included = includedPacks(packs);
  const fileCount = included.reduce((total, pack) => total + pack.files.length, 0);
  const rows = included.map((pack) =>
    `| ${pack.title} | [official page](${pack.pageUrl}) | \`${pack.archiveSha256}\` | `
    + `\`${pack.license.sha256}\` | ${pack.files.length} |`
  );
  const sections = included.map((pack) => {
    const source = licenseSources.get(pack.id);
    if (typeof source !== "string") throw new Error(`${pack.id}: genuine License.txt source is unavailable`);
    const files = pack.files.map((file) =>
      `  - \`${file.path}\` ← archive entry \`${file.sourceEntry}\`; SHA-256 \`${file.sha256}\``
    );
    return `## ${pack.title}

- Official source: ${pack.pageUrl}
- Source archive SHA-256: \`${pack.archiveSha256}\`
- Genuine notice: \`${pack.license.archiveEntry}\`; SHA-256 \`${pack.license.sha256}\`
- Curated files shipped by the app:
${files.join("\n")}

### Genuine archive notice

\`\`\`text
${normalizedNotice(source)}
\`\`\``;
  });

  const domainBlocks = domainSections
    .filter((section) => typeof section?.markdown === "string" && section.markdown.trim().length > 0)
    .map((section) => section.markdown.trim());

  return `# Third-party asset license notices

This bundled notice is generated from the genuine \`License.txt\` files copied from official Kenney archives. Kenney releases these packs under Creative Commons Zero (CC0); attribution is not required. Original notice wording appears below with layout whitespace and line endings normalized for stable packaging.

Provenance: **${included.length} packs / ${fileCount} curated files**.

| Pack | Official source | Archive SHA-256 | Genuine license SHA-256 | Curated files |
| --- | --- | --- | --- | ---: |
${rows.join("\n")}

${[...sections, ...domainBlocks].join("\n\n")}
`;
}

/**
 * When a domain's committed provenance data exists, the merged license notice
 * must carry that domain's genuine license evidence: source titles and every
 * recorded SHA-256 for audio, and the first-party license statement plus every
 * source-sheet SHA-256 for stickers.
 */
export function domainNoticeProvenanceViolations({ document, audioLock, stickerManifest }) {
  const violations = [];
  const requireInDocument = (domain, label, value) => {
    if (typeof value !== "string" || value.length === 0) return;
    if (typeof document !== "string" || !document.includes(value)) {
      violations.push(`${LICENSE_NOTICE_CANONICAL_PATH}: missing ${domain} ${label} "${value}"`);
    }
  };
  for (const [sourceId, source] of Object.entries(audioLock?.sources ?? {})) {
    requireInDocument("audio", `source title for ${sourceId}`, source.title);
    requireInDocument("audio", `archive SHA-256 for ${sourceId}`, source.archive?.sha256);
    requireInDocument("audio", `license SHA-256 for ${sourceId}`, source.license?.sha256);
    requireInDocument("audio", `source SHA-256 for ${sourceId}`, source.sha256);
  }
  if (stickerManifest) {
    requireInDocument("stickers", "license statement", stickerManifest.license);
    for (const sheet of stickerManifest.sourceSheets ?? []) {
      requireInDocument("stickers", `source sheet SHA-256 for ${sheet.page}`, sheet.sha256);
    }
  }
  return violations;
}

export function licenseNoticeRecord(document, packs) {
  const included = includedPacks(packs);
  const bytes = Buffer.from(document);
  return {
    id: LICENSE_NOTICE_ID,
    canonicalPath: LICENSE_NOTICE_CANONICAL_PATH,
    bundledPath: LICENSE_NOTICE_BUNDLED_PATH,
    bytes: bytes.length,
    sha256: digest(bytes),
    packIds: included.map(({ id }) => id),
    files: included.flatMap((pack) => pack.files.map(({ path }) => path)),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function publicCopyConfigurationViolations(viteConfigSource) {
  const violations = [];
  if (/\bcopyPublicDir\s*:\s*false\b/u.test(viteConfigSource)) {
    violations.push("vite.config.ts excludes public files from the production build");
  }
  const publicDir = viteConfigSource.match(/\bpublicDir\s*:\s*([^,\n}]+)/u)?.[1]?.trim();
  if (publicDir === "false") {
    violations.push("vite.config.ts disables the public directory");
  } else if (publicDir) {
    const literal = publicDir.match(/^["'](.+)["']$/u)?.[1];
    const normalized = literal?.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (normalized !== "public") {
      violations.push("vite.config.ts does not use the repository public directory");
    }
  }
  return violations;
}

export function licenseNoticeViolations({
  expectedDocument,
  expectedRecord,
  canonicalDocument,
  bundledDocument,
  manifestNotices,
  runtimeManifestSource,
  viteConfigSource,
  requiredPackIds,
  requiredFiles,
  builtDocument,
  nativeDocument,
}) {
  const violations = [];
  if (canonicalDocument === null) {
    violations.push(`${LICENSE_NOTICE_CANONICAL_PATH}: canonical license notice is missing`);
  } else if (canonicalDocument !== expectedDocument) {
    violations.push(`${LICENSE_NOTICE_CANONICAL_PATH}: canonical license notice is stale`);
  }

  if (bundledDocument === null) {
    violations.push(`public/${LICENSE_NOTICE_BUNDLED_PATH}: bundled license notice is missing`);
  } else if (bundledDocument !== expectedDocument) {
    violations.push(`public/${LICENSE_NOTICE_BUNDLED_PATH}: bundled license notice is stale`);
  }

  if (!sameJson(expectedRecord.packIds, requiredPackIds) || !sameJson(expectedRecord.files, requiredFiles)) {
    violations.push(
      `${LICENSE_NOTICE_CANONICAL_PATH}: license notice must cover all `
      + `${requiredPackIds.length} packs and ${requiredFiles.length} curated files`,
    );
  }

  const matchingNotices = (manifestNotices ?? []).filter(({ id }) => id === LICENSE_NOTICE_ID);
  if (matchingNotices.length !== 1) {
    violations.push(`assets/manifest.json must list exactly one ${LICENSE_NOTICE_ID} notice`);
  } else if (!sameJson(matchingNotices[0], expectedRecord)) {
    violations.push(`assets/manifest.json ${LICENSE_NOTICE_ID} notice metadata is stale`);
  }

  const runtimeDeclaration = runtimeManifestSource
    .match(/export const ASSET_LICENSE_NOTICE\s*=\s*\{([\s\S]*?)\}/u)?.[1];
  if (!runtimeDeclaration || !new RegExp(
    `path:\\s*"${LICENSE_NOTICE_BUNDLED_PATH.replace(".", "\\.")}"`,
    "u",
  ).test(runtimeDeclaration)) {
    violations.push(`src/data/assetManifest.ts does not list ${LICENSE_NOTICE_BUNDLED_PATH}`);
  } else if (
    !new RegExp(`packCount:\\s*${requiredPackIds.length}\\b`, "u").test(runtimeDeclaration)
    || !new RegExp(`fileCount:\\s*${requiredFiles.length}\\b`, "u").test(runtimeDeclaration)
  ) {
    violations.push("src/data/assetManifest.ts license notice provenance counts are stale");
  }
  violations.push(...publicCopyConfigurationViolations(viteConfigSource));

  if (builtDocument === null) {
    violations.push(`dist/${LICENSE_NOTICE_BUNDLED_PATH}: production build excluded the bundled license notice`);
  } else if (builtDocument !== undefined && builtDocument !== expectedDocument) {
    violations.push(`dist/${LICENSE_NOTICE_BUNDLED_PATH}: production license notice is stale`);
  }

  if (nativeDocument === null) {
    violations.push(`ios/App/App/public/${LICENSE_NOTICE_BUNDLED_PATH}: Capacitor copy excluded the bundled license notice`);
  } else if (nativeDocument !== undefined && nativeDocument !== expectedDocument) {
    violations.push(`ios/App/App/public/${LICENSE_NOTICE_BUNDLED_PATH}: Capacitor license notice is stale`);
  }
  return violations;
}
