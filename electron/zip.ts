import zlib from 'node:zlib'

export interface ZipEntryInput {
  name: string
  data: Buffer | string
}

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Create a standard PKZIP archive buffer (DEFLATE compressed) with zero external dependencies.
 */
export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  const now = new Date()
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f)
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f)

  for (const entry of entries) {
    const nameStr = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
    const nameBuf = Buffer.from(nameStr, 'utf-8')
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf-8')
    const checksum = crc32(rawBuf)
    const deflated = zlib.deflateRawSync(rawBuf)
    const useDeflate = deflated.length < rawBuf.length
    const body = useDeflate ? deflated : rawBuf
    const method = useDeflate ? 8 : 0

    // Local File Header (30 bytes + name)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(body.length, 18)
    localHeader.writeUInt32LE(rawBuf.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuf, body)

    // Central Directory Header (46 bytes + name)
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0x0800, 8) // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(body.length, 20)
    centralHeader.writeUInt32LE(rawBuf.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra len
    centralHeader.writeUInt16LE(0, 32) // comment len
    centralHeader.writeUInt16LE(0, 34) // disk start
    centralHeader.writeUInt16LE(0, 36) // internal attrs
    centralHeader.writeUInt32LE(0, 38) // external attrs
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuf)
    offset += localHeader.length + nameBuf.length + body.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

interface ArchiveEntry { offset: number; compressed: number; size: number; method: number; crc: number }

export function openZip(buffer: Buffer) {
  const invalid = () => new Error('ZIP 作品包损坏或使用了不支持的格式')
  let end = buffer.length - 22
  for (; end >= Math.max(0, buffer.length - 65557); end--) {
    if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break
  }
  if (end < Math.max(0, buffer.length - 65557) || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalid()
  const count = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const centralEnd = cursor + buffer.readUInt32LE(end + 12)
  if (centralEnd !== end || count > 10000) throw invalid()
  const entries = new Map<string, ArchiveEntry>()
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid()
    const nameLen = buffer.readUInt16LE(cursor + 28)
    const next = cursor + 46 + nameLen + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
    if (next > end) throw invalid()
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen)
    const offset = buffer.readUInt32LE(cursor + 42)
    const size = buffer.readUInt32LE(cursor + 24)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const method = buffer.readUInt16LE(cursor + 10)
    if (buffer.readUInt16LE(cursor + 8) & 1 || ![0, 8].includes(method) || entries.has(name) ||
        offset + 30 > end || buffer.readUInt32LE(offset) !== 0x04034b50) throw invalid()
    const body = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
    if (body + compressed > end) throw invalid()
    entries.set(name, { offset: body, compressed, size, method, crc: buffer.readUInt32LE(cursor + 16) })
    cursor = next
  }
  if (cursor !== end) throw invalid()
  return {
    has: (name: string) => entries.has(name),
    read(name: string, limit: number): Buffer {
      const entry = entries.get(name)
      if (!entry) throw new Error(`作品包缺少 ${name}`)
      if (entry.size > limit) throw new Error(`作品包中的 ${name} 超出大小限制`)
      const source = buffer.subarray(entry.offset, entry.offset + entry.compressed)
      const data = entry.method === 8 ? zlib.inflateRawSync(source, { maxOutputLength: Math.max(entry.size, 1) }) : source
      if (data.length !== entry.size || crc32(data) !== entry.crc) throw invalid()
      return data
    },
  }
}
