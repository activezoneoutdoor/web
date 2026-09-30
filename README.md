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

## Contact form (Supabase + Resend)

The form sends messages instantly through a Supabase Edge Function. Each
message is saved in the `contact_messages` table and emailed to the team via
[Resend](https://resend.com), with *Reply-To* set to the visitor so you can
answer straight from your inbox. Spam protection: allowed-origin check,
hidden honeypot field, input validation and max 5 messages per IP per 10 min.

One-time setup:

1. **Resend** — create a free account, verify the `activezoneoutdoor.cy`
   domain (adds a few DNS records) and create an API key.
2. **Supabase** — create a free project, then with the
   [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push                       # creates contact_messages
   supabase secrets set \
     RESEND_API_KEY=re_xxx \
     CONTACT_TO_EMAIL=you@activezoneoutdoor.cy \
     CONTACT_FROM_EMAIL="Active Zone Outdoor <website@activezoneoutdoor.cy>" \
     ALLOWED_ORIGINS=https://www.activezoneoutdoor.cy,https://activezoneoutdoor.cy
   supabase functions deploy contact
   ```

3. **Website** — in `assets/js/main.js` set
   `CONTACT_ENDPOINT = "https://<project-ref>.supabase.co/functions/v1/contact"`.

Until `CONTACT_ENDPOINT` is set, the form falls back to opening the visitor's
email app addressed to `CONTACT_EMAIL`.

Messages are in Supabase → Table Editor → `contact_messages`; `email_sent` /
`email_error` show whether the notification email went out.

Run the function's tests with [Deno](https://deno.com):

```sh
cd supabase/functions/contact && deno task test
```

## Before going live

- **Contact form** — complete the setup above, and confirm `CONTACT_EMAIL`
  in `assets/js/main.js` (fallback address, currently a placeholder).
- **Photos** — the hero and cards use illustrations; real photos of activities
  will make the biggest difference. Add them to `assets/img/`.
- **Social links** — add Facebook / Instagram URLs to the footer.
- Check the age range (13–30) in "Get involved" matches your programmes.
