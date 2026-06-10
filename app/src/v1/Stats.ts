import { App } from '../types'
import db from './Database'
import { writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const CHART_DAYS = 90
const CARD_CHART_DAYS = 30
const SECONDS_PER_DAY = 86400
const MS_PER_DAY = SECONDS_PER_DAY * 1000

type ShareRow = { date: number; new_notes: number; updated_notes: number }

type Payload = {
  updated: number
  headline: { requests: number; bytes: number; notes: number; runningSinceYear: number | null }
  shares: ShareRow[]
  countries: { code: string; share: number }[]
}

/**
 * Year from SERVICE_START_DATE (UTC). Returns null if the env var is missing
 * or unparseable, which the renderers use as the signal to hide the
 * "Running since" card entirely.
 */
function computeRunningSinceYear (): number | null {
  const raw = process.env.SERVICE_START_DATE
  if (!raw) return null
  const start = new Date(raw)
  if (isNaN(start.getTime())) return null
  return start.getUTCFullYear()
}

export class Stats {
  app: App

  constructor (app: App) {
    this.app = app
  }

  async refresh () {
    try {
      const { notes } = this.queryDb()
      const cf = await this.app.cloudflare.getAnalytics()
      const payload: Payload = {
        updated: Math.floor(Date.now() / 1000),
        headline: {
          requests: cf.totalRequests,
          bytes: cf.totalBytes,
          notes,
          runningSinceYear: computeRunningSinceYear()
        },
        shares: this.queryShares(),
        countries: cf.countries
      }
      const dir = this.app.baseFolder + '/userfiles'
      const svg = this.renderCard(payload)
      const ogPng = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: { defaultFontFamily: 'DejaVu Sans' }
      }).render().asPng()

      await Promise.all([
        writeFile(dir + '/stats.json', JSON.stringify(payload)),
        writeFile(dir + '/stats-card.svg', svg),
        writeFile(dir + '/stats-og.png', ogPng)
      ])

      // The freshly written files are fronted by Cloudflare, so purge them or
      // the edge keeps serving the previous hour's snapshot until its TTL lapses.
      const base = this.app.baseWebUrl
      await this.app.cloudflare.purgeCache([
        base + '/stats.json',
        base + '/stats/card.svg',
        base + '/stats/og-image.png'
      ])
    } catch (e) {
      console.error('Stats refresh failed:', e)
    }
  }

  private queryDb () {
    const notes = (db.prepare(
      "SELECT COUNT(*) AS n FROM files WHERE filetype = 'html'"
    ).get() as { n: number }).n
    return { notes }
  }

  private queryShares (): ShareRow[] {
    const cutoff = Math.floor(Date.now() / 1000) - CHART_DAYS * SECONDS_PER_DAY
    return db.prepare(
      `SELECT date, new_notes, updated_notes FROM shares_daily
       WHERE date >= ? ORDER BY date ASC`
    ).all(cutoff) as ShareRow[]
  }

  /**
   * Render a README-embeddable SVG card. Dark/light theming is handled by an
   * embedded prefers-color-scheme media query, which GitHub's image proxy
   * preserves. No external resources, no scripts (would be stripped anyway).
   */
  private renderCard (p: Payload): string {
    const W = 600
    const H = 315
    const PAD = 22

    // Stat-card geometry (cardW depends on stats.length and is computed below)
    const labelY = 110
    const valueY = 142
    const footY = 160

    // Sparkline geometry
    const sparkLabelY = 200
    const sparkY = 210
    const sparkH = 90
    const sparkW = W - PAD * 2
    const sparkBottom = sparkY + sparkH

    // Build a value-per-day array for the last CARD_CHART_DAYS complete days,
    // oldest first. Today is excluded because it's still in progress and would
    // otherwise render as a sharp drop on the right edge of the line.
    const lastFullDay = Math.floor(Date.now() / MS_PER_DAY) * SECONDS_PER_DAY - SECONDS_PER_DAY
    const values = new Array(CARD_CHART_DAYS).fill(0) as number[]
    for (const r of p.shares) {
      const daysBack = Math.round((lastFullDay - r.date) / SECONDS_PER_DAY)
      if (daysBack < 0 || daysBack >= CARD_CHART_DAYS) continue
      values[CARD_CHART_DAYS - 1 - daysBack] = r.new_notes + r.updated_notes
    }
    const maxValue = Math.max(...values)
    const yScale = maxValue > 0 ? sparkH / maxValue : 0
    const points = values.map((v, i) => ({
      x: PAD + (i / Math.max(1, CARD_CHART_DAYS - 1)) * sparkW,
      y: sparkBottom - v * yScale
    }))

    const linePath = smoothPath(points)
    const areaPath = linePath
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)},${sparkBottom} L ${points[0].x.toFixed(1)},${sparkBottom} Z`
      : ''
    const chart = linePath
      ? `<path d="${areaPath}" class="area"/><path d="${linePath}" class="line"/>`
      : ''
    const maxLabel = maxValue > 0
      ? `<text x="${W - PAD}" y="${sparkLabelY}" class="muted" font-size="11" text-anchor="end">max ${fmtNumber(maxValue)}</text>`
      : ''

    const stats: { label: string; value: string; foot?: string }[] = [
      { label: 'REQUESTS', value: fmtNumber(p.headline.requests), foot: '30 days' },
      { label: 'BANDWIDTH', value: fmtBytes(p.headline.bytes), foot: '30 days' },
      { label: 'SHARED NOTES', value: fmtNumber(p.headline.notes), foot: 'all time' }
    ]
    if (p.headline.runningSinceYear !== null) {
      stats.push({ label: 'RUNNING SINCE', value: String(p.headline.runningSinceYear), foot: 'and still free!' })
    }
    const cardW = (W - PAD * 2) / stats.length
    const statCards = stats.map((s, i) => {
      const x = PAD + i * cardW
      let out = `<text x="${x}" y="${labelY}" class="muted" font-size="12" font-weight="600" letter-spacing="0.6">${s.label}</text>` +
                `<text x="${x}" y="${valueY}" class="text" font-size="26" font-weight="700">${escapeXml(s.value)}</text>`
      if (s.foot) {
        out += `<text x="${x}" y="${footY}" class="muted" font-size="11">${s.foot}</text>`
      }
      return out
    }).join('')

    const updatedStr = new Date(p.updated * 1000).toISOString().slice(0, 10)

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share Note stats">
  <style>
    .bg { fill: #ffffff; stroke: #e5e5e5; }
    .text { fill: #1a1a1a; }
    .muted { fill: #6a6a6a; }
    .accent { fill: #5b6cff; }
    .accent-soft { fill: #c5cdff; }
    .line { fill: none; stroke: #5b6cff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: #5b6cff; opacity: 0.18; }
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #18181b; stroke: #2a2a2e; }
      .text { fill: #f2f2f2; }
      .muted { fill: #9a9aa3; }
      .accent { fill: #8b9bff; }
      .accent-soft { fill: #3a467d; }
      .line { stroke: #8b9bff; }
      .area { fill: #8b9bff; }
    }
  </style>
  <rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
  <text x="${PAD}" y="${PAD + 20}" class="text" font-size="22" font-weight="700">Server stats</text>
  <text x="${PAD}" y="${PAD + 40}" class="muted" font-size="13">Updated ${updatedStr}</text>
  ${statCards}
  <text x="${PAD}" y="${sparkLabelY}" class="muted" font-size="12" font-weight="600">Shares per day · last ${CARD_CHART_DAYS} days</text>
  ${maxLabel}
  ${chart}
</svg>`
  }
}

function fmtNumber (n: number): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K'
  return n.toLocaleString('en-US')
}

function fmtBytes (n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i]
}

function escapeXml (s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}


/**
 * Cardinal-spline (Catmull-Rom variant) smoothing through the given points.
 * Tension 0.2 is mild; less prone to overshoot than the classic 0.5 form,
 * which matters here because we don't want the line dipping below the
 * baseline at valleys in the data.
 */
function smoothPath (pts: { x: number, y: number }[]): string {
  if (pts.length < 2) return ''
  const k = 0.2
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) * k
    const c1y = p1.y + (p2.y - p0.y) * k
    const c2x = p2.x - (p3.x - p1.x) * k
    const c2y = p2.y - (p3.y - p1.y) * k
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}
