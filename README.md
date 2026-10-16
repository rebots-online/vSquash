# vSquash / Argon Squash

Browser-based 3D arcade squash game using Vite and Three.js, with keyboard/mouse shot selection, AI opposition, and optional device-camera pose/swing controls.

> **Current deployment scope (reviewed 2026-10-16):** Single-player keyboard/mouse and optional browser camera can be hosted as a static site. The multiplayer/phone-controller API is embedded in Vite development/preview middleware and is **not** included in the production `dist/` output. Casting and standalone phone-racquet clients must not be advertised as working production features.

## Quick start — local

Prerequisites: Node.js and npm, or Bun.

```bash
git clone https://github.com/rebots-online/vSquash.git
cd vSquash
bun install --frozen-lockfile
bun run dev
# open http://localhost:3000
```

Alternative: `npm install && npm run dev`. Use `npm run lint` to run the TypeScript check.

Use the in-game Controls Guide for the current keyboard and mouse mappings. Select strokes with the game's shot hotkeys and use Space / mouse to prepare and execute. Enable **Pose Cam** to try front/rear camera motion input; grant the browser's permission prompt. Camera behaviour and performance vary by device.

## Build the current single-player web app

```bash
bun install --frozen-lockfile
bun run build
# inspect dist/
bun run preview
# open http://localhost:3000
```

`npm run build` is also supported. The build script first runs `node scripts/download-assets.mjs`, which fetches 3D and MediaPipe assets into `public/assets/`, then runs `vite build`. **Internet access is required on a clean build**. Confirm that the assets are present in `dist/assets/`. Some game and MediaPipe references still use Google/CDN URLs at runtime; verify these on the deployed site. No GPU-equipped web server is required: the game runs in the user's browser.

**Before declaring success:** Test that the production preview starts, game loads and renders, keyboard shot selection functions, an AI rally works, camera permission is granted, the correct camera is selected, pose tracking actually reacts, and the browser console/network tab contains no 404, CORS or WebGL errors. This is a deployment recipe, not a claim that each target has passed that test.

### Camera and security requirements

- Use **HTTPS** for a public device-camera deployment. `localhost` is allowed for development. An arbitrary `http://LAN-IP` page may not have access to `getUserMedia`.
- Camera access is local to the browser for pose analysis; ordinary static hosting does not itself require sending camera frames to a server. Review any external scripts/assets and browser permissions independently.
- Grant camera permissions and use a compatible browser/device; iOS and Android camera selection, WebGL and MediaPipe capabilities differ.
- Do not expose API keys as Vite `define` constants or other browser-bundled values. Audit the existing `GEMINI_API_KEY` build configuration before production use.
- For camera-focused TV use, connecting a PC/browser to the TV is the simplest as-is setup. Phone-to-TV screen mirroring may work depending on phone and receiver but **Google Cast sender/receiver functionality is not implemented in this repository**.

## A. Surge.sh — quickest public demo

```bash
bun run build
npx surge ./dist vsquash.surge.sh
```

Install the CLI globally if preferred (`npm install -g surge`). Replace the domain with one you control and authenticate with Surge when prompted. To republish, rerun the same two commands.

For future history-based single-page-app routes (not required for the current root page), copy `dist/index.html` to `dist/200.html` before deploying. **Static hosting supports single-player play, but does not execute the Vite `/api/` middleware.**

## B. Netlify

Connect the GitHub repo in Netlify or deploy `dist/` manually.

- Build command: `npm run build`
- Publish directory: `dist`
- Node.js runtime: use a supported recent version; ensure asset downloads have network access.
- Optional single-page-app fallback, only if adding client-side history routes: create `public/_redirects` containing `/* /index.html 200` (and ensure real assets are not shadowed).

CLI alternative:

```bash
npm run build
npx netlify-cli deploy --dir=dist --prod
```

Netlify Functions are not a drop-in replacement for the current Vite in-memory multiplayer room server.

## C. Vercel

Import the GitHub repo, choose Vite, configure `npm run build`, output `dist`, and deploy. Alternatively:

```bash
npm run build
npx vercel --prod
```

Set the Vercel project root to the repository root. If you later add client-side history routes, add an appropriate `vercel.json` rewrite **without rewriting asset or future API requests accidentally**. Vercel does not automatically run the Vite development-only API plugin in a production static deployment.

## D. Nginx UI / self-hosted Nginx

Nginx UI is an Nginx configuration/administration interface, not a second application runtime. Build locally or in CI, then install the resulting `dist/` files on the web host:

```bash
bun run build
# On the web host, after transferring dist/:
sudo mkdir -p /var/www/vsquash
sudo rsync -a --delete dist/ /var/www/vsquash/
```

Equivalent site configuration (or enter it through Nginx UI):

```nginx
server {
    listen 80;
    server_name squash.example.com;
    root /var/www/vsquash;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

Configure a TLS certificate/HTTPS in Nginx UI before using camera controls remotely. Expose only ports 80/443. **No Node service is needed for static single-player**. When multiplayer is added, run its separate backend and reverse-proxy its routes rather than pointing Nginx at the Vite development server.

## E. Hostinger

For ordinary shared/web hosting, run `npm run build` on your workstation or in CI, then upload the **contents** of `dist/` to your site's `public_html/` directory via File Manager or SFTP. Enable HTTPS. The single-player app does not require a Hostinger Node hosting plan or a VPS. A VPS becomes useful for the future long-lived multiplayer room/telemetry backend.

## F. Oracle Cloud Always Free / other Linux VPS

Use an existing VM; an HTTP server is sufficient for the current single-player app. Build locally (simpler on a small VM), transfer `dist/`, and serve it with Nginx:

```bash
# local after npm run build:
rsync -av dist/ ubuntu@YOUR_VM:/tmp/vsquash-dist/
# VM:
sudo apt-get update && sudo apt-get install -y nginx
sudo mkdir -p /var/www/vsquash
sudo rsync -a --delete /tmp/vsquash-dist/ /var/www/vsquash/
```

Create the Nginx site shown above, enable it, validate with `sudo nginx -t`, and reload Nginx. Point DNS to the VM. Allow inbound 80/443 in the Oracle VCN/security rules and OS firewall, then configure TLS (for example Certbot). CPU/GPU inference on the VM is **not** needed for browser-rendered solo play. OCI Free Tier compute allocations, quotas and capacity are subject to Oracle's current policies and region availability.

## Deployment matrix

| Hosting | Single-player keyboard | Device camera | Phone-racquet + online multiplayer |
| --- | --- | --- | --- |
| Surge | Yes, after successful static build | HTTPS + compatible browser | No; separate production services and companion required |
| Netlify | Yes | HTTPS + compatible browser | No, not from current static build |
| Vercel | Yes | HTTPS + compatible browser | No, not from current static build |
| Nginx UI + Nginx | Yes | HTTPS + compatible browser | Future standalone backend needed |
| Hostinger web hosting | Yes | HTTPS + compatible browser | Future backend needed |
| Oracle VM + Nginx | Yes | HTTPS + compatible browser | Possible after backend extraction |

The webcam's *single-person* mode is an existing feature; the two-player split-zone pose system is experimental and should not be confused with robust multi-person skeletal identity tracking. The present code references `/companion.html` and `/join.html` without those pages being present in the inspected repository tree. Existing `/api/match/*` and `/api/racket/*` endpoints are handled by `vite.config.ts` during Vite dev/preview only. None are part of the emitted static site.

## Future architecture (not required for as-is deployment)

For two phones acting as racquets, low-latency local sessions, remote multiplayer, and native Android/Windows/Linux packaging, first update **`DOCS/ARCHITECTURE.md`**, then operationalize the changes as ordered, independently verifiable tasks in **`CHECKLIST.md`**, including kstore metadata, task ownership, acceptance gates and implementation commit references. Maintain one shared physics/game client and extract transport/session authority into a deployable service. Use Tauri 2 for native packaging only after the static browser build and cross-device input contracts are stable.

## Source layout

- `src/game_engine.js` — main Three.js game orchestration
- `src/motion_controls.js` — keyboard, mouse, pose and companion input integration
- `src/squash/` — ball physics, court, shots, opponent, movement and tests
- `vite.config.ts` — Vite setup **and development/preview-only room/phone API**
- `scripts/download-assets.mjs` — build-time asset downloads
- `DOCS/ARCHITECTURE.md` — architecture digital twin
- `CHECKLIST.md` — execution and verification recipe

## Release smoke-test checklist

1. Run a clean `bun install --frozen-lockfile && bun run build`; inspect build logs for missing asset downloads.
2. Run `bun run preview`; exercise keyboard controls and AI opponent without using the Vite development server.
3. Deploy `dist/`; verify HTTPS and asset requests (including fonts/models/WASM) have HTTP 200 responses.
4. Test WebGL frame rate and audio initiation on Chrome desktop and a mobile browser.
5. Toggle Pose Cam; grant permission; test front/rear camera and actual shot recognition. If camera fails, verify HTTPS, permissions, media paths and browser support.
6. Verify that missing multiplayer/companion pages are not presented as operational public features.
7. Record target host, commit SHA, tested browser/device, test outcomes and unresolved limitations.

**Status:** Documentation of deployment paths only. No deployment, production smoke test, or multiplayer implementation is implied.
