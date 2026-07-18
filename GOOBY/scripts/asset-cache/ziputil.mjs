/**
 * Minimal ZIP central-directory reader used to validate archives BEFORE any
 * bytes are extracted. Metadata (entry names, symlink attributes, declared
 * sizes) comes from this parser; decompression itself is delegated to the
 * system unzip binary only after validation passes.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD64_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_EOCD_SCAN = 65_557;

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - MAX_EOCD_SCAN);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return {
        offset,
        entryCount: buffer.readUInt16LE(offset + 10),
        centralSize: buffer.readUInt32LE(offset + 12),
        centralOffset: buffer.readUInt32LE(offset + 16),
      };
    }
  }
  throw new Error("Not a ZIP archive: end-of-central-directory record is missing");
}

function readZip64(buffer, eocd) {
  const locatorOffset = eocd.offset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== EOCD64_LOCATOR_SIGNATURE) {
    return eocd;
  }
  const zip64Offset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (buffer.readUInt32LE(zip64Offset) !== EOCD64_SIGNATURE) {
    throw new Error("Corrupt ZIP64 end-of-central-directory record");
  }
  return {
    ...eocd,
    entryCount: Number(buffer.readBigUInt64LE(zip64Offset + 32)),
    centralSize: Number(buffer.readBigUInt64LE(zip64Offset + 40)),
    centralOffset: Number(buffer.readBigUInt64LE(zip64Offset + 48)),
  };
}

function zip64Sizes(extra, entry) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    if (headerId === 0x0001) {
      let bodyCursor = 0;
      const next = () => {
        const value = Number(body.readBigUInt64LE(bodyCursor));
        bodyCursor += 8;
        return value;
      };
      if (entry.uncompressedBytes === 0xffffffff) entry.uncompressedBytes = next();
      if (entry.compressedBytes === 0xffffffff) entry.compressedBytes = next();
    }
    cursor += 4 + size;
  }
}

/**
 * Returns every central-directory entry with the metadata needed for safety
 * validation: exact name, declared sizes, and whether the external attributes
 * mark the entry as a symbolic link.
 */
export function readZipEntries(buffer) {
  const eocd = readZip64(buffer, findEndOfCentralDirectory(buffer));
  const entries = [];
  let cursor = eocd.centralOffset;
  for (let index = 0; index < eocd.entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP central directory at entry ${index}`);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const entry = {
      name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      compressedBytes: buffer.readUInt32LE(cursor + 20),
      uncompressedBytes: buffer.readUInt32LE(cursor + 24),
      unixMode: (externalAttributes >>> 16) & 0xffff,
    };
    if (entry.compressedBytes === 0xffffffff || entry.uncompressedBytes === 0xffffffff) {
      zip64Sizes(buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength), entry);
    }
    entry.isDirectory = entry.name.endsWith("/");
    entry.isSymlink = (entry.unixMode & 0xf000) === 0xa000;
    entries.push(entry);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Builds a store-method (uncompressed) ZIP archive. Test/tooling helper. */
export function writeStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = file.data ?? Buffer.alloc(0);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((file.unixMode ?? 0o644) << 16 >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralBytes = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, centralBytes, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
