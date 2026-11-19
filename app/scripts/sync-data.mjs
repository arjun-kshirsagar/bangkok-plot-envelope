#!/usr/bin/env node
/**
 * Copies the canonical data files from the repo root into src/ so the app never imports
 * outside app/ (Vercel builds with root directory app/, where ../docs may be absent).
 * When the repo-root file is missing (app-only checkout) the committed copy is kept.
 * Byte identity is enforced by src/rules/rules.test.ts.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pairs = [
  ['../docs/SOURCES.md', 'src/rules/SOURCES.md'],
  ['../rules/bangkok-zone.json', 'src/rules/bangkok-zone.json'],
  ['../rules/bangkok-zone-y10.geojson', 'src/rules/bangkok-zone-y10.json'],
]
for (const [from, to] of pairs) {
  const src = resolve(app, from)
  const dst = resolve(app, to)
  if (!existsSync(src)) {
    console.log(`[sync-data] ${from} not found, keeping committed ${to}`)
    continue
  }
  if (existsSync(dst) && readFileSync(src).equals(readFileSync(dst))) continue
  copyFileSync(src, dst)
  console.log(`[sync-data] ${from} -> ${to}`)
}
