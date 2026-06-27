import Mapper from './Mapper'
import { shortHash } from './helpers'
import Controller from './Controller'
import { serverError, ServerErrors } from '../types'
import { HTTPException } from 'hono/http-exception'
import { now } from './Database'

export default class User extends Controller {
  /**
   * Send a UID and get an API key
   */
  async getKey (uid: string) {
    // Look for a user record for this UID
    const user = await Mapper(this.app.db, 'users')
    await user.load({
      uid
    })
    if (user.notFound) {
      // Check if new users are allowed
      if (!this.app.allowNewUsers) {
        throw new HTTPException(403, { message: 'New user registration is not allowed' })
      }

      // Create a new user
      user.row.uid = uid
      user.row.created = now()
      if (!(user.save())) {
        throw new HTTPException(serverError(ServerErrors.USER_FAILED_TO_SAVE)) // Server error, unable to save
      }
    }
    this.user = user

    // If this user already has a valid (non-revoked) key, return it instead of
    // rotating. Rotating on every call meant any extra request to get-key (a
    // retry, a verification hit, a second device) silently invalidated the key
    // the plugin was already using, causing "Invalid API key" (462) errors.
    const existing = this.app.db
      .prepare('SELECT api_key FROM api_keys WHERE users_id = ? AND revoked IS NULL ORDER BY created DESC LIMIT 1')
      .get(user.row.id) as { api_key: string } | undefined
    if (existing?.api_key) {
      return {
        user,
        apiKey: existing,
        key: existing.api_key
      }
    }

    // Create the new API key
    const apiKey = await Mapper(this.app.db, 'api_keys')
    apiKey.set({
      users_id: user.row.id,
      api_key: await shortHash('' + user.row.id + new Date().getTime()),
      created: now()
    })
    if (!(apiKey.save())) {
      throw new HTTPException(serverError(ServerErrors.API_KEY_FAILED_TO_SAVE)) // Server error, unable to save
    } else {
      return {
        user,
        apiKey,
        key: apiKey.row.api_key
      }
    }
  }
}
