# Chrome Web Store listing — BasePaint Live Rooms v0.5.0

## Product details

- **Name:** BasePaint Live Rooms
- **Summary:** Verified artist rooms with screen, camera, audio, and saved-pixel layers directly inside BasePaint.
- **Category:** Social & Communication
- **Language:** English (United States)
- **Homepage:** https://basepaint-live.vercel.app/
- **Support:** https://github.com/XipleETH/basepaint-live/issues
- **Privacy policy:** https://basepaint-live.vercel.app/privacy.html
- **Source:** https://github.com/XipleETH/basepaint-live
- **Initial visibility:** Unlisted

## Detailed description

Watch and broadcast verified artist rooms without leaving the BasePaint canvas.

BasePaint Live Rooms adds a Streaming tab beside BasePaint's Chat and Mentions panels. Viewers can discover active artists first, open an artist room, watch a movable live window, see the artist's optional camera, and toggle that wallet's saved-pixel layer over a dimmed canvas.

Artists can share a browser tab, application window, full display, or a selected area. Camera and microphone are optional and only start after the artist chooses them and approves the browser prompt. A pop-out viewer makes it possible to watch the stream on another monitor.

Only the wallet already connected to BasePaint can open its transmitter room. The service verifies a short-lived wallet signature and confirms that the wallet owns a BasePaint Brush before granting publishing access.

Key features:

- Live screen, window, display, and selected-area sharing.
- Optional camera and microphone.
- Per-artist saved-pixel overlays from BasePaint's public indexer.
- Live artists shown first, including artists with zero saved pixels that day.
- Viewer and streamer layouts designed to keep the shared canvas usable.
- Movable, minimizable, and pop-out live viewer.
- Public ENS and Basename labels when available.
- Manifest V3 with bundled executable code and narrowly scoped host access.

BasePaint Live Rooms is an independent open-source hackathon project and is not operated by or affiliated with BasePaint. It does not request seed phrases or private keys and does not modify or submit BasePaint transactions.

## Single purpose

Add verified live artist rooms and per-artist saved-pixel views directly to the BasePaint Paint page.

## Permission and host justifications

The package requests no general Chrome API permissions.

- `https://basepaint.xyz/*`: insert the Streaming interface only on the Paint page and read public daily theme information.
- `https://graphql.basepaint.xyz/*`: read public canvas, contribution, and stroke data used for artist lists and saved-pixel layers.
- `https://api.web3.bio/*`: resolve public ENS and Basename labels for wallet addresses.
- `https://basepaint-live.vercel.app/*`: request short-lived LiveKit tokens and verified live-room status.
- `https://*.livekit.cloud/*`: establish the encrypted WebRTC connection selected by the user.

## Remote code declaration

**No.** The extension does not execute remotely hosted JavaScript or WebAssembly. LiveKit client code and all other executable code are included in the submitted package. Remote endpoints return public data, room state, and short-lived tokens only.

## Data disclosures

Declare that the extension handles:

- Personally identifiable information: public wallet address and public ENS/Basename display name.
- Authentication information: a short-lived wallet signature used only to verify control of the broadcasting wallet.
- User-provided content: camera, microphone, and screen media explicitly selected for a live room.
- Website content: public BasePaint canvas and contribution data required for the user-facing artist layer feature.

The extension does not sell data, use data for advertising, determine creditworthiness, or allow human review of media. Media is not recorded or stored by BasePaint Live.

## Reviewer test instructions

1. Install the extension and open `https://basepaint.xyz/paint`.
2. Open the right-side panel and select **Streaming**, which replaces the normal Search tab label.
3. No wallet is needed to inspect today's public artist list, search artists, expand a row, or toggle saved pixels.
4. Select an artist with saved pixels to verify that only that wallet's contribution appears over the dimmed BasePaint canvas.
5. Active verified broadcasts appear first with a green **LIVE** label. Open one to subscribe to available screen, camera, and microphone tracks.
6. Broadcasting requires the wallet already connected to BasePaint to own a BasePaint Brush. Choose **GO LIVE**, sign the displayed short-lived message, and then select camera, screen/window, or selected-area sharing. The extension never requests a seed phrase or private key.
7. Browser media prompts occur only after the corresponding user action. Ending the room or stopping the browser share stops the outgoing tracks.

## Required listing assets

- `store/listing/extension-icon-128.png`
- `store/listing/small-promo-440x280.png`
- `store/listing/screenshot-1-1280x800.png`
- `store/listing/screenshot-2-1280x800.png`

## Submission notes

The first release should be submitted as **Unlisted**. It remains reviewed and installable from the official Chrome Web Store URL while early users validate the live workflow. Change visibility to **Public** after that test period.
