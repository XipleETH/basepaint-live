# BasePaint Live

BasePaint Live adds verified artist broadcasts directly to the BasePaint paint page. Viewers can watch a screen, window, or selected area, see the artist's camera, hear their microphone, and toggle that wallet's saved pixel layer without leaving the shared canvas.

Landing page: [basepaint-live.vercel.app](https://basepaint-live.vercel.app)

## What is working

- Manifest V3 extension overlay inside `https://basepaint.xyz/paint`.
- Screen, window, full-display, and selected-area capture.
- Camera and microphone publishing through LiveKit.
- Viewer/streamer separation: a streamer does not cover their own canvas with the outgoing feed.
- Movable viewer window plus a pop-out viewer for another monitor.
- Per-wallet saved-pixel overlays decoded from BasePaint's public indexer.
- Live artists sorted before onchain contributors, including artists who have not saved a pixel that day.
- Transmitter wallet signature verification.
- Server-side BasePaint Brush ownership verification on Base.
- Live room discovery through `/api/livekit-status`.

## Install the extension

1. Download this repository and unzip it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository root (the folder containing `manifest.json`).
5. Open `https://basepaint.xyz/paint` and choose the **Streaming** tab beside Chat and Mentions.

Reload the unpacked extension after rebuilding or pulling a new version.

## Local development

Install dependencies and start the small static server:

```bash
npm install
npm run dev
```

Then open `http://localhost:4173`.

Useful checks:

```bash
npm run check
npm run build:extension
```

`npm run build:extension` regenerates the three browser bundles used by `manifest.json`.

## Realtime backend

The Vercel functions issue LiveKit tokens and expose verified live-room status:

- `POST /api/livekit-token`
- `GET /api/livekit-status`
- `GET /api/health`

Configure these variables in Vercel, never in the extension source:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
BASE_RPC_URL            # optional; defaults to https://mainnet.base.org
SUPABASE_URL            # reserved for shared room chat
SUPABASE_PUBLISHABLE_KEY
```

The transmitter token endpoint verifies a short-lived wallet signature, checks that the room wallet matches the signer, and calls `balanceOf` on the official BasePaint Brush contract before granting publish permissions. Observer tokens are subscribe-only.

## Project structure

```text
api/            Vercel token, status, and health functions
assets/         Landing-page image assets
extension/      Content scripts, styles, viewers, and generated bundles
scripts/        Extension bundle build script
app.js          Landing-page behavior and live-room status
index.html      Landing page
manifest.json   Chrome/Edge extension manifest
styles.css      Landing-page styles
```

## Deployment

The landing page and server functions intentionally live in the same Vercel project. This keeps one public origin for the website and the extension API:

```text
https://basepaint-live.vercel.app
```

The extension's production API origin is configured in `extension/config.js`.

## Hackathon

Built for the [BasePaint Hackathon](https://basepaint.xyz/hack). BasePaint art is CC0.
