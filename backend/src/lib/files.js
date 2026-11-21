// Detecta el tipo real por los primeros bytes (el Content-Type del cliente no es fiable)
export function sniff(buf) {
  if (buf.length < 12) return null;
  const ascii = (from, to) => buf.toString('latin1', from, to);
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', type: 'PHOTO' };
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: 'png', type: 'PHOTO' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', type: 'PHOTO' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav', type: 'AUDIO' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm', type: 'AUDIO' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', type: 'AUDIO' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a', type: 'AUDIO' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3', type: 'AUDIO' };
  return null;
}
