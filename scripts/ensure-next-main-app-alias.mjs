import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const chunkDir = join(process.cwd(), '.next', 'static', 'chunks')
const aliasPath = join(chunkDir, 'main-app.js')

if (!existsSync(chunkDir)) {
  console.warn('[ensure-next-main-app-alias] chunk directory missing, skipping')
  process.exit(0)
}

const candidates = readdirSync(chunkDir)
  .filter((name) => /^main-app-[^.]+\.js$/.test(name))
  .map((name) => ({
    name,
    path: join(chunkDir, name),
    mtimeMs: statSync(join(chunkDir, name)).mtimeMs,
  }))
  .sort((left, right) => right.mtimeMs - left.mtimeMs)

if (!candidates.length) {
  console.warn('[ensure-next-main-app-alias] no hashed main-app chunk found, skipping')
  process.exit(0)
}

copyFileSync(candidates[0].path, aliasPath)
console.log(`[ensure-next-main-app-alias] aliased ${candidates[0].name} -> main-app.js`)
