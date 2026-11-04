/**
 * Minimal RIFF/WAVE reader and writer.
 *
 * The voice step assembles one narration track from per-sentence audio. Doing it
 * on raw PCM keeps the timing exact and removes ffmpeg from the critical path of
 * a step that only needs to concatenate.
 */

export function parseWav(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (data.length < 44) throw new Error('WAV 数据太短')
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是合法的 WAV 文件')
  }

  let offset = 12
  let fmt = null
  let pcm = null

  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        audioFormat: data.readUInt16LE(body),
        channels: data.readUInt16LE(body + 2),
        sampleRate: data.readUInt32LE(body + 4),
        byteRate: data.readUInt32LE(body + 8),
        blockAlign: data.readUInt16LE(body + 12),
        bitsPerSample: data.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      pcm = data.subarray(body, Math.min(body + size, data.length))
      break
    }
    offset = body + size + (size % 2)
  }

  if (!fmt || !pcm) throw new Error('WAV 缺少 fmt 或 data 块')
  if (fmt.audioFormat !== 1) throw new Error(`只支持 PCM WAV，收到 format=${fmt.audioFormat}`)

  return {
    ...fmt,
    data: pcm,
    durationSec: fmt.byteRate > 0 ? pcm.length / fmt.byteRate : 0,
  }
}

export function writeWav({ sampleRate, channels, bitsPerSample, data }) {
  const header = Buffer.alloc(44)
  const blockAlign = (channels * bitsPerSample) / 8
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function silence({ sampleRate, channels, bitsPerSample, durationSec }) {
  const blockAlign = (channels * bitsPerSample) / 8
  const frames = Math.max(0, Math.round(durationSec * sampleRate))
  return Buffer.alloc(frames * blockAlign)
}
