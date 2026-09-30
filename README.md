# Active Zone Outdoor — website

Modern, responsive one-page website for [Active Zone Outdoor](https://www.activezoneoutdoor.cy),
a non-profit youth organisation in Larnaca, Cyprus.

Plain HTML, CSS and JavaScript — no build step, no framework, no dependencies.

```
index.html                      page content
assets/css/styles.css           design system + layout (light & dark mode)
assets/js/main.js               menu, scroll effects, activity filter, contact form
assets/img/
  logo-official-*.{webp,png}    official logo (header, footer, social previews)
  mark.svg / favicon.svg        abstract mountain-and-sea mark (favicon)
  apple-touch-icon.png          home-screen icon (from the abstract mark)
supabase/
  migrations/                   contact_messages table
  functions/contact/            edge function: stores + emails form messages
```

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Upload the repository contents to any static host (GitHub Pages, Netlify,
Cloudflare Pages, or the existing web host).

## Contact form (Supabase + Google Workspace)

The form sends messages instantly through a Supabase Edge Function. Each
message is saved in the `contact_messages` table and emailed to the team
through the Gmail API as the organisation's Google Workspace sender — the same
setup [Moments](https://github.com/activezoneoutdoor/moments) uses for booking
emails (`supabase/functions/_shared/gmail.ts` is shared with it). *Reply-To* is
set to the visitor so you can answer straight from your inbox. Spam
protection: allowed-origin check, hidden honeypot field, input validation and
max 5 messages per IP per 10 min.

### Setup (reusing the Moments Supabase project)

The Moments project already has the Google secrets (`GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `EMAIL_FROM`), so only
the contact-form settings are new. Contact-form secrets are prefixed
`CONTACT_` so they don't change anything in Moments.

1. **Create the table.** In the Moments project's SQL Editor, run
   `supabase/migrations/20260930000000_contact_messages.sql`. (Use the SQL
   Editor rather than `supabase db push`: the Moments project's migration
   history lives in the Moments repo.)
2. **Set the secrets and deploy** with the
   [Supabase CLI](https://supabase.com/docs/guides/cli), from this repo:

   ```sh
   supabase link --project-ref drqdwpyhdprggaazaeuo
   supabase secrets set \
     CONTACT_TO_EMAIL=info@activezoneoutdoor.cy \
     CONTACT_ALLOWED_ORIGINS=https://www2.activezoneoutdoor.cy,https://www.activezoneoutdoor.cy,https://activezoneoutdoor.cy
   supabase functions deploy contact
   ```

   This deploys only the `contact` function; the Moments functions are untouched.
3. **Website** — `CONTACT_ENDPOINT` in `assets/js/main.js` already points at
   `https://drqdwpyhdprggaazaeuo.supabase.co/functions/v1/contact`.

Emails come from the Moments sender address with the display name
"Active Zone Outdoor website". To use another address, set
`CONTACT_EMAIL_FROM`; it must be the authorised account or one of its Gmail
"Send mail as" aliases.

In a separate Supabase project instead, set the Google secrets there too
(same values as Moments) and use `supabase db push` for the table.

If `CONTACT_ENDPOINT` is empty or the function can't be reached (e.g. not
deployed yet), the form falls back to opening the visitor's email app
addressed to `CONTACT_EMAIL`.

Messages are in Supabase → Table Editor → `contact_messages`; `email_sent` /
`email_error` show whether the notification email went out. Every sent
message is also in the sender account's Gmail *Sent* folder.

Run the function tests with [Deno](https://deno.com):

```sh
cd supabase/functions && deno task test
```

## Before going live

- **Contact form** — complete the setup above, and confirm `CONTACT_EMAIL`
  in `assets/js/main.js` (fallback address, currently a placeholder).
- **Photos** — the hero and cards use illustrations; real photos of activities
  will make the biggest difference. Add them to `assets/img/`.
- **Social links** — add Facebook / Instagram URLs to the footer.
- Check the age range (13–30) in "Get involved" matches your programmes.
