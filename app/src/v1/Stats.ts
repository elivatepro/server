import { App } from '../types'
import db from './Database'
import { writeFile } from 'node:fs/promises'

type ShareRow = { date: number; new_notes: number; updated_notes: number }

type Payload = {
  updated: number
  headline: { requests: number; bytes: number; notes: number; users: number }
  shares: ShareRow[]
  countries: { code: string; requests: number }[]
}

export class Stats {
  app: App

  constructor (app: App) {
    this.app = app
  }

  async refresh () {
    try {
      const { notes, users } = this.queryDb()
      const cf = await this.app.cloudflare.getAnalytics()
      const payload: Payload = {
        updated: Math.floor(Date.now() / 1000),
        headline: {
          requests: cf.totalRequests,
          bytes: cf.totalBytes,
          notes,
          users
        },
        shares: this.queryShares(),
        countries: cf.countries
      }
      const dir = this.app.baseFolder + '/userfiles'
      await Promise.all([
        writeFile(dir + '/stats.json', JSON.stringify(payload)),
        writeFile(dir + '/stats-card.svg', this.renderCard(payload))
      ])
    } catch (e) {
      console.error('Stats refresh failed:', e)
    }
  }

  private queryDb () {
    const notes = (db.prepare(
      "SELECT COUNT(*) AS n FROM files WHERE filetype = 'html'"
    ).get() as { n: number }).n
    const users = (db.prepare(
      'SELECT COUNT(*) AS n FROM users'
    ).get() as { n: number }).n
    return { notes, users }
  }

  private queryShares (): ShareRow[] {
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 86400
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
    const H = 260
    const PAD = 22

    // Stat-card geometry
    const labelY = 100
    const valueY = 132
    const footY = 150
    const cardW = (W - PAD * 2) / 4

    // Sparkline geometry
    const SLOTS = 90
    const sparkLabelY = 184
    const sparkY = 192
    const sparkH = 52
    const sparkW = W - PAD * 2
    const slotW = sparkW / SLOTS
    const barW = Math.max(2, slotW - 0.8)

    const totals = p.shares.map(r => r.new_notes + r.updated_notes)
    const maxTotal = Math.max(1, ...totals)
    const today = Math.floor(Date.now() / 86400000) * 86400

    const bars: string[] = []
    for (const r of p.shares) {
      const daysBack = Math.round((today - r.date) / 86400)
      if (daysBack < 0 || daysBack >= SLOTS) continue
      const slot = SLOTS - 1 - daysBack
      const x = PAD + slot * slotW + (slotW - barW) / 2
      const newH = (r.new_notes / maxTotal) * sparkH
      const updH = (r.updated_notes / maxTotal) * sparkH
      const top = sparkY + sparkH - newH - updH
      if (newH > 0.3) {
        bars.push(`<rect class="accent" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${newH.toFixed(1)}"/>`)
      }
      if (updH > 0.3) {
        bars.push(`<rect class="accent-soft" x="${x.toFixed(1)}" y="${(top + newH).toFixed(1)}" width="${barW.toFixed(1)}" height="${updH.toFixed(1)}"/>`)
      }
    }

    const stats: { label: string; value: string; foot?: string }[] = [
      { label: 'REQUESTS', value: fmtNumber(p.headline.requests), foot: '30 days' },
      { label: 'BANDWIDTH', value: fmtBytes(p.headline.bytes), foot: '30 days' },
      { label: 'NOTES', value: fmtNumber(p.headline.notes) },
      { label: 'USERS', value: fmtNumber(p.headline.users) }
    ]
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
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #18181b; stroke: #2a2a2e; }
      .text { fill: #f2f2f2; }
      .muted { fill: #9a9aa3; }
      .accent { fill: #8b9bff; }
      .accent-soft { fill: #3a467d; }
    }
  </style>
  <rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
  <text x="${PAD}" y="${PAD + 20}" class="text" font-size="22" font-weight="700">Share Note</text>
  <text x="${PAD}" y="${PAD + 40}" class="muted" font-size="13">Public activity · updated ${updatedStr}</text>
  ${statCards}
  <text x="${PAD}" y="${sparkLabelY}" class="muted" font-size="12" font-weight="600">Shares per day · last 90 days</text>
  ${bars.join('')}
</svg>`
  }
}

function fmtNumber (n: number): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
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
