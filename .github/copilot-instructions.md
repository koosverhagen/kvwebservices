# Copilot Instructions for kvwebservices

## Repository Summary

KV Web Services is a static business website for a UK web design & development agency. It is a plain HTML/CSS/JavaScript site with no build tools, package managers, or frameworks. The site is deployed to GitHub Pages directly from the repository root.

## Project Layout

```
/                        # Root — all top-level .html files are individual pages
  index.html             # Homepage
  about.html
  services.html
  portfolio.html
  contact.html
  qualifications.html
  integrations.html
  performance-seo.html
  web-design-uk.html
  hirecheck.html
  thank-you.html
  CNAME                  # Custom domain: kvwebservices.co.uk
  css/
    style.css            # Single global stylesheet (versioned via ?v=N query param in HTML)
  js/
    main.js              # Shared JS (navigation, footer year, etc.)
    contact.js           # Contact form logic
  images/                # Site-wide images (.webp)
  videos/                # Site-wide videos
  artist-store/          # Sub-site: "Abbie at Heart" e-commerce case study
    index.html
    store.html
    checkout.html
    commission.html
    studio.html
    about.html
    style.css
    store.js
    menu.js
  equinetransportuk/     # Sub-site: Equine Transport UK client project
    index.html
    pricing-terms.html
    styles.css
    app.js
    images/
    backend-worker/      # Cloudflare Worker backend code
  scripts/               # One-off Python image processing scripts (not part of the site)
  .github/
    workflows/
      deploy.yml         # GitHub Pages deployment workflow (triggers on push to main)
```

## Build & Deployment

There are **no build steps**. The site is pure static HTML/CSS/JS.

- **To deploy:** Push or merge to `main`. The `deploy.yml` workflow automatically deploys the entire repository root to GitHub Pages.
- **No install, compile, lint, or test commands exist** — do not attempt to run `npm install`, `npm test`, or similar.
- **CSS versioning:** The stylesheet is loaded with a `?v=N` cache-busting query param in each HTML file. When updating `css/style.css`, increment the version number in every HTML file that references it (e.g. `style.css?v=30` → `style.css?v=31`). Same applies to `js/main.js`.

## Key Conventions

- All pages share a consistent `<header>` with nav links and a `<footer>` with a JS-injected copyright year. Keep these consistent across pages.
- Styles are in a single file: `css/style.css`. Sub-sites have their own local `style.css`.
- JavaScript is minimal and vanilla. No frameworks or transpilation.
- Images use `.webp` format and `loading="lazy"`.
- The `scripts/` directory contains Python image utilities unrelated to the site itself — do not modify or run them unless specifically asked.

## Validation

There is no automated test suite. To validate changes:

1. Open the relevant `.html` file(s) directly in a browser.
2. Check that navigation links work, layout is intact, and no console errors appear.
3. The CI pipeline (`deploy.yml`) only deploys — it does not run any checks. A passing workflow means the site was uploaded to Pages, not that it is correct.

## GitHub Pages

- Custom domain: `kvwebservices.co.uk` (set via the `CNAME` file in the root).
- Deployment is from the repository root (`path: .` in the workflow).
- Do not delete or rename the `CNAME` file.
