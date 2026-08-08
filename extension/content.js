(() => {
  if (window.__basepaintLiveRooms) return;
  window.__basepaintLiveRooms = true;

  const START_TIMESTAMP = 1691599315;
  const GRAPHQL_URL = "https://graphql.basepaint.xyz/";
  const PROFILE_API = "https://api.web3.bio/profile/";
  const FALLBACK_PALETTE = ["#0a0f0d", "#39ff14"];
  const baseMessages = [
    { author: "room-bot", body: "Select an artist to follow their saved pixel layer." },
    { author: "basepaint_live", body: "The room refreshes from the public indexer every 5 seconds." },
  ];

  const state = {
    day: Math.floor((Date.now() / 1000 - START_TIMESTAMP) / 86400) + 1,
    theme: "",
    palette: FALLBACK_PALETTE,
    onchainArtists: [],
    liveArtists: new Map(),
    liveRefreshInFlight: false,
    artists: [],
    selectedArtist: null,
    expandedArtistId: null,
    selectedPixels: [],
    selectedStrokes: 0,
    view: "pixels",
    role: "observer",
    connectedAccount: "",
    connectedName: "",
    walletBridgeReady: false,
    walletRequestPending: false,
    search: "",
    roomMessages: [...baseMessages],
    profileCache: new Map(),
    micEnabled: false,
    cameraEnabled: false,
    screenEnabled: false,
    screenMode: "",
    remoteCameraActive: false,
    remoteMicrophoneActive: false,
    remoteScreenAudioActive: false,
    remoteScreenActive: false,
    remoteCameraSubscribed: false,
    remoteMicrophoneSubscribed: false,
    remoteScreenAudioSubscribed: false,
    remoteScreenSubscribed: false,
    audioOutputEnabled: true,
    remoteParticipantCount: 0,
    liveConnected: false,
    liveRoom: "",
    liveRole: "",
    livekitError: "",
    liveSessionId: 0,
    liveConnectingKey: "",
    liveConnectPromise: null,
    mediaCredentials: null,
    mediaConnected: false,
    mediaBridgeReady: false,
    pendingSignature: null,
    savedPixelsVisible: true,
    goLiveOpen: false,
    screenStream: null,
    root: null,
    pixelOverlay: null,
    layerBadge: null,
    diffusionOverlay: null,
    canvasControls: null,
    mediaRoot: null,
    mediaVideo: null,
    inlineVideo: null,
    localPreviewMinimized: false,
    previewPosition: { x: 16, y: 16 },
    viewerPosition: { x: 18, y: 18 },
    mediaDrag: null,
    regionRoot: null,
    regionReady: false,
    regionSelection: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    regionKeyHandler: null,
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function friendlyMediaError(error, operation = "") {
    const message = String(error?.message || error || "Media permission failed.");
    if (!/(permission|notallowed|denied)/i.test(message)) return message;
    if (operation.includes("camera")) return "Allow camera access for the BasePaint Live extension in browser permissions, then try again.";
    if (operation.includes("mic")) return "Allow microphone access for the BasePaint Live extension in browser permissions, then try again.";
    if (operation.includes("screen") || operation.includes("region")) return "Screen sharing was cancelled or blocked by the browser.";
    return "Allow camera and microphone access for the BasePaint Live extension, then try again.";
  }

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Unknown wallet";
  }

  function normalizeAccount(value) {
    const candidate = String(value || "").trim();
    return /^0x[a-f0-9]{40}$/i.test(candidate) ? candidate.toLowerCase() : "";
  }

  function isTransmitter() {
    return state.role === "transmitter" && Boolean(state.connectedAccount);
  }

  function liveApiBase() {
    return String(globalThis.__basepaintLiveConfig?.apiBase || "").replace(/\/+$/, "");
  }

  function liveConfigured() {
    return Boolean(liveApiBase());
  }

  function roomNameFor(accountId) {
    return `basepaint-day-${state.day}-${normalizeAccount(accountId)}`;
  }

  function cameraIsOn() {
    return isTransmitter() ? state.cameraEnabled : state.remoteCameraActive;
  }

  function microphoneIsOn() {
    return isTransmitter() ? state.micEnabled : state.remoteMicrophoneActive;
  }

  function remoteAudioIsOn() {
    return state.remoteMicrophoneActive || state.remoteScreenAudioActive;
  }

  function screenIsOn() {
    if (liveConfigured()) return isTransmitter() ? state.screenEnabled : state.remoteScreenActive;
    return Boolean(state.screenStream);
  }

  function profileName(value) {
    const candidate = String(value || "").trim();
    return /(?:\.base\.eth|\.eth)$/i.test(candidate) ? candidate : "";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(Number(value || 0));
  }

  function initials(artist) {
    const label = artist?.ensName || artist?.label || "BP";
    return label.replace(/\.(?:base\.)?eth$/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "BP";
  }

  function graphQL(query, variables = {}) {
    return fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    }).then((response) => {
      if (!response.ok) throw new Error(`GraphQL ${response.status}`);
      return response.json();
    });
  }

  function decodeStrokeData(strokes) {
    const pixels = new Map();
    for (const stroke of strokes || []) {
      const raw = String(stroke?.data || "").replace(/^0x/i, "").replace(/\s+/g, "");
      for (let offset = 0; offset + 6 <= raw.length; offset += 6) {
        const x = Number.parseInt(raw.slice(offset, offset + 2), 16);
        const y = Number.parseInt(raw.slice(offset + 2, offset + 4), 16);
        const color = Number.parseInt(raw.slice(offset + 4, offset + 6), 16);
        if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 256 && y < 256) pixels.set(`${x}:${y}`, { x, y, color });
      }
    }
    return [...pixels.values()];
  }

  function artistRecord(accountId, pixelsCount = 0, index = 0) {
    const normalized = normalizeAccount(accountId);
    if (!normalized) return null;
    return {
      accountId: normalized,
      pixelsCount: Number(pixelsCount || 0),
      fallbackLabel: shortAddress(normalized),
      label: shortAddress(normalized),
      ensName: "",
      room: `ROOM ${String(index + 1).padStart(2, "0")}`,
      color: state.palette[index % state.palette.length] || "#f8db4c",
      isLive: false,
      liveStatus: null,
    };
  }

  function mapArtists(items) {
    return (items || [])
      .map((item, index) => artistRecord(item?.accountId, item?.pixelsCount, index))
      .filter(Boolean)
      .sort((left, right) => right.pixelsCount - left.pixelsCount);
  }

  function rebuildArtists() {
    const previousSelectedId = state.selectedArtist?.accountId || "";
    const merged = new Map(state.onchainArtists.map((artist) => [artist.accountId, {
      ...artist,
      isLive: false,
      liveStatus: null,
    }]));
    for (const [accountId, liveStatus] of state.liveArtists) {
      const artist = merged.get(accountId) || artistRecord(accountId, 0, merged.size);
      if (artist) merged.set(accountId, { ...artist, isLive: true, liveStatus });
    }
    state.artists = [...merged.values()]
      .sort((left, right) => Number(right.isLive) - Number(left.isLive)
        || right.pixelsCount - left.pixelsCount
        || left.accountId.localeCompare(right.accountId))
      .map((artist, index) => ({
        ...artist,
        room: `ROOM ${String(index + 1).padStart(2, "0")}`,
        color: state.palette[index % state.palette.length] || "#f8db4c",
      }));
    applyProfileNames();

    const refreshedSelection = state.artists.find((artist) => artist.accountId === previousSelectedId);
    if (refreshedSelection) {
      state.selectedArtist = refreshedSelection;
    } else {
      state.selectedArtist = state.artists[0] || null;
      state.expandedArtistId = state.selectedArtist?.accountId || null;
    }
    if (state.expandedArtistId && !state.artists.some((artist) => artist.accountId === state.expandedArtistId)) {
      state.expandedArtistId = state.selectedArtist?.accountId || null;
    }
    return previousSelectedId !== (state.selectedArtist?.accountId || "");
  }

  function applyProfileNames() {
    state.artists = state.artists.map((artist) => {
      const profile = state.profileCache.get(artist.accountId);
      const ensName = profile?.name || "";
      return { ...artist, ensName, label: ensName || artist.fallbackLabel };
    });
    if (state.selectedArtist) {
      state.selectedArtist = state.artists.find((artist) => artist.accountId === state.selectedArtist.accountId) || state.selectedArtist;
    }
  }

  async function resolveProfileNames(artists) {
    const pending = artists.filter((artist) => !state.profileCache.has(artist.accountId));
    if (!pending.length) return;
    await Promise.allSettled(pending.map(async (artist) => {
      try {
        const response = await fetch(`${PROFILE_API}${encodeURIComponent(artist.accountId)}`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`Profile ${response.status}`);
        const payload = await response.json();
        const entries = Array.isArray(payload) ? payload : [payload];
        const preferred = entries
          .map((entry) => profileName(entry?.identity) || profileName(entry?.displayName))
          .find(Boolean) || "";
        state.profileCache.set(artist.accountId, { name: preferred });
      } catch {
        state.profileCache.set(artist.accountId, { name: "" });
      }
    }));
    applyProfileNames();
    renderSearchPanel();
  }

  function stopLocalMedia() {
    const previousRoom = state.liveRoom;
    const previousSessionId = state.liveSessionId;
    state.liveSessionId += 1;
    if (previousRoom) window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-disconnect", room: previousRoom, sessionId: previousSessionId }, "*");
    const mediaDisconnect = globalThis.chrome?.runtime?.sendMessage?.({ target: "background", type: "bpl-media-disconnect", room: previousRoom, sessionId: previousSessionId });
    mediaDisconnect?.catch(() => {});
    state.screenStream?.getTracks().forEach((track) => track.stop());
    state.screenStream = null;
    state.micEnabled = false;
    state.cameraEnabled = false;
    state.screenEnabled = false;
    state.screenMode = "";
    state.remoteCameraActive = false;
    state.remoteMicrophoneActive = false;
    state.remoteScreenAudioActive = false;
    state.remoteScreenActive = false;
    state.remoteCameraSubscribed = false;
    state.remoteMicrophoneSubscribed = false;
    state.remoteScreenAudioSubscribed = false;
    state.remoteScreenSubscribed = false;
    state.remoteParticipantCount = 0;
    state.liveConnected = false;
    state.liveRoom = "";
    state.liveRole = "";
    state.livekitError = "";
    state.liveConnectingKey = "";
    state.liveConnectPromise = null;
    state.mediaCredentials = null;
    state.mediaConnected = false;
    state.view = "pixels";
    closeRegionSelector(false);
    if (state.mediaVideo) state.mediaVideo.srcObject = null;
    syncCanvasModes();
  }

  function applyConnectedAccount(account) {
    const normalized = normalizeAccount(account);
    const previousAccount = state.connectedAccount;
    const previousRole = state.role;
    const nextRole = normalized && state.role === "transmitter" ? "transmitter" : "observer";
    const changed = previousAccount !== normalized || state.role !== nextRole;
    state.connectedAccount = normalized;
    state.role = nextRole;
    state.connectedName = normalized
      ? state.profileCache.get(normalized)?.name || shortAddress(normalized)
      : "";

    if (previousAccount !== normalized && (previousRole === "transmitter" || state.screenStream)) {
      state.goLiveOpen = false;
      stopLocalMedia();
    }
    if (changed) {
      syncCanvasModes();
      renderSearchPanel();
    }
    if (normalized && !state.profileCache.has(normalized)) {
      resolveProfileNames([{ accountId: normalized }]).then(() => {
        if (state.connectedAccount !== normalized) return;
        state.connectedName = state.profileCache.get(normalized)?.name || shortAddress(normalized);
        renderSearchPanel();
      });
    }
  }

  function requestConnectedAccount() {
    if (state.walletRequestPending) return;
    state.walletRequestPending = true;
    window.postMessage({ source: "basepaint-live-rooms", type: "bpl-wallet-request" }, "*");
    window.setTimeout(() => { state.walletRequestPending = false; }, 1500);
  }

  function bindWalletBridge() {
    if (state.walletBridgeReady) return;
    state.walletBridgeReady = true;
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "basepaint-live-rooms") return;
      const data = event.data;
      const isLiveKitEvent = String(data.type || "").startsWith("bpl-livekit-");
      if (isLiveKitEvent && data.sessionId && Number(data.sessionId) !== state.liveSessionId) return;
      if (data.type === "bpl-wallet-response") {
        state.walletRequestPending = false;
        applyConnectedAccount(data.account);
        return;
      }
      if (data.type === "bpl-wallet-sign-response") {
        const pending = state.pendingSignature;
        if (!pending) return;
        state.pendingSignature = null;
        window.clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.signature);
        return;
      }
      if (data.type === "bpl-livekit-connected") {
        if (data.room && state.liveRoom && data.room !== state.liveRoom) return;
        state.liveConnected = true;
        state.liveRoom = data.room || state.liveRoom;
        state.liveRole = data.role || state.liveRole;
        state.livekitError = "";
        renderSearchPanel();
        return;
      }
      if (data.type === "bpl-livekit-disconnected") {
        if (!data.room || data.room === state.liveRoom) {
          if (state.liveRole === "transmitter") {
            const disconnect = globalThis.chrome?.runtime?.sendMessage?.({ target: "background", type: "bpl-media-disconnect", room: state.liveRoom, sessionId: state.liveSessionId });
            disconnect?.catch(() => {});
          }
          state.liveConnected = false;
          state.mediaConnected = false;
          state.mediaCredentials = null;
          state.cameraEnabled = false;
          state.micEnabled = false;
          state.screenEnabled = false;
          state.screenMode = "";
          state.remoteCameraActive = false;
          state.remoteMicrophoneActive = false;
          state.remoteScreenAudioActive = false;
          state.remoteScreenActive = false;
          state.remoteCameraSubscribed = false;
          state.remoteMicrophoneSubscribed = false;
          state.remoteScreenAudioSubscribed = false;
          state.remoteScreenSubscribed = false;
          state.remoteParticipantCount = 0;
          state.liveRoom = "";
          state.view = "pixels";
          syncCanvasModes();
          renderSearchPanel();
        }
        return;
      }
      if (data.type === "bpl-livekit-track") {
        if (data.room && state.liveRoom && data.room !== state.liveRoom) return;
        const source = String(data.source || "");
        const active = Boolean(data.active);
        const remote = Boolean(data.remote);
        const participantId = String(data.participantId || "");
        const observerTrack = remote && state.liveRole === "observer" && !isTransmitter();
        const transmitterTrack = !remote && state.liveRole === "transmitter" && isTransmitter();
        const transmitterMediaTrack = remote
          && state.liveRole === "transmitter"
          && isTransmitter()
          && participantId.startsWith("artist-media-");
        if (!observerTrack && !transmitterTrack && !transmitterMediaTrack) return;
        if ((transmitterTrack || transmitterMediaTrack) && active) state.livekitError = "";
        if (source === "camera") {
          if (observerTrack) {
            state.remoteCameraActive = active;
            state.remoteCameraSubscribed = active;
          }
          else if (transmitterTrack || transmitterMediaTrack) state.cameraEnabled = active;
        }
        if (source === "microphone") {
          if (observerTrack) {
            state.remoteMicrophoneActive = active;
            state.remoteMicrophoneSubscribed = active;
          } else if (transmitterTrack || transmitterMediaTrack) state.micEnabled = active;
        }
        if (source === "screen_share_audio" && observerTrack) {
          state.remoteScreenAudioActive = active;
          state.remoteScreenAudioSubscribed = active;
        }
        if (source === "screen_share") {
          if (observerTrack) {
            state.remoteScreenActive = active;
            state.remoteScreenSubscribed = active;
            if (active) state.view = "screen";
            else if (state.view === "screen") state.view = "pixels";
          } else {
            state.screenEnabled = active;
            if (!active) state.screenMode = "";
            state.view = "pixels";
          }
        }
        syncCanvasModes();
        renderSearchPanel();
        return;
      }
      if (data.type === "bpl-livekit-snapshot") {
        if (data.room && state.liveRoom && data.room !== state.liveRoom) return;
        if (state.liveRole !== "observer" || isTransmitter()) return;
        const nextParticipantCount = Number(data.remoteParticipantCount || 0);
        const nextScreenActive = Boolean(data.remoteScreenPublished);
        const nextScreenSubscribed = Boolean(data.remoteScreenSubscribed);
        const nextCameraActive = Boolean(data.remoteCameraPublished);
        const nextCameraSubscribed = Boolean(data.remoteCameraSubscribed);
        const nextMicrophoneActive = Boolean(data.remoteMicrophonePublished);
        const nextMicrophoneSubscribed = Boolean(data.remoteMicrophoneSubscribed);
        const nextScreenAudioActive = Boolean(data.remoteScreenAudioPublished);
        const nextScreenAudioSubscribed = Boolean(data.remoteScreenAudioSubscribed);
        const changed = state.remoteParticipantCount !== nextParticipantCount
          || state.remoteScreenActive !== nextScreenActive
          || state.remoteScreenSubscribed !== nextScreenSubscribed
          || state.remoteCameraActive !== nextCameraActive
          || state.remoteCameraSubscribed !== nextCameraSubscribed
          || state.remoteMicrophoneActive !== nextMicrophoneActive
          || state.remoteMicrophoneSubscribed !== nextMicrophoneSubscribed
          || state.remoteScreenAudioActive !== nextScreenAudioActive
          || state.remoteScreenAudioSubscribed !== nextScreenAudioSubscribed;
        state.remoteParticipantCount = nextParticipantCount;
        state.remoteScreenActive = nextScreenActive;
        state.remoteScreenSubscribed = nextScreenSubscribed;
        state.remoteCameraActive = nextCameraActive;
        state.remoteCameraSubscribed = nextCameraSubscribed;
        state.remoteMicrophoneActive = nextMicrophoneActive;
        state.remoteMicrophoneSubscribed = nextMicrophoneSubscribed;
        state.remoteScreenAudioActive = nextScreenAudioActive;
        state.remoteScreenAudioSubscribed = nextScreenAudioSubscribed;
        if (state.remoteScreenActive) state.view = "screen";
        else if (state.view === "screen") state.view = "pixels";
        syncCanvasModes();
        if (changed) renderSearchPanel();
        return;
      }
      if (data.type === "bpl-livekit-region-ready") {
        setRegionSelectorReady(Number(data.width || 0), Number(data.height || 0));
        return;
      }
      if (data.type === "bpl-livekit-region-started") {
        state.screenEnabled = true;
        state.screenMode = "region";
        state.livekitError = "";
        state.view = "pixels";
        closeRegionSelector(false);
        syncCanvasModes();
        renderSearchPanel();
        return;
      }
      if (data.type === "bpl-livekit-region-stopped") {
        state.screenEnabled = false;
        state.screenMode = "";
        closeRegionSelector(false);
        syncCanvasModes();
        renderSearchPanel();
        return;
      }
      if (data.type === "bpl-livekit-audio-blocked") {
        if (state.liveRole === "observer" && !isTransmitter()) {
          state.audioOutputEnabled = false;
          renderSearchPanel();
        }
        return;
      }
      if (data.type === "bpl-livekit-error") {
        const operation = String(data.operation || "");
        state.livekitError = friendlyMediaError(data.error || "LiveKit connection failed.", operation);
        if (operation.includes("camera")) state.cameraEnabled = false;
        if (operation.includes("mic")) state.micEnabled = false;
        if (operation.includes("screen") || operation.includes("region")) {
          state.screenEnabled = false;
          state.screenMode = "";
          state.view = "pixels";
        }
        if (operation.includes("region")) closeRegionSelector(false);
        syncCanvasModes();
        renderSearchPanel();
      }
    });
    const bridgeUrl = globalThis.chrome?.runtime?.getURL?.("extension/page-bridge.bundle.js");
    if (bridgeUrl) {
      const script = document.createElement("script");
      script.src = bridgeUrl;
      script.onload = () => { script.remove(); requestConnectedAccount(); };
      (document.head || document.documentElement).append(script);
    } else {
      requestConnectedAccount();
    }
  }

  function bindExtensionMediaBridge() {
    if (state.mediaBridgeReady || !globalThis.chrome?.runtime?.onMessage) return;
    state.mediaBridgeReady = true;
    globalThis.chrome.runtime.onMessage.addListener((data) => {
      if (data?.target !== "content" || !String(data.type || "").startsWith("bpl-media-")) return;
      if (data.sessionId && Number(data.sessionId) !== state.liveSessionId) return;
      if (data.room && state.liveRoom && data.room !== state.liveRoom) return;

      if (data.type === "bpl-media-connected") {
        state.mediaConnected = true;
        state.cameraEnabled = Boolean(data.cameraEnabled);
        state.micEnabled = Boolean(data.micEnabled);
        state.livekitError = "";
      } else if (data.type === "bpl-media-track") {
        state.mediaConnected = true;
        const source = String(data.source || "");
        if (source === "camera") state.cameraEnabled = Boolean(data.active);
        if (source === "microphone") state.micEnabled = Boolean(data.active);
        if (data.active) state.livekitError = "";
      } else if (data.type === "bpl-media-disconnected") {
        state.mediaConnected = false;
        state.cameraEnabled = false;
        state.micEnabled = false;
      } else if (data.type === "bpl-media-error") {
        const operation = String(data.operation || "");
        state.cameraEnabled = Boolean(data.cameraEnabled);
        state.micEnabled = Boolean(data.micEnabled);
        state.livekitError = friendlyMediaError(data.error, operation);
      }
      syncCanvasModes();
      renderSearchPanel();
    });
  }

  async function sendExtensionMediaCommand(type, payload = {}) {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("Extension media capture is unavailable.");
    const result = await globalThis.chrome.runtime.sendMessage({
      target: "background",
      type,
      room: state.liveRoom,
      sessionId: state.liveSessionId,
      ...payload,
    });
    if (!result?.ok) throw new Error(result?.error || "Extension media command failed.");
    state.mediaConnected = !result.idle;
    state.cameraEnabled = Boolean(result.cameraEnabled);
    state.micEnabled = Boolean(result.micEnabled);
    return result;
  }

  async function ensureExtensionMediaSession() {
    if (state.mediaConnected) return true;
    const credentials = state.mediaCredentials;
    if (!credentials?.participantToken || credentials.room !== state.liveRoom) {
      throw new Error("The Live API needs the camera-token update before camera and microphone can start.");
    }
    await sendExtensionMediaCommand("bpl-media-connect", credentials);
    return true;
  }

  function signedMessage(address, room, timestamp) {
    return [
      "BasePaint Live sign-in",
      `Address: ${address}`,
      `Room: ${room}`,
      `Timestamp: ${timestamp}`,
    ].join("\n");
  }

  function requestWalletSignature(message, address) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!state.pendingSignature) return;
        state.pendingSignature = null;
        reject(new Error("Wallet signature timed out."));
      }, 120000);
      state.pendingSignature = { resolve, reject, timer };
      window.postMessage({ source: "basepaint-live-rooms", type: "bpl-wallet-sign-request", message, address }, "*");
    });
  }

  async function requestLiveToken(accountId, role) {
    const room = roomNameFor(accountId);
    const body = { room, role, displayName: state.connectedName || shortAddress(accountId) };
    if (role === "transmitter") {
      const timestamp = Date.now();
      body.address = state.connectedAccount;
      body.timestamp = timestamp;
      body.signature = await requestWalletSignature(signedMessage(body.address, room, timestamp), body.address);
    }
    const response = await fetch(`${liveApiBase()}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Live API ${response.status}`);
    return { ...payload, room };
  }

  async function ensureLiveSession(accountId, role) {
    if (!liveConfigured() || !accountId) return false;
    const room = roomNameFor(accountId);
    const connectionKey = `${room}:${role}`;
    if (state.liveConnected && state.liveRoom === room && state.liveRole === role) return true;
    if (state.liveConnectPromise && state.liveConnectingKey === connectionKey) return state.liveConnectPromise;

    const previousRoom = state.liveRoom;
    const previousSessionId = state.liveSessionId;
    const sessionId = previousSessionId + 1;
    state.liveSessionId = sessionId;
    if (previousRoom) {
      window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-disconnect", room: previousRoom, sessionId: previousSessionId }, "*");
    }
    state.liveConnected = false;
    state.liveRoom = room;
    state.liveRole = role;
    state.mediaCredentials = null;
    state.mediaConnected = false;
    state.livekitError = "";
    state.remoteCameraActive = false;
    state.remoteMicrophoneActive = false;
    state.remoteScreenAudioActive = false;
    state.remoteScreenActive = false;
    state.remoteCameraSubscribed = false;
    state.remoteMicrophoneSubscribed = false;
    state.remoteScreenAudioSubscribed = false;
    state.remoteScreenSubscribed = false;
    state.remoteParticipantCount = 0;

    const connectionPromise = (async () => {
      const token = await requestLiveToken(accountId, role);
      if (state.liveSessionId !== sessionId) return false;
      if (role === "transmitter" && token.mediaParticipantToken) {
        state.mediaCredentials = {
          room,
          serverUrl: token.serverUrl,
          participantToken: token.mediaParticipantToken,
          identity: token.mediaIdentity || "",
          sessionId,
        };
      }
      window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-connect", ...token, role, sessionId }, "*");
      return true;
    })();
    state.liveConnectingKey = connectionKey;
    state.liveConnectPromise = connectionPromise;
    try {
      return await connectionPromise;
    } catch (error) {
      if (state.liveSessionId === sessionId) {
        state.liveRoom = "";
        state.liveRole = "";
        state.liveConnected = false;
      }
      throw error;
    } finally {
      if (state.liveConnectPromise === connectionPromise) {
        state.liveConnectPromise = null;
        state.liveConnectingKey = "";
      }
    }
  }

  async function waitForLiveSession(room, role, timeoutMs = 15000) {
    const sessionId = state.liveSessionId;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (state.liveSessionId !== sessionId || state.liveRoom !== room || state.liveRole !== role) {
        throw new Error("The live room changed while connecting.");
      }
      if (state.liveConnected) return true;
      if (state.livekitError) throw new Error(state.livekitError);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    throw new Error("LiveKit room connection timed out.");
  }

  function requestLiveReattach() {
    if (!liveConfigured() || !state.liveRoom) return;
    window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-reattach", room: state.liveRoom, role: state.liveRole, sessionId: state.liveSessionId }, "*");
    window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-audio-output", room: state.liveRoom, role: state.liveRole, sessionId: state.liveSessionId, enabled: state.audioOutputEnabled }, "*");
  }

  function findBaseCanvas() {
    return $$('canvas').find((canvas) => !canvas.id.startsWith("bpl-") && !canvas.classList.contains("overlay-canvas")) || null;
  }

  function syncCanvasOverlay() {
    const baseCanvas = findBaseCanvas();
    const parent = baseCanvas?.parentElement;
    if (!baseCanvas || !parent || !state.pixelOverlay) return;
    if (state.pixelOverlay.parentElement !== parent) parent.append(state.diffusionOverlay, state.mediaRoot, state.pixelOverlay, state.layerBadge, state.canvasControls);
    const left = baseCanvas.offsetLeft;
    const top = baseCanvas.offsetTop;
    const width = baseCanvas.clientWidth || baseCanvas.width;
    const height = baseCanvas.clientHeight || baseCanvas.height;
    state.diffusionOverlay.style.left = `${left}px`;
    state.diffusionOverlay.style.top = `${top}px`;
    state.diffusionOverlay.style.width = `${width}px`;
    state.diffusionOverlay.style.height = `${height}px`;
    state.pixelOverlay.width = baseCanvas.width;
    state.pixelOverlay.height = baseCanvas.height;
    state.pixelOverlay.style.left = `${left}px`;
    state.pixelOverlay.style.top = `${top}px`;
    state.pixelOverlay.style.width = `${width}px`;
    state.pixelOverlay.style.height = `${height}px`;
    state.layerBadge.style.left = `${left + 12}px`;
    state.layerBadge.style.top = `${top + 52}px`;
    syncMediaPlacement(left, top, width, height);
    state.canvasControls.style.left = `${left + Math.max(12, width - 184)}px`;
    state.canvasControls.style.top = `${top + 12}px`;
    state.canvasControls.style.width = `${Math.min(172, Math.max(130, width - 24))}px`;
    renderCanvasControls();
    syncCanvasModes();
    drawSelectedPixels();
  }

  function syncMediaPlacement(left, top, width, height) {
    if (!state.mediaRoot) return;
    if (!isTransmitter()) {
      const minimized = state.localPreviewMinimized;
      const naturalRatio = state.mediaVideo?.videoWidth && state.mediaVideo?.videoHeight
        ? state.mediaVideo.videoWidth / state.mediaVideo.videoHeight
        : 16 / 9;
      const viewerWidth = minimized
        ? Math.min(230, Math.max(150, width - 16))
        : Math.min(560, Math.max(280, Math.floor(width * 0.58)), Math.max(160, width - 16));
      const viewerHeight = minimized
        ? 34
        : Math.min(Math.max(180, Math.round(viewerWidth / naturalRatio) + 28), Math.max(80, height - 16));
      const maxX = Math.max(8, width - viewerWidth - 8);
      const maxY = Math.max(8, height - viewerHeight - 8);
      const x = Math.min(Math.max(8, Number(state.viewerPosition.x) || 8), maxX);
      const y = Math.min(Math.max(8, Number(state.viewerPosition.y) || 8), maxY);
      state.viewerPosition = { x, y };
      state.mediaRoot.style.left = `${left + x}px`;
      state.mediaRoot.style.top = `${top + y}px`;
      state.mediaRoot.style.width = `${viewerWidth}px`;
      state.mediaRoot.style.height = `${viewerHeight}px`;
      return;
    }
    const minimized = state.localPreviewMinimized;
    const previewWidth = minimized
      ? Math.min(82, Math.max(58, width - 16))
      : Math.min(300, Math.max(160, Math.floor(width * 0.32)), Math.max(80, width - 16));
    const previewHeight = minimized ? 34 : Math.round(previewWidth * 0.62) + 28;
    const maxX = Math.max(8, width - previewWidth - 8);
    const maxY = Math.max(8, height - previewHeight - 8);
    const x = Math.min(Math.max(8, Number(state.previewPosition.x) || 8), maxX);
    const y = Math.min(Math.max(8, Number(state.previewPosition.y) || 8), maxY);
    state.previewPosition = { x, y };
    state.mediaRoot.style.left = `${left + x}px`;
    state.mediaRoot.style.top = `${top + y}px`;
    state.mediaRoot.style.width = `${previewWidth}px`;
    state.mediaRoot.style.height = `${previewHeight}px`;
  }

  function createCanvasOverlay() {
    if (state.pixelOverlay) return;
    state.pixelOverlay = document.createElement("canvas");
    state.pixelOverlay.id = "bpl-pixel-overlay";
    state.diffusionOverlay = document.createElement("div");
    state.diffusionOverlay.id = "bpl-diffusion-overlay";
    state.layerBadge = document.createElement("div");
    state.layerBadge.id = "bpl-layer-badge";
    state.layerBadge.innerHTML = '<span class="bpl-live-dot"></span><span>PIXELS GUARDADOS</span>';
    state.canvasControls = document.createElement("div");
    state.canvasControls.id = "bpl-canvas-controls";
    state.canvasControls.addEventListener("click", (event) => {
      if (event.target.closest("[data-live-canvas-saved]")) toggleSavedPixels();
      if (event.target.closest("[data-live-canvas-screen]")) toggleScreen();
    });
    state.mediaRoot = document.createElement("div");
    state.mediaRoot.id = "bpl-media-root";
    state.mediaRoot.innerHTML = '<video id="bpl-media-video" autoplay playsinline muted></video><div class="bpl-media-label"><strong>ARTIST SCREEN</strong><span id="bpl-media-status">LIVE</span><div class="bpl-media-actions"><button data-live-media-popout type="button" aria-label="Open stream in a separate window">POP OUT</button><button data-live-media-minimize type="button" aria-label="Minimize stream window">−</button></div></div>';
    state.mediaVideo = $("#bpl-media-video", state.mediaRoot);
    state.mediaVideo.addEventListener("loadedmetadata", syncCanvasOverlay);
    state.mediaRoot.addEventListener("click", (event) => {
      if (event.target.closest("[data-live-media-popout]")) return openPopoutViewer();
      if (event.target.closest("[data-live-media-minimize]")) {
        state.localPreviewMinimized = !state.localPreviewMinimized;
        syncCanvasOverlay();
      }
    });
    state.mediaRoot.addEventListener("pointerdown", (event) => {
      if (state.localPreviewMinimized || event.target.closest("button")) return;
      const position = isTransmitter() ? state.previewPosition : state.viewerPosition;
      state.mediaDrag = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
      state.mediaRoot.classList.add("is-dragging");
      event.preventDefault();
    });
    window.addEventListener("pointermove", (event) => {
      if (!state.mediaDrag) return;
      const nextPosition = {
        x: state.mediaDrag.originX + event.clientX - state.mediaDrag.startX,
        y: state.mediaDrag.originY + event.clientY - state.mediaDrag.startY,
      };
      if (isTransmitter()) state.previewPosition = nextPosition;
      else state.viewerPosition = nextPosition;
      const baseCanvas = findBaseCanvas();
      if (baseCanvas) syncMediaPlacement(baseCanvas.offsetLeft, baseCanvas.offsetTop, baseCanvas.clientWidth || baseCanvas.width, baseCanvas.clientHeight || baseCanvas.height);
    });
    window.addEventListener("pointerup", () => {
      state.mediaDrag = null;
      state.mediaRoot?.classList.remove("is-dragging");
    });
    syncCanvasOverlay();
    new ResizeObserver(syncCanvasOverlay).observe(document.body);
  }

  function openPopoutViewer() {
    if (isTransmitter() || !state.liveRoom || !state.selectedArtist) return;
    const viewerPath = globalThis.chrome?.runtime?.getURL?.("extension/viewer.html");
    if (!viewerPath) return;
    const params = new URLSearchParams({
      room: state.liveRoom,
      artist: state.selectedArtist.label || shortAddress(state.selectedArtist.accountId),
    });
    const popup = window.open(`${viewerPath}?${params}`, `basepaint-live-${state.liveRoom}`, "popup=yes,width=960,height=600,resizable=yes,scrollbars=no");
    if (!popup) {
      state.livekitError = "Allow pop-ups to open the stream in a separate window.";
      renderSearchPanel();
      return;
    }
    state.localPreviewMinimized = true;
    syncCanvasOverlay();
    popup.focus?.();
  }

  function renderRegionSelection() {
    const selection = state.regionRoot?.querySelector("#bpl-region-selection");
    if (!selection) return;
    const crop = state.regionSelection;
    selection.style.left = `${crop.x * 100}%`;
    selection.style.top = `${crop.y * 100}%`;
    selection.style.width = `${crop.width * 100}%`;
    selection.style.height = `${crop.height * 100}%`;
    const sourceWidth = Number(state.regionRoot?.dataset.sourceWidth || 0);
    const sourceHeight = Number(state.regionRoot?.dataset.sourceHeight || 0);
    const label = selection.querySelector("span");
    if (label && sourceWidth && sourceHeight) {
      label.textContent = `${Math.round(crop.width * sourceWidth)} × ${Math.round(crop.height * sourceHeight)}`;
    }
  }

  function setRegionSelectorReady(width, height) {
    const root = state.regionRoot;
    if (!root || !width || !height) return;
    state.regionReady = true;
    root.dataset.sourceWidth = String(width);
    root.dataset.sourceHeight = String(height);
    root.classList.add("is-ready");
    const frame = root.querySelector("#bpl-region-video-frame");
    const stage = root.querySelector(".bpl-region-stage");
    if (frame && stage) {
      const ratio = width / height;
      const stageWidth = Math.max(1, stage.clientWidth);
      const stageHeight = Math.max(1, stage.clientHeight);
      if (stageWidth / stageHeight > ratio) {
        frame.style.width = `${Math.floor(stageHeight * ratio)}px`;
        frame.style.height = `${stageHeight}px`;
      } else {
        frame.style.width = `${stageWidth}px`;
        frame.style.height = `${Math.floor(stageWidth / ratio)}px`;
      }
    }
    const status = root.querySelector("#bpl-region-status");
    if (status) status.textContent = "DRAG TO DRAW THE AREA TO SHARE";
    const start = root.querySelector("[data-live-region-start]");
    if (start) start.disabled = false;
    renderRegionSelection();
  }

  function closeRegionSelector(cancelCapture = true) {
    const root = state.regionRoot;
    if (cancelCapture && state.liveRoom) {
      window.postMessage({
        source: "basepaint-live-rooms",
        type: "bpl-livekit-region-cancel",
        room: state.liveRoom,
        role: state.liveRole,
        sessionId: state.liveSessionId,
      }, "*");
    }
    if (state.regionKeyHandler) window.removeEventListener("keydown", state.regionKeyHandler);
    state.regionKeyHandler = null;
    state.regionRoot = null;
    state.regionReady = false;
    root?.remove();
  }

  function createRegionSelector() {
    closeRegionSelector(false);
    state.regionSelection = { x: 0.08, y: 0.08, width: 0.84, height: 0.84 };
    const root = document.createElement("div");
    root.id = "bpl-region-selector";
    root.innerHTML = `<div class="bpl-region-dialog" role="dialog" aria-modal="true" aria-label="Select an area to stream">
      <header><div><span class="bpl-record-dot"></span><strong>SHARE SELECTED AREA</strong></div><button data-live-region-cancel type="button" aria-label="Cancel">×</button></header>
      <div class="bpl-region-stage">
        <div id="bpl-region-video-frame">
          <video id="bpl-region-preview-video" autoplay playsinline muted></video>
          <div id="bpl-region-selection"><span>SELECT AREA</span></div>
        </div>
      </div>
      <footer><span id="bpl-region-status">CHOOSE A SCREEN, WINDOW OR TAB IN THE BROWSER DIALOG</span><div><button data-live-region-cancel type="button">CANCEL</button><button data-live-region-start type="button" disabled>SHARE THIS AREA</button></div></footer>
    </div>`;
    document.body.append(root);
    state.regionRoot = root;
    const frame = root.querySelector("#bpl-region-video-frame");
    let dragStart = null;
    const pointFor = (event) => {
      const bounds = frame.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
        y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
      };
    };
    frame.addEventListener("pointerdown", (event) => {
      if (!state.regionReady) return;
      dragStart = pointFor(event);
      frame.setPointerCapture(event.pointerId);
      state.regionSelection = { x: dragStart.x, y: dragStart.y, width: 0.02, height: 0.02 };
      renderRegionSelection();
      event.preventDefault();
    });
    frame.addEventListener("pointermove", (event) => {
      if (!dragStart || !frame.hasPointerCapture(event.pointerId)) return;
      const point = pointFor(event);
      const x = Math.min(dragStart.x, point.x);
      const y = Math.min(dragStart.y, point.y);
      state.regionSelection = {
        x,
        y,
        width: Math.max(0.02, Math.abs(point.x - dragStart.x)),
        height: Math.max(0.02, Math.abs(point.y - dragStart.y)),
      };
      renderRegionSelection();
    });
    const finishDrag = (event) => {
      if (!dragStart) return;
      if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
      dragStart = null;
    };
    frame.addEventListener("pointerup", finishDrag);
    frame.addEventListener("pointercancel", finishDrag);
    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-live-region-cancel]")) return closeRegionSelector(true);
      if (!event.target.closest("[data-live-region-start]") || !state.regionReady) return;
      const status = root.querySelector("#bpl-region-status");
      if (status) status.textContent = "STARTING SELECTED AREA…";
      const start = root.querySelector("[data-live-region-start]");
      if (start) start.disabled = true;
      window.postMessage({
        source: "basepaint-live-rooms",
        type: "bpl-livekit-region-start",
        room: state.liveRoom,
        role: state.liveRole,
        sessionId: state.liveSessionId,
        crop: state.regionSelection,
      }, "*");
    });
    state.regionKeyHandler = (event) => {
      if (event.key === "Escape") closeRegionSelector(true);
    };
    window.addEventListener("keydown", state.regionKeyHandler);
    renderRegionSelection();
  }

  async function toggleRegionShare() {
    if (!ensureTransmitter()) return;
    if (!liveConfigured()) {
      state.livekitError = "Selected-area streaming requires the LiveKit backend.";
      return renderSearchPanel();
    }
    if (state.screenEnabled && state.screenMode === "region") {
      window.postMessage({
        source: "basepaint-live-rooms",
        type: "bpl-livekit-region-cancel",
        room: state.liveRoom,
        role: state.liveRole,
        sessionId: state.liveSessionId,
      }, "*");
      return;
    }
    try {
      await ensureLiveSession(state.connectedAccount, "transmitter");
      state.livekitError = "";
      createRegionSelector();
      window.postMessage({
        source: "basepaint-live-rooms",
        type: "bpl-livekit-region-prepare",
        room: state.liveRoom,
        role: state.liveRole,
        sessionId: state.liveSessionId,
      }, "*");
    } catch (error) {
      closeRegionSelector(false);
      state.livekitError = error.message || "Unable to select an area to share.";
      renderSearchPanel();
    }
  }

  function drawSelectedPixels() {
    const canvas = state.pixelOverlay;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.savedPixelsVisible || !state.selectedPixels.length) return;
    const scaleX = canvas.width / 256;
    const scaleY = canvas.height / 256;
    const fallbackColor = state.palette[1] || "#39ff14";
    for (const pixel of state.selectedPixels) {
      context.fillStyle = state.palette[pixel.color] || fallbackColor;
      context.fillRect(pixel.x * scaleX, pixel.y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
    }
  }

  function renderCanvasControls() {
    if (!state.canvasControls) return;
    const screenButton = isTransmitter() ? `<button class="bpl-canvas-button${screenIsOn() ? " is-active" : ""}" data-live-canvas-screen type="button">${screenIsOn() ? "STOP SCREEN" : "SCREEN"}</button>` : "";
    const markup = `<button class="bpl-canvas-button${state.savedPixelsVisible ? " is-active" : ""}" data-live-canvas-saved type="button">${state.savedPixelsVisible ? "SAVED PX ON" : "SAVED PX OFF"}</button>${screenButton}`;
    if (state.canvasControls.innerHTML !== markup) state.canvasControls.innerHTML = markup;
  }

  function syncCanvasModes() {
    if (state.pixelOverlay) state.pixelOverlay.style.display = state.savedPixelsVisible ? "block" : "none";
    if (state.layerBadge) state.layerBadge.style.display = state.savedPixelsVisible ? "flex" : "none";
    if (state.diffusionOverlay) state.diffusionOverlay.style.display = "block";
    const screenActive = Boolean(!isTransmitter() && state.remoteScreenActive && state.view === "screen");
    const localThumbnail = !isTransmitter() && state.localPreviewMinimized;
    if (state.mediaRoot) {
      state.mediaRoot.classList.toggle("is-visible", screenActive);
      state.mediaRoot.classList.toggle("is-transmitter", isTransmitter());
      state.mediaRoot.classList.toggle("is-viewer", !isTransmitter());
      state.mediaRoot.classList.toggle("is-minimized", localThumbnail);
    }
    if (state.mediaVideo) state.mediaVideo.style.display = screenActive && !localThumbnail ? "block" : "none";
    if (state.mediaRoot) {
      const status = $("#bpl-media-status", state.mediaRoot);
      if (status) status.textContent = isTransmitter() ? "LOCAL" : "LIVE";
      const minimize = $("[data-live-media-minimize]", state.mediaRoot);
      if (minimize) minimize.textContent = localThumbnail ? "+" : "−";
    }
    renderCanvasControls();
  }

  function toggleSavedPixels() {
    state.savedPixelsVisible = !state.savedPixelsVisible;
    syncCanvasModes();
    drawSelectedPixels();
    renderSearchPanel();
  }

  function setView(view) {
    state.view = view;
    syncCanvasModes();
    drawSelectedPixels();
    renderSearchPanel();
  }

  async function loadArtistPixels() {
    const artist = state.selectedArtist;
    if (!artist) return;
    const accountId = artist.accountId;
    try {
      const result = await graphQL(`query LiveArtistPixels($day: Int!, $account: String!) {
        strokes(where: { canvasId: $day, accountId: $account }) { totalCount items { data } }
      }`, { day: state.day, account: accountId });
      if (state.selectedArtist?.accountId !== accountId) return;
      state.selectedStrokes = Number(result?.data?.strokes?.totalCount || 0);
      state.selectedPixels = decodeStrokeData(result?.data?.strokes?.items);
      syncCanvasOverlay();
      renderSearchPanel();
    } catch {
      state.selectedStrokes = 0;
      state.selectedPixels = [];
      renderSearchPanel();
    }
  }

  async function loadDayData() {
    const [themeResult, dataResult] = await Promise.allSettled([
      fetch(`https://basepaint.xyz/api/theme/${state.day}`).then((response) => response.json()),
      graphQL(`query LiveRooms($day: Int!) {
        canvas(id: $day) { name palette }
        contributions(where: { canvasId: $day }) { totalCount items { accountId pixelsCount } }
      }`, { day: state.day }),
    ]);
    if (themeResult.status === "fulfilled") {
      state.theme = themeResult.value?.theme || "";
      if (Array.isArray(themeResult.value?.palette) && themeResult.value.palette.length) state.palette = themeResult.value.palette;
    }
    if (dataResult.status === "fulfilled") {
      const data = dataResult.value?.data || {};
      if (typeof data.canvas?.palette === "string") state.palette = data.canvas.palette.split(",").map((color) => color.trim()).filter(Boolean);
      state.onchainArtists = mapArtists(data.contributions?.items);
      rebuildArtists();
      resolveProfileNames(state.artists);
    }
    if (!state.selectedArtist && state.artists.length) {
      state.selectedArtist = state.artists[0];
      state.expandedArtistId = state.artists[0].accountId;
    }
    renderSearchPanel();
    loadArtistPixels();
    if (!isTransmitter() && liveConfigured() && state.selectedArtist) {
      ensureLiveSession(state.selectedArtist.accountId, "observer").catch((error) => {
        state.livekitError = error.message || "Unable to join the artist room.";
        renderSearchPanel();
      });
    }
  }

  async function loadLiveArtists() {
    if (!liveConfigured() || state.liveRefreshInFlight) return;
    state.liveRefreshInFlight = true;
    try {
      const response = await fetch(`${liveApiBase()}/api/livekit-status?day=${state.day}`);
      if (!response.ok) throw new Error(`Live status ${response.status}`);
      const payload = await response.json();
      const nextLiveArtists = new Map();
      for (const item of payload.liveArtists || []) {
        const accountId = normalizeAccount(item?.address);
        if (!accountId) continue;
        nextLiveArtists.set(accountId, {
          room: String(item.room || roomNameFor(accountId)),
          screenPublished: Boolean(item.screenPublished),
          cameraPublished: Boolean(item.cameraPublished),
          microphonePublished: Boolean(item.microphonePublished),
          observerCount: Number(item.observerCount || 0),
        });
      }
      state.liveArtists = nextLiveArtists;
      const selectionChanged = rebuildArtists();
      resolveProfileNames(state.artists);
      if (selectionChanged) {
        state.selectedPixels = [];
        state.selectedStrokes = 0;
        drawSelectedPixels();
        loadArtistPixels();
        if (!isTransmitter() && state.selectedArtist) {
          ensureLiveSession(state.selectedArtist.accountId, "observer").catch((error) => {
            state.livekitError = error.message || "Unable to join the artist room.";
            renderSearchPanel();
          });
        }
      }
      renderSearchPanel();
    } catch {
      // Keep the last known list during a short API or LiveKit interruption.
    } finally {
      state.liveRefreshInFlight = false;
    }
  }

  function filteredArtists() {
    const query = state.search.toLowerCase().trim();
    return state.artists.filter((artist) => `${artist.label} ${artist.ensName} ${artist.accountId}`.toLowerCase().includes(query));
  }

  function artistMenuMarkupV2(artist) {
    const messages = state.roomMessages.map((message) => `<div class="bpl-chat-message"><strong>${escapeHtml(message.author)}</strong> ${escapeHtml(message.body)}</div>`).join("");
    const cameraOn = cameraIsOn();
    const micOn = microphoneIsOn();
    const remoteAudioOn = remoteAudioIsOn();
    const streamStatus = isTransmitter()
      ? screenIsOn()
        ? "SCREEN IS LIVE"
        : cameraOn && micOn
          ? "CAMERA + MIC LIVE"
          : cameraOn
            ? "CAMERA LIVE"
            : micOn ? "MIC LIVE" : "READY TO STREAM"
      : !state.liveConnected
        ? "JOINING ARTIST ROOM"
        : state.remoteScreenSubscribed
          ? "SCREEN LIVE"
          : state.remoteScreenActive
            ? "SCREEN FOUND · CONNECTING VIDEO"
            : cameraOn && micOn
              ? "CAMERA + MIC LIVE"
              : cameraOn
                ? "CAMERA LIVE"
                : micOn
                  ? "MIC LIVE"
                  : state.remoteParticipantCount > 0 ? "ARTIST ONLINE · MEDIA OFF" : "WAITING FOR ARTIST";
    const streamStatusLive = screenIsOn() || state.remoteScreenSubscribed || cameraOn || micOn;
    const cameraMarkup = cameraOn
      ? `<div class="bpl-inline-camera is-on"><video id="bpl-inline-camera" autoplay playsinline muted></video><span class="bpl-inline-camera-label"><span class="bpl-live-dot"></span> CAMERA <b class="bpl-camera-mic${micOn ? " is-on" : ""}">${micOn ? "MIC ON" : "MIC OFF"}</b></span></div>`
      : `<div class="bpl-inline-camera"><div class="bpl-camera-placeholder"><span class="bpl-artist-avatar">${escapeHtml(initials(artist))}</span><span>Camera is off</span></div></div>`;
    const deviceMarkup = isTransmitter()
      ? `<div class="bpl-device-row"><button class="bpl-device-button${cameraOn ? " is-on" : ""}" data-live-camera type="button">${cameraOn ? "Camera on" : "Enable camera"}</button><button class="bpl-device-button${micOn ? " is-on" : ""}" data-live-mic type="button">${micOn ? "Mic on" : "Enable mic"}</button></div>`
      : `<div class="bpl-device-row bpl-observer-device"><span>${cameraOn ? "ARTIST CAMERA LIVE" : "CAMERA OFF"}</span><button class="bpl-device-button${state.audioOutputEnabled && remoteAudioOn ? " is-on" : ""}" data-live-audio-output type="button"${remoteAudioOn ? "" : " disabled"}>${remoteAudioOn ? state.audioOutputEnabled ? "Audio on" : "Audio off" : "MIC OFF"}</button></div>`;
    return `<div class="bpl-artist-menu" data-live-menu="${escapeHtml(artist.accountId)}">
      <div class="bpl-stream-state${streamStatusLive ? " is-live" : ""}"><span class="bpl-live-dot"></span>${escapeHtml(streamStatus)}</div>
      ${cameraMarkup}
      ${deviceMarkup}
      <div class="bpl-room-chat"><div class="bpl-chat-label"><span class="bpl-live-dot"></span> ROOM CHAT · ${escapeHtml(artist.label)}</div>${messages}</div>
      <form class="bpl-chat-composer"><input type="text" maxlength="180" placeholder="Say something to the room..." autocomplete="off"><button type="submit" aria-label="Send">↑</button></form>
    </div>`;
  }

  function renderSearchPanel() {
    const root = state.root;
    if (!root) return;
    const previousList = $(".bpl-artist-list", root);
    const previousScrollTop = previousList?.scrollTop || 0;
    const previousScrollLeft = previousList?.scrollLeft || 0;
    const artists = filteredArtists();
    const transmitter = isTransmitter();
    const cameraOn = transmitter ? cameraIsOn() : false;
    const micOn = transmitter ? microphoneIsOn() : false;
    const screenOn = transmitter ? screenIsOn() : false;
    const regionOn = transmitter && screenOn && state.screenMode === "region";
    const liveMenu = state.goLiveOpen
      ? transmitter
        ? `<div class="bpl-go-live-menu"><button class="bpl-go-live-action${cameraOn ? " is-on" : ""}" data-live-camera type="button"><span>${cameraOn ? "●" : "○"}</span> ${cameraOn ? "Camera on" : "Enable camera"}</button><button class="bpl-go-live-action${micOn ? " is-on" : ""}" data-live-mic type="button"><span>${micOn ? "●" : "○"}</span> ${micOn ? "Mic on" : "Enable mic"}</button><button class="bpl-go-live-action${screenOn ? " is-on" : ""}" data-live-screen type="button"><span>${screenOn ? "■" : "□"}</span> ${screenOn ? "Stop share" : "Share screen"}</button><button class="bpl-go-live-action${regionOn ? " is-on" : ""}" data-live-region type="button"><span>${regionOn ? "▣" : "▢"}</span> ${regionOn ? "Area on" : screenOn ? "Switch to area" : "Share area"}</button>${state.livekitError ? `<div class="bpl-live-error">${escapeHtml(state.livekitError)}</div>` : ""}</div>`
        : '<div class="bpl-go-live-menu bpl-wallet-required"><span>Connect your BasePaint wallet first to transmit as the connected artist.</span></div>'
      : "";
    const listMarkup = artists.length ? artists.map((item) => {
      const selected = item.accountId === state.selectedArtist?.accountId;
      const expanded = item.accountId === state.expandedArtistId;
      return `<div class="bpl-artist-entry${expanded ? " is-expanded" : ""}${item.isLive ? " is-live" : ""}">
        <button class="bpl-artist-card${selected ? " is-selected" : ""}${item.isLive ? " is-live" : ""}" data-live-artist="${escapeHtml(item.accountId)}" aria-expanded="${expanded}" type="button">
          <span class="bpl-artist-avatar">${escapeHtml(initials(item))}</span>
          <span><strong class="bpl-artist-name">${escapeHtml(item.label)}</strong><small class="bpl-artist-address">${escapeHtml(shortAddress(item.accountId))}</small></span>
          <span class="bpl-artist-pixels">${item.isLive ? '<strong class="bpl-live-label"><span class="bpl-live-dot"></span>LIVE</strong>' : formatNumber(item.pixelsCount)}<small>${item.isLive ? `${formatNumber(item.pixelsCount)} PX SAVED` : "PX SAVED"}</small><b class="bpl-artist-chevron">${expanded ? "−" : "+"}</b></span>
        </button>
        ${expanded ? artistMenuMarkupV2(item) : ""}
      </div>`;
    }).join("") : '<div class="bpl-list-state">No artists match this wallet.<br>Try the last four characters.</div>';
    root.innerHTML = `<div class="bpl-search-head bpl-search-head-compact">
      <div class="bpl-live-launcher">
        <button class="bpl-go-live-button${state.goLiveOpen ? " is-open" : ""}" data-live-go-live type="button" aria-expanded="${state.goLiveOpen}"><span class="bpl-record-dot"></span> GO LIVE <span class="bpl-chevron">${state.goLiveOpen ? "−" : "+"}</span></button>
        ${liveMenu}
      </div>
    </div>
    <div class="bpl-search-body">
      <div class="bpl-artist-list">${listMarkup}</div>
      ${state.artists.length ? "" : '<div class="bpl-list-state">Loading today\'s artists...</div>'}
    </div>`;
    state.inlineVideo = $("#bpl-inline-camera", root);
    requestLiveReattach();
    const nextList = $(".bpl-artist-list", root);
    if (nextList) {
      nextList.scrollTop = previousScrollTop;
      nextList.scrollLeft = previousScrollLeft;
    }
  }

  function selectArtist(accountId) {
    const artist = state.artists.find((item) => item.accountId === accountId);
    if (!artist) return;
    state.selectedArtist = artist;
    state.expandedArtistId = accountId;
    state.selectedPixels = [];
    state.selectedStrokes = 0;
    state.remoteCameraActive = false;
    state.remoteMicrophoneActive = false;
    state.remoteScreenAudioActive = false;
    state.remoteScreenActive = false;
    state.remoteCameraSubscribed = false;
    state.remoteMicrophoneSubscribed = false;
    state.remoteScreenAudioSubscribed = false;
    state.remoteScreenSubscribed = false;
    state.remoteParticipantCount = 0;
    state.view = "pixels";
    renderSearchPanel();
    drawSelectedPixels();
    loadArtistPixels();
    if (!isTransmitter() && liveConfigured()) {
      ensureLiveSession(accountId, "observer").catch((error) => {
        state.livekitError = error.message || "Unable to join the artist room.";
        renderSearchPanel();
      });
    }
  }

  function toggleArtist(accountId) {
    if (state.expandedArtistId === accountId) {
      state.selectedArtist = state.artists.find((item) => item.accountId === accountId) || state.selectedArtist;
      state.expandedArtistId = null;
      renderSearchPanel();
      return;
    }
    selectArtist(accountId);
  }

  async function toggleCamera() {
    if (!ensureTransmitter()) return;
    if (liveConfigured()) {
      const previousCameraEnabled = state.cameraEnabled;
      const enabled = !state.cameraEnabled;
      try {
        await ensureLiveSession(state.connectedAccount, "transmitter");
        await waitForLiveSession(state.liveRoom, "transmitter");
        await ensureExtensionMediaSession();
        await sendExtensionMediaCommand("bpl-media-camera", { enabled });
        state.livekitError = "";
        syncCanvasModes();
        renderSearchPanel();
      } catch (error) {
        state.cameraEnabled = previousCameraEnabled;
        state.livekitError = friendlyMediaError(error, "camera");
        renderSearchPanel();
      }
      return;
    }
    state.livekitError = "Camera streaming requires the Live API.";
    renderSearchPanel();
  }

  async function toggleMic() {
    if (liveConfigured()) {
      if (!ensureTransmitter()) return;
      const previousMicEnabled = state.micEnabled;
      const enabled = !state.micEnabled;
      try {
        await ensureLiveSession(state.connectedAccount, "transmitter");
        await waitForLiveSession(state.liveRoom, "transmitter");
        await ensureExtensionMediaSession();
        await sendExtensionMediaCommand("bpl-media-mic", { enabled });
        state.livekitError = "";
        syncCanvasModes();
        renderSearchPanel();
      } catch (error) {
        state.micEnabled = previousMicEnabled;
        state.livekitError = friendlyMediaError(error, "mic");
        renderSearchPanel();
      }
      return;
    }
    state.livekitError = "Microphone streaming requires the Live API.";
    renderSearchPanel();
  }

  function toggleAudioOutput() {
    if (isTransmitter() || !liveConfigured() || !state.liveRoom) return;
    state.audioOutputEnabled = !state.audioOutputEnabled;
    document.querySelectorAll(".bpl-live-audio-track").forEach((element) => {
      element.muted = !state.audioOutputEnabled;
      if (state.audioOutputEnabled) element.play?.().catch(() => {});
    });
    window.postMessage({
      source: "basepaint-live-rooms",
      type: "bpl-livekit-audio-output",
      room: state.liveRoom,
      role: state.liveRole,
      sessionId: state.liveSessionId,
      enabled: state.audioOutputEnabled,
    }, "*");
    renderSearchPanel();
  }

  async function toggleScreen() {
    if (!ensureTransmitter()) return;
    if (liveConfigured()) {
      try {
        await ensureLiveSession(state.connectedAccount, "transmitter");
        state.screenEnabled = !state.screenEnabled;
        state.screenMode = state.screenEnabled ? "full" : "";
        state.view = "pixels";
        state.livekitError = "";
        window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-screen", room: state.liveRoom, role: state.liveRole, sessionId: state.liveSessionId, enabled: state.screenEnabled }, "*");
        syncCanvasModes();
        renderSearchPanel();
      } catch (error) {
        state.screenEnabled = false;
        state.screenMode = "";
        state.view = "pixels";
        state.livekitError = error.message || "Unable to share the screen.";
        syncCanvasModes();
        renderSearchPanel();
      }
      return;
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach((track) => track.stop());
      state.screenStream = null;
      state.view = "pixels";
      if (state.mediaVideo) state.mediaVideo.srcObject = null;
      syncCanvasModes();
      renderSearchPanel();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      state.screenStream = stream;
      state.mediaVideo.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (state.screenStream !== stream) return;
        state.screenStream = null;
        state.view = "pixels";
        if (state.mediaVideo) state.mediaVideo.srcObject = null;
        syncCanvasModes();
        renderSearchPanel();
      });
      setView("screen");
      renderSearchPanel();
    } catch {
      renderSearchPanel();
    }
  }

  function ensureTransmitter() {
    if (!state.connectedAccount) {
      state.goLiveOpen = true;
      renderSearchPanel();
      return false;
    }
    if (state.role === "transmitter") return true;
    const previousRoom = state.liveRoom;
    const previousSessionId = state.liveSessionId;
    state.liveSessionId += 1;
    if (previousRoom) window.postMessage({ source: "basepaint-live-rooms", type: "bpl-livekit-disconnect", room: previousRoom, sessionId: previousSessionId }, "*");
    state.liveRoom = "";
    state.liveConnected = false;
    state.liveRole = "";
    state.liveConnectPromise = null;
    state.liveConnectingKey = "";
    state.mediaCredentials = null;
    state.mediaConnected = false;
    state.remoteCameraActive = false;
    state.remoteMicrophoneActive = false;
    state.remoteScreenAudioActive = false;
    state.remoteScreenActive = false;
    state.remoteCameraSubscribed = false;
    state.remoteMicrophoneSubscribed = false;
    state.remoteScreenAudioSubscribed = false;
    state.remoteScreenSubscribed = false;
    state.remoteParticipantCount = 0;
    state.screenMode = "";
    closeRegionSelector(false);
    state.role = "transmitter";
    state.view = "pixels";
    syncCanvasModes();
    return true;
  }

  function bindSearchPanel(root) {
    root.addEventListener("input", (event) => {
      if (event.target.id === "bpl-search-input") {
        state.search = event.target.value;
        renderSearchPanel();
        const input = $("#bpl-search-input", state.root);
        if (input) { input.focus(); input.setSelectionRange(state.search.length, state.search.length); }
      }
    });
    root.addEventListener("click", (event) => {
      const artistButton = event.target.closest("[data-live-artist]");
      if (artistButton) return toggleArtist(artistButton.dataset.liveArtist);
      if (event.target.closest("[data-live-go-live]")) {
        if (!state.connectedAccount) {
          state.goLiveOpen = true;
        } else {
          ensureTransmitter();
          state.goLiveOpen = !state.goLiveOpen;
        }
        return renderSearchPanel();
      }
      const viewButton = event.target.closest("[data-live-view]");
      if (viewButton) return setView(viewButton.dataset.liveView);
      if (event.target.closest("[data-live-camera]")) return toggleCamera();
      if (event.target.closest("[data-live-mic]")) return toggleMic();
      if (event.target.closest("[data-live-audio-output]")) return toggleAudioOutput();
      if (event.target.closest("[data-live-screen]")) return toggleScreen();
      if (event.target.closest("[data-live-region]")) return toggleRegionShare();
    });
    root.addEventListener("submit", (event) => {
      if (!event.target.matches(".bpl-chat-composer")) return;
      event.preventDefault();
      const input = $("input", event.target);
      const body = input?.value.trim();
      if (!body) return;
      state.roomMessages.push({ author: "you", body });
      renderSearchPanel();
    });
  }

  function findStreamingTab() {
    return $('[role="tab"][data-bpl-streaming-tab="true"]') || $$('[role="tab"]').find((item) => ["Search", "Streaming"].includes(item.textContent.trim()));
  }

  function labelStreamingTab(tab) {
    if (!tab) return;
    tab.dataset.bplStreamingTab = "true";
    if (tab.textContent.trim() !== "Streaming") tab.textContent = "Streaming";
  }

  function ensureSearchPanel() {
    const tab = findStreamingTab();
    if (!tab) return;
    labelStreamingTab(tab);
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (!panel) return;
    let root = $("#bpl-search-root", panel);
    let justCreated = false;
    if (!root) {
      root = document.createElement("div");
      root.id = "bpl-search-root";
      panel.append(root);
      bindSearchPanel(root);
      justCreated = true;
    }
    state.root = root;
    const nextDisplay = tab.getAttribute("aria-selected") === "true" ? "flex" : "none";
    const displayChanged = root.style.display !== nextDisplay;
    root.style.display = nextDisplay;
    if (justCreated || (displayChanged && nextDisplay === "flex")) renderSearchPanel();
  }

  function bindSearchTab() {
    $$('[role="tab"]').filter((tab) => ["Search", "Streaming"].includes(tab.textContent.trim()) || tab.dataset.bplStreamingTab === "true").forEach((tab) => {
      labelStreamingTab(tab);
      if (tab.dataset.bplBound) return;
      tab.dataset.bplBound = "true";
      tab.addEventListener("click", () => setTimeout(ensureSearchPanel, 0));
    });
  }

  function boot() {
    createCanvasOverlay();
    bindWalletBridge();
    bindExtensionMediaBridge();
    bindSearchTab();
    ensureSearchPanel();
    loadDayData();
    loadLiveArtists();
    setInterval(() => { bindSearchTab(); ensureSearchPanel(); }, 1000);
    setInterval(requestConnectedAccount, 2000);
    setInterval(loadLiveArtists, 5000);
    setInterval(() => { if (state.selectedArtist) loadArtistPixels(); }, 5000);
    setInterval(syncCanvasOverlay, 1000);
    window.addEventListener("pagehide", () => {
      if (!isTransmitter() || (!state.mediaConnected && !state.cameraEnabled && !state.micEnabled)) return;
      const disconnect = globalThis.chrome?.runtime?.sendMessage?.({ target: "background", type: "bpl-media-disconnect", room: state.liveRoom, sessionId: state.liveSessionId });
      disconnect?.catch(() => {});
    }, { once: true });
  }

  boot();
})();
