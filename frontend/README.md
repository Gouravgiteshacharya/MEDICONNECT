# MediConnect frontend

## Environment

Copy `.env.example` to `.env.local` and configure values for the environment.

`VITE_GOOGLE_MAPS_API_KEY` enables browser-side manual address search using the
Google Maps JavaScript API and Places API. Use a browser key restricted to the
allowed HTTP referrers and only the Google APIs required by this frontend.
Never put the backend Google Routes credential or another server secret in a
`VITE_` variable, because Vite exposes those values to the browser.

`VITE_API_BASE_URL` must use HTTPS outside local development. The deployment
currently targets the Render API. `VITE_PUBLIC_SITE_URL` is the canonical HTTPS
origin used for canonical links, social metadata, `robots.txt`, and
`sitemap.xml`; set it to the final public custom domain before launch. On
Vercel, builds fall back to the automatic `VERCEL_PROJECT_PRODUCTION_URL`.

The Google browser key is intentionally public. Restrict it in Google Cloud to
the exact production and preview HTTP referrers and only the Maps JavaScript and
Places APIs. Never substitute a server credential or service-role key.

Analytics instrumentation is disabled by default. Setting
`VITE_ANALYTICS_ENABLED=true` only emits allow-listed, payload-free browser
events through `mediconnect:analytics`; a reviewed provider adapter can listen
for those events later. Do not attach addresses, contact data, medicine details,
prescription data, credentials, tokens, licence numbers, document names, or
signed URLs.

MediConnect currently uses browser storage only for essential authentication
and customer destination state. No advertising cookies, non-essential tracking
cookies, or third-party analytics are loaded, so the implementation does not
show a cosmetic consent banner. If an optional analytics provider is added,
obtain and persist explicit accept/reject preference before loading it.

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
