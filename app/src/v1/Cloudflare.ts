import { serverError, ServerErrors } from '../types'
import { HonoRequest } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as process from 'node:process'

const TOP_COUNTRIES = 10
const COUNTRY_SAMPLE_SIZE = 50
const TOTALS_WINDOW_DAYS = 30
const MS_PER_DAY = 86400 * 1000

export default class Cloudflare {
  useTurnstile: boolean

  constructor () {
    this.useTurnstile = !!(process.env.CLOUDFLARE_TURNSTILE_KEY && process.env.CLOUDFLARE_TURNSTILE_SECRET)
  }

  /**
   * Fetch the last 30 days of zone analytics from the Cloudflare GraphQL API.
   * Returns zeros and an empty country list if zone or API key is not configured.
   */
  async getAnalytics () {
    const zone = process.env.CLOUDFLARE_ZONE_ID
    const key = process.env.CLOUDFLARE_API_KEY
    const empty = { totalRequests: 0, totalBytes: 0, countries: [] as { code: string, share: number }[] }
    if (!zone || !key) return empty

    const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
    const fmtTime = (d: Date) => d.toISOString()

    const until = new Date()
    const totalsSince = new Date(until.getTime() - TOTALS_WINDOW_DAYS * MS_PER_DAY)
    const countrySince = new Date(until.getTime() - MS_PER_DAY)

    // Totals span 30 days (httpRequests1dGroups handles wide ranges).
    // Country breakdown is sampled over the last 24h — that's enough to
    // rank countries by relative share; CF Free limits adaptive groups
    // to a 1d window
    const query = `
      query ($zoneTag: String!, $tSince: Date!, $tUntil: Date!, $cSince: Time!, $cUntil: Time!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            totals: httpRequests1dGroups(
              limit: 1,
              filter: { date_geq: $tSince, date_leq: $tUntil }
            ) {
              sum { requests, bytes }
            }
            byCountry: httpRequestsAdaptiveGroups(
              limit: ${COUNTRY_SAMPLE_SIZE},
              filter: { datetime_geq: $cSince, datetime_leq: $cUntil },
              orderBy: [count_DESC]
            ) {
              count
              dimensions { clientCountryName }
            }
          }
        }
      }`

    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: {
            zoneTag: zone,
            tSince: fmtDate(totalsSince),
            tUntil: fmtDate(until),
            cSince: fmtTime(countrySince),
            cUntil: fmtTime(until)
          }
        })
      })
      const json = await res.json() as any
      if (Array.isArray(json?.errors) && json.errors.length) {
        console.error('Cloudflare GraphQL errors:', JSON.stringify(json.errors))
        return empty
      }
      const zoneData = json?.data?.viewer?.zones?.[0]
      if (!zoneData) {
        console.error('Cloudflare GraphQL: no zone returned (check zone ID or token scope)')
        return empty
      }

      const totals = zoneData.totals?.[0]?.sum || {}
      const allRows = (zoneData.byCountry || []).map((row: any) => ({
        code: (row.dimensions?.clientCountryName || 'XX').toUpperCase(),
        requests: row.count || 0
      }))
      const sampledTotal = allRows.reduce((acc: number, r: any) => acc + r.requests, 0)
      const countries = allRows.slice(0, TOP_COUNTRIES).map((r: any) => ({
        code: r.code,
        share: sampledTotal > 0 ? r.requests / sampledTotal * 100 : 0
      }))
      return {
        totalRequests: totals.requests || 0,
        totalBytes: totals.bytes || 0,
        countries
      }
    } catch (e) {
      console.error('Cloudflare analytics fetch failed:', e)
      return empty
    }
  }

  async purgeCache (urls: string[]) {
    if (process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_API_KEY) {
      // Purge the cache if this was a file upload
      await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: urls
        })
      })
    }
  }

  async validateToken (request: HonoRequest) {
    try {
      const { searchParams } = new URL(request.url)
      const token = searchParams.get('token') || ''

      // Validate the token by calling the `/siteverify` API.
      const formData = new FormData()
      formData.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET || '')
      formData.append('response', token)
      formData.append('remoteip', request.header('CF-Connecting-IP') as string)

      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST'
      })
      const outcome = await result.json() as any
      if (outcome?.success === true) {
        return true
      }
    } catch (e) {
      console.log(e)
    }
    throw new HTTPException(serverError(ServerErrors.TURNSTILE_NO_VERIFY))
  }

  async showChallenge () {
    const head = `<script>function postToken(token){location.href+='&token='+encodeURIComponent(token)}</script>
        <script src='https://challenges.cloudflare.com/turnstile/v0/api.js' async defer></script>`
    const body = `<h3>Setting up Share Note plugin...</h3>
        <div class='cf-turnstile' data-sitekey='${process.env.CLOUDFLARE_TURNSTILE_KEY}' data-callback='postToken' data-theme='dark'></div>`

    return new Response(this.htmlResponse(head, body), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  htmlResponse (head = '', body = '') {
    return `
<!DOCTYPE html>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <title>Share Note for Obsidian</title>
  <link rel='stylesheet' href='https://cdn.jsdelivr.net/gh/kimeiga/bahunya/dist/bahunya.min.css'>
  ${head}
</head>
<body>
  <main role='main'>
    <section>
      ${body}
    </section>
  </main>
</body>
</html>
`
  }
}
