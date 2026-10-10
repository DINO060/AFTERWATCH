// The sample formats of an MP4 or MOV file (avc1 = H.264, hvc1 = HEVC…), read from its boxes
// without decoding anything. Dependency-free so the tests can check it.
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

/** The sample formats of an MP4 or MOV file (avc1 = H.264, hvc1 = HEVC…), read from its boxes. */
export function mp4Formats(data: DataView): string[] {
  const formats: string[] = [];
  const name = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => data.getUint8(at + i)));
  const walk = (start: number, end: number, depth: number) => {
    let at = start;
    while (at + 8 <= end && depth < 8) {
      let size = data.getUint32(at);
      let header = 8;
      if (size === 1 && at + 16 <= end) {
        size = Number(data.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return;
      const type = name(at + 4);
      if (containers.has(type)) walk(at + header, at + size, depth + 1);
      else if (type === 'stsd' && at + header + 8 <= end) {
        // A full box: version and flags, the number of entries, then each sample entry.
        const count = data.getUint32(at + header + 4);
        let entry = at + header + 8;
        for (let i = 0; i < count && entry + 8 <= at + size; i++) {
          const entrySize = data.getUint32(entry);
          formats.push(name(entry + 4));
          if (entrySize < 8) break;
          entry += entrySize;
        }
      }
      at += size;
    }
  };
  walk(0, data.byteLength, 0);
  return formats;
}
