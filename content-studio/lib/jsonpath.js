/** Minimal JSONPath: `$.a.b[0].c`, `$.a["b c"]`, `$[0]`. No dependency on purpose. */
export function pick(value, path) {
  if (!path || typeof path !== 'string') return undefined
  let p = path.trim()
  if (p.startsWith('$')) p = p.slice(1)
  if (p.startsWith('.')) p = p.slice(1)
  if (!p) return value

  const tokens = []
  const re = /([^.[\]]+)|\[(\d+)\]|\["([^"]*)"\]|\['([^']*)'\]/g
  let m
  while ((m = re.exec(p)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1])
    else if (m[2] !== undefined) tokens.push(Number(m[2]))
    else if (m[3] !== undefined) tokens.push(m[3])
    else if (m[4] !== undefined) tokens.push(m[4])
  }

  let cur = value
  for (const token of tokens) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[token]
  }
  return cur
}
