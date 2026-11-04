/** Load-check every runtime module so a syntax/import error surfaces before install. */
const files = [
  '../index.js',
  '../lib/api.js',
  '../lib/batch-store.js',
  '../lib/edl.js',
  '../lib/ffmpeg.js',
  '../lib/jsonpath.js',
  '../lib/pipeline.js',
  '../lib/providers.js',
  '../lib/providers/image.js',
  '../lib/providers/llm.js',
  '../lib/providers/tts.js',
  '../lib/runner.js',
  '../lib/store.js',
  '../lib/wav.js',
  '../lib/worker.js',
  '../lib/steps/cover.js',
  '../lib/steps/render.js',
  '../lib/steps/scan.js',
  '../lib/steps/script.js',
  '../lib/steps/subtitle.js',
  '../lib/steps/validate.js',
  '../lib/steps/voice.js',
]
for (const file of files) {
  await import(new URL(file, import.meta.url).href)
  console.log('ok  ', file)
}
console.log('all host modules loaded')
