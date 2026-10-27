# DB Board Labeller

Offline PWA for South African electricians. Photograph a distribution board, tap each breaker, describe what it feeds, then print breaker labels and a SANS 10142-1 circuit schedule to attach to the Certificate of Compliance.

**Live app:** https://m9r1u5.github.io/DB-Labeller/

## Features
- Jobs (client, site address, COC ref, date, electrician + registration no.) with multiple boards each
- Board details: name, location, supply source, main switch rating
- Camera / gallery photo, auto-compressed; pinch-zoom, pan, tap to add numbered markers, drag to move
- Circuit details: number, description (with editable quick-picks), device type, rating, poles, curve, RCD mA, cable size, points, notes
- PDF outputs (generated on the phone, no internet): breaker labels (individual or strip per DIN row, adjustable module width), circuit schedule per board with marked-up photo, combined job report
- CSV export, full backup/restore (including photos)
- Install, Update and Share App buttons; light/dark mode

## Hosting
Flat repo, no build step. GitHub Pages → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

## Releasing an update
Bump the version in `app.js`, `sw.js`, `version.json`, `apk/package.json` and the three `?v=` links in `index.html`, then push. GitHub Pages updates the web app and Actions builds a new APK (Releases). Users tap **Update** in the app.
