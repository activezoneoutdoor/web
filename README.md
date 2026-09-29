# Active Zone Outdoor — website

Modern, responsive one-page website for [Active Zone Outdoor](https://www.activezoneoutdoor.cy),
a non-profit youth organisation in Larnaca, Cyprus.

Plain HTML, CSS and JavaScript — no build step, no framework, no dependencies.

```
index.html            page content
assets/css/styles.css design system + layout (light & dark mode)
assets/js/main.js     menu, scroll effects, activity filter, contact form
assets/img/           logo + favicon (SVG)
```

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Upload the repository contents to any static host (GitHub Pages, Netlify,
Cloudflare Pages, or the existing web host).

## Before going live

- **Contact email** — set `CONTACT_EMAIL` at the top of `assets/js/main.js`
  (currently a placeholder, `info@activezoneoutdoor.cy`). For a form that sends
  without opening the visitor's email app, point the form at a service such as
  Formspree or Netlify Forms.
- **Photos** — the hero and cards use illustrations; real photos of activities
  will make the biggest difference. Add them to `assets/img/`.
- **Social links** — add Facebook / Instagram URLs to the footer.
- Check the age range (13–30) in "Get involved" matches your programmes.
