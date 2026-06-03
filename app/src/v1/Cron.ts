import cron from 'node-cron'
import db, { TableRow } from './Database'
import { unlink } from 'node:fs/promises'
import { Paths } from './File'
import { App } from '../types'
import log from './Log'

export class Cron {
  app: App
  paths: Paths

  constructor (app: App) {
    this.app = app
    this.paths = new Paths(app)

    // Delete expired files
    cron.schedule('* * * * *', () => this.deleteExpiredFiles())

    // Backup the database daily
    cron.schedule('0 0 * * *', () => this.backupDatabase())
  }

  async deleteExpiredFiles () {
    const files = db
      .prepare('SELECT * FROM files WHERE expires IS NOT NULL AND expires < unixepoch()')
      .all()

    for (const row of (files || [])) {
      const file = row as unknown as TableRow<'files'>

      // Delete the file
      try {
        await unlink(this.paths.fullFilePath(file.filename, file.filetype).filePath)
      } catch {
      }

      // Clear from Cloudflare cache
      const url = this.paths.displayUrl(file.filename, file.filetype)
      await this.app.cloudflare.purgeCache([url])

      // Finally, delete the reference from our DB
      db
        .prepare('DELETE FROM files WHERE id = ?')
        .run(file.id)

      console.log('Deleted expired file ' + url)
    }
  }

  async backupDatabase () {
    try {
      await db.backup(this.app.baseFolder + '/db/backup.sqlite')
      log.console('Database backup completed')
      db.exec('VACUUM')
    } catch (e) {
      console.error(e)
      log.console('Database backup failed')
    }
  }
}
