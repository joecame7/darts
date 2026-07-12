import { withSupabase } from 'npm:@supabase/server@^1'

const DELETE_CONFIRMATION = 'DELETE'
const RECENT_PASSWORD_WINDOW_SECONDS = 5 * 60

function hasRecentPasswordAuthentication(jwtClaims) {
  const claims = jwtClaims || {}
  if (!Array.isArray(claims.amr)) return false

  const now = Math.floor(Date.now() / 1000)
  return claims.amr.some((entry) => {
    const timestamp = Number(entry?.timestamp)
    return entry?.method === 'password'
      && Number.isFinite(timestamp)
      && timestamp >= now - RECENT_PASSWORD_WINDOW_SECONDS
      && timestamp <= now + 60
  })
}

function errorResponse(error, status) {
  return Response.json({ error }, { status })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed.', 405)
    }

    let body
    try {
      body = await request.json()
    } catch (_error) {
      return errorResponse('A valid JSON request body is required.', 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmation !== DELETE_CONFIRMATION) {
      return errorResponse('Account deletion was not confirmed.', 400)
    }

    const userId = context.userClaims?.id
    if (typeof userId !== 'string' || !userId) {
      return errorResponse('The signed-in account could not be verified.', 401)
    }

    // A caller may be retrying after the first successful response was lost.
    // A still-valid old JWT can safely confirm that its own account is gone.
    const lookup = await context.supabaseAdmin.auth.admin.getUserById(userId)
    if (lookup.error) {
      if (lookup.error.status === 404 || lookup.error.code === 'user_not_found') {
        return Response.json({ deleted: true })
      }
      console.error('delete-account lookup failed', { code: lookup.error.code, status: lookup.error.status })
      return errorResponse('The account could not be verified. Please try again.', 500)
    }
    if (!lookup.data.user) {
      return errorResponse('The account could not be verified. Please try again.', 500)
    }

    if (!hasRecentPasswordAuthentication(context.jwtClaims)) {
      return errorResponse('Confirm your current password again before deleting the account.', 403)
    }

    const { error } = await context.supabaseAdmin.auth.admin.deleteUser(userId, false)
    if (error) {
      // A lost first response can leave the browser retrying after the account
      // was already removed. Treat that retry as successfully completed.
      if (error.status === 404 || error.code === 'user_not_found') {
        return Response.json({ deleted: true })
      }

      console.error('delete-account failed', { code: error.code, status: error.status })
      return errorResponse('The account could not be deleted. Please try again.', 500)
    }

    return Response.json({ deleted: true })
  }),
}
