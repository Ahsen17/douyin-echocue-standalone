// Build-time icon pipeline: render the two canonical SVGs (PRD/ARCH "sole
// design source") into the PNGs the app and installer consume at runtime.
// Runtime must not depend on SVG rendering, so these PNGs are committed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'build')
const SVG = {
  app: join(root, 'svg', 'douyin-echocue-client-app-icon.svg'),
  tray: join(root, 'svg', 'douyin-echocue-client-tray-icon.svg'),
}

// Tray SVG is monochrome via `currentColor`; resvg resolves it to black, which
// disappears on dark taskbars. Render the tray glyph in white-on-transparent
// (Windows 11 adapts white tray icons to the taskbar theme). Single point of
// change if a different tint is preferred.
const TRAY_COLOR = '#FFFFFF'

function render(svgPath: string, width: number, height: number): Buffer {
  const raw = readFileSync(svgPath, 'utf8')
  const svg = raw.replaceAll('currentColor', TRAY_COLOR)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0, 0, 0, 0)',
  })
  const png = resvg.render().asPng()
  if (png.length === 0) {
    throw new Error(`rendered empty png for ${svgPath}`)
  }
  return Buffer.from(png)
}

function main(): void {
  mkdirSync(outDir, { recursive: true })
  const icon = render(SVG.app, 512, 512)
  writeFileSync(join(outDir, 'icon.png'), icon)
  const tray = render(SVG.tray, 32, 32)
  writeFileSync(join(outDir, 'tray.png'), tray)
  console.log(`wrote ${join(outDir, 'icon.png')} (${icon.length} bytes)`)
  console.log(`wrote ${join(outDir, 'tray.png')} (${tray.length} bytes)`)
}

main()
