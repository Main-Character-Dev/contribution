import { openSync, closeSync, readSync, lstatSync, mkdirSync, writeFileSync, chmodSync, fsyncSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { requireValue, Fault } from './core.js';

const MAX_ARCHIVE = 1024 ** 3, MAX_FILE = 256 * 1024 ** 2, MAX_ENTRIES = 50000;
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0; });
function crc32(data: Uint8Array): number { let value = 0xffffffff; for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!; return (value ^ 0xffffffff) >>> 0; }
interface Entry { name: string; bytes: Buffer; directory: boolean; mode: number; compressed: number; size: number; crc: number; method: number; flags: number; offset: number }

/** Read only a constrained signed-app ZIP. No general-purpose archive paths,
 * symbolic links, device nodes, ZIP64, encryption or unbounded decompression.
 * Path validation precedes writes; each file's checksum precedes its exclusive
 * creation. The destination is a new private owned directory.
 */
export function extractSignedAppArchive(archive: string, destination: string, appName: string): { appPath: string; files: number; bytes: number } {
  requireValue(/^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,120}\.app$/.test(appName), 'INVALID_APP_ARCHIVE', 'The archive must name one approved app bundle.', 2);
  const info = lstatSync(archive);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size >= 22 && info.size <= MAX_ARCHIVE, 'INVALID_APP_ARCHIVE', 'The archive must be a bounded regular ZIP file.', 3);
  requireValue(!existsSync(destination), 'ARTIFACT_DESTINATION_EXISTS', 'Extraction requires a fresh owned staging directory.');
  const fd = openSync(archive, 'r');
  try {
    const read = (offset: number, size: number): Buffer => {
      requireValue(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && size <= MAX_ARCHIVE && offset + size <= info.size, 'INVALID_APP_ARCHIVE', 'Archive range exceeds its declared file.', 3);
      const data = Buffer.alloc(size); let count = 0;
      while (count < size) { const got = readSync(fd, data, count, size - count, offset + count); requireValue(got > 0, 'ARTIFACT_CHANGED', 'Archive bytes changed during inspection.'); count += got; }
      return data;
    };
    const tailOffset = Math.max(0, info.size - 65557), tail = read(tailOffset, info.size - tailOffset);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    requireValue(end >= 0, 'INVALID_APP_ARCHIVE', 'ZIP end record is absent or ambiguous.', 3);
    const disk = tail.readUInt16LE(end + 4), directoryDisk = tail.readUInt16LE(end + 6), diskEntries = tail.readUInt16LE(end + 8), count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), directoryOffset = tail.readUInt32LE(end + 16);
    requireValue(disk === 0 && directoryDisk === 0 && diskEntries === count && count > 0 && count <= MAX_ENTRIES && directorySize <= 32 * 1024 * 1024 && directoryOffset + directorySize === tailOffset + end,
      'INVALID_APP_ARCHIVE', 'Multi-disk, ZIP64 and oversized archive directories are unsupported.', 3);
    const directory = read(directoryOffset, directorySize), entries: Entry[] = [], paths = new Map<string, boolean>(); let cursor = 0, total = 0;
    for (let index = 0; index < count; index++) {
      requireValue(cursor + 46 <= directory.length && directory.readUInt32LE(cursor) === 0x02014b50, 'INVALID_APP_ARCHIVE', 'Archive directory entry is malformed.', 3);
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), crc = directory.readUInt32LE(cursor + 16), compressed = directory.readUInt32LE(cursor + 20), size = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28), extraLength = directory.readUInt16LE(cursor + 30), commentLength = directory.readUInt16LE(cursor + 32), attributes = directory.readUInt32LE(cursor + 38), offset = directory.readUInt32LE(cursor + 42);
      requireValue(nameLength > 0 && nameLength <= 4096 && cursor + 46 + nameLength + extraLength + commentLength <= directory.length && directory.readUInt16LE(cursor + 34) === 0 &&
        (flags & ~0x080e) === 0 && [0, 8].includes(method) && size <= MAX_FILE && compressed <= MAX_FILE && offset < directoryOffset,
        'INVALID_APP_ARCHIVE', 'Archive entry exceeds the supported format or bounds.', 3);
      const bytes = directory.subarray(cursor + 46, cursor + 46 + nameLength);
      let name: string; try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Fault('INVALID_APP_ARCHIVE', 'Archive filename is not UTF-8.', 3); }
      const directoryEntry = name.endsWith('/'), parts = (directoryEntry ? name.slice(0, -1) : name).split('/'), normalized = parts.map(part => part.normalize('NFC').toLowerCase()).join('/');
      requireValue(parts[0] === appName && parts.every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f:]/.test(part)) && (parts.length > 1 || directoryEntry) && !paths.has(normalized), 'INVALID_APP_ARCHIVE', 'Archive paths must be unique and contained inside the selected app.', 3);
      const mode = attributes >>> 16, type = mode & 0xf000;
      requireValue([0, directoryEntry ? 0x4000 : 0x8000].includes(type) && (mode & 0o7000) === 0 && (!directoryEntry || (size === 0 && compressed <= 2)), 'INVALID_APP_ARCHIVE', 'Links, special files and elevated permissions are not installable app entries.', 3);
      paths.set(normalized, directoryEntry); total += size;
      requireValue(total <= MAX_ARCHIVE, 'ARTIFACT_TOO_LARGE', 'Expanded app exceeds the one GiB archive bound.', 3);
      entries.push({ name, bytes, directory: directoryEntry, mode: (mode & 0o777) || (directoryEntry ? 0o755 : 0o644), compressed, size, crc, method, flags, offset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    requireValue(cursor === directory.length, 'INVALID_APP_ARCHIVE', 'Unexpected archive directory data.', 3);
    const ranges: [number, number][] = [];
    for (const entry of entries) {
      const components = entry.name.replace(/\/$/, '').normalize('NFC').toLowerCase().split('/');
      for (let index = 1; index < components.length; index++) requireValue(paths.get(components.slice(0, index).join('/')) !== false, 'INVALID_APP_ARCHIVE', 'A file cannot also be an archive directory.', 3);
      const header = read(entry.offset, 30);
      requireValue(header.readUInt32LE(0) === 0x04034b50 && header.readUInt16LE(6) === entry.flags && header.readUInt16LE(8) === entry.method && header.readUInt16LE(26) === entry.bytes.length,
        'INVALID_APP_ARCHIVE', 'Local ZIP header differs from its directory entry.', 3);
      const dataOffset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), endOffset = dataOffset + entry.compressed;
      requireValue(read(entry.offset + 30, entry.bytes.length).equals(entry.bytes) && endOffset <= directoryOffset, 'INVALID_APP_ARCHIVE', 'Local ZIP name or data range changed.', 3);
      if (!(entry.flags & 8)) requireValue(header.readUInt32LE(14) === entry.crc && header.readUInt32LE(18) === entry.compressed && header.readUInt32LE(22) === entry.size, 'INVALID_APP_ARCHIVE', 'Local ZIP sizes or checksum conflict with the directory.', 3);
      ranges.push([entry.offset, endOffset]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    requireValue(ranges.every((range, index) => index === 0 || range[0] >= ranges[index - 1]![1]), 'INVALID_APP_ARCHIVE', 'ZIP entries overlap.', 3);
    mkdirSync(destination, { mode: 0o700 }); let files = 0;
    for (const entry of entries) {
      const header = read(entry.offset, 30), dataOffset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), compressed = read(dataOffset, entry.compressed);
      let data: Buffer;
      try { data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) }); }
      catch { throw new Fault('ARTIFACT_CHANGED', 'Compressed app data exceeds its bound or is corrupt.', 3); }
      requireValue(data.length === entry.size && crc32(data) === entry.crc, 'ARTIFACT_CHANGED', 'Expanded app bytes failed their declared size or checksum.', 3);
      const path = join(destination, entry.name);
      if (entry.directory) mkdirSync(path, { recursive: true, mode: 0o700 });
      else {
        mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(path, data, { flag: 'wx', mode: entry.mode }); chmodSync(path, entry.mode);
        const file = openSync(path, 'r'); try { fsyncSync(file); } finally { closeSync(file); } files++;
      }
    }
    const root = openSync(destination, 'r'); try { fsyncSync(root); } finally { closeSync(root); }
    requireValue(files > 0, 'INVALID_APP_ARCHIVE', 'The app archive is empty.', 3);
    return { appPath: join(destination, appName), files, bytes: total };
  } finally { closeSync(fd); }
}
