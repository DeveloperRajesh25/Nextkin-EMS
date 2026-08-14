# Production URL — where it's configured

The app is currently live at:

```
https://nextkin-ems.vercel.app
```

This value is **not read from one place** — it's copy-pasted into several
external dashboards and one env var. When you buy a real domain, you have to
go update it in every row below, then redeploy. Nothing in the codebase
hardcodes a domain (checked — the only fallback is `localhost:3000` in
[src/lib/env.ts](src/lib/env.ts#L172), used only when `APP_URL` is unset), so
this is purely a config/dashboard checklist, not a code change.

## Checklist

| # | Where | What to set | Current (live) | Status |
|---|---|---|---|---|
| 1 | **Vercel** → Project → Settings → Environment Variables (Production) | `APP_URL` | `https://nextkin-ems.vercel.app` | ⬜ |
| 2 | Same as above | `GOOGLE_REDIRECT_URI` | `https://nextkin-ems.vercel.app/api/integrations/google/callback` | ⬜ (only if Google Calendar integration is used) |
| 3 | **Supabase** → Authentication → URL Configuration | Site URL | `https://nextkin-ems.vercel.app` | ⬜ |
| 4 | Same as above | Redirect URLs allowlist — add | `https://nextkin-ems.vercel.app/**` | ⬜ |
| 5 | **Google Cloud Console** → APIs & Services → Credentials → your OAuth client | Authorized redirect URIs — add | `https://nextkin-ems.vercel.app/api/integrations/google/callback` | ⬜ (only if Google Calendar integration is used) |
| 6 | **Cloudflare R2** → bucket `nextkinlife-ems` → Settings → CORS Policy | `AllowedOrigins` — add | `https://nextkin-ems.vercel.app` | ⬜ **← verified missing; every upload in production fails until this is done. Check with `R2_CORS_ORIGINS="https://nextkin-ems.vercel.app" npm run r2:doctor`** |
| 7 | **cron-job.org** → both jobs (visa reminders, calendar sync) | Job URL | `https://nextkin-ems.vercel.app/api/cron/visa-reminders` and `.../api/cron/calendar-sync` | ⬜ |

Rows 3–4 control the link inside Supabase's own confirmation/reset-password
emails (`{{ .SiteURL }}` in the template — see SETUP.md §4c), so if Site URL is
wrong, signup confirmation links point at the wrong host regardless of what
`APP_URL` says.

`localhost:3000` entries (in Supabase's redirect allowlist, R2 CORS, Google's
redirect URIs) should stay in place alongside the production ones — you still
need them for local development. Don't remove them when adding the production
row.

## When you buy a real domain

Repeat the same 7 rows, replacing `https://nextkin-ems.vercel.app` with
`https://your-new-domain.com`:

1. Add the domain in **Vercel** → Project → Settings → Domains, follow its DNS
   instructions (A/CNAME record with your registrar).
2. Update rows 1–2 (Vercel env vars) to the new domain. Redeploy — env var
   changes don't apply to already-running deployments.
3. Update rows 3–4 (Supabase Site URL + redirect allowlist). You can leave the
   old `vercel.app` redirect URL in the allowlist for a while as a fallback, or
   remove it once the new domain is confirmed working.
4. Update row 5 (Google Cloud redirect URI) — add the new one; Google allows
   multiple, so keep the old one until you've confirmed the new one works, then
   remove it.
5. Update row 6 (R2 CORS `AllowedOrigins`) — same story, can hold both during
   the transition.
6. Update row 7 (cron-job.org URLs) — edit both jobs, no transition needed
   since only one scheduler URL is ever active at a time; just don't forget
   this one, it's easy to miss because nothing errors loudly — visa reminders
   just silently stop running against the old host if you forget to update the
   secret/URL together (`CRON_SECRET` doesn't change, only the URL does).
7. Re-run the cross-device email confirmation check from SETUP.md §11 against
   the new domain before considering the migration done.
