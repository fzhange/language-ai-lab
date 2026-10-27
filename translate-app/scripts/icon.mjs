import { chromium } from 'playwright'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const svg = await readFile(new URL('../assets/mark.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
  await page.setContent(`<style>body{margin:0}svg{display:block;width:1024px;height:1024px}</style>${svg}`)
  await page.screenshot({ path: 'assets/icon.png', omitBackground: true })
} finally { await browser.close() }

const temporary = await mkdtemp(path.join(tmpdir(), 'translate-icon-'))
const iconset = `${temporary}.iconset`
execFileSync('mv', [temporary, iconset])
try {
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(size), String(size), 'assets/icon.png', '--out', path.join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), 'assets/icon.png', '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'assets/icon.icns'])
} finally { await rm(iconset, { recursive: true, force: true }) }
