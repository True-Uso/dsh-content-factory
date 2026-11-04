import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const files = {
  '/': ['content-studio/tools/ui-preview.html', 'text/html; charset=utf-8'],
  '/client.js': ['content-studio/client.js', 'text/javascript; charset=utf-8'],
  '/react.js': ['tools/react-test/node_modules/react/umd/react.development.js', 'text/javascript; charset=utf-8'],
  '/react-dom.js': ['tools/react-test/node_modules/react-dom/umd/react-dom.development.js', 'text/javascript; charset=utf-8'],
}

createServer(async (req, res) => {
  const entry = files[new URL(req.url || '/', 'http://127.0.0.1').pathname]
  if (!entry) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  try {
    const body = await readFile(join(root, entry[0]))
    res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' })
    res.end(body)
  } catch (error) {
    res.writeHead(500)
    res.end(String(error.message))
  }
}).listen(4173, '127.0.0.1', () => {
  console.log('UI preview: http://127.0.0.1:4173/')
})
