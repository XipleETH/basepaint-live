const { Room, RoomEvent, Track } = require("livekit-client");

let activeSession = null;
let commandQueue = Promise.resolve();

const cameraCapture = {
  facingMode: "user",
  resolution: { width: 1280, height: 720, frameRate: 30 },
};
const cameraPublish = {
  simulcast: true,
  videoEncoding: { maxBitrate: 1_800_000, maxFramerate: 30 },
  degradationPreference: "balanced",
};
const microphoneCapture = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

function sessionPayload(session = activeSession) {
  return {
    target: "background-event",
    tabId: Number(session?.tabId || 0),
    room: session?.roomName || "",
    sessionId: Number(session?.sessionId || 0),
  };
}

function send(type, payload = {}) {
  chrome.runtime.sendMessage({ ...sessionPayload(), type, ...payload }).catch(() => {});
}

function sourceFor(publication, track) {
  return publication?.source || track?.source || Track.Source.Unknown;
}

function mediaState(session = activeSession) {
  return {
    cameraEnabled: Boolean(session?.room?.localParticipant?.isCameraEnabled),
    micEnabled: Boolean(session?.room?.localParticipant?.isMicrophoneEnabled),
  };
}

function announceTrack(publication, active) {
  if (!activeSession) return;
  send("bpl-media-track", {
    source: sourceFor(publication, publication?.track),
    active: Boolean(active),
    ...mediaState(),
  });
}

function bindRoomEvents(session) {
  const { room } = session;
  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (activeSession !== session) return;
    announceTrack(publication, !publication.isMuted);
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
    if (activeSession !== session) return;
    announceTrack(publication, false);
  });
  room.on(RoomEvent.TrackMuted, (publication, participant) => {
    if (activeSession !== session || !participant.isLocal) return;
    announceTrack(publication, false);
  });
  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    if (activeSession !== session || !participant.isLocal) return;
    announceTrack(publication, true);
  });
  room.on(RoomEvent.Reconnected, () => {
    if (activeSession !== session) return;
    send("bpl-media-connected", mediaState(session));
  });
  room.on(RoomEvent.Disconnected, () => {
    const unexpected = activeSession === session;
    if (unexpected) activeSession = null;
    chrome.runtime.sendMessage({ ...sessionPayload(session), type: "bpl-media-disconnected", unexpected }).catch(() => {});
  });
}

async function disconnectMedia() {
  const session = activeSession;
  if (!session) return { ok: true, idle: true, cameraEnabled: false, micEnabled: false };
  activeSession = null;
  await Promise.allSettled([
    session.room.localParticipant.setCameraEnabled(false),
    session.room.localParticipant.setMicrophoneEnabled(false),
  ]);
  session.room.disconnect();
  return { ok: true, idle: true, cameraEnabled: false, micEnabled: false };
}

async function connectMedia(message) {
  const roomName = String(message.room || "");
  const serverUrl = String(message.serverUrl || "");
  const participantToken = String(message.participantToken || "");
  if (!roomName || !serverUrl || !participantToken) throw new Error("Missing camera connection details.");

  if (activeSession?.roomName === roomName) {
    activeSession.sessionId = Number(message.sessionId || activeSession.sessionId || 0);
    activeSession.tabId = Number(message.tabId || activeSession.tabId || 0);
    return { ok: true, idle: false, ...mediaState() };
  }

  if (activeSession) await disconnectMedia();
  const room = new Room({ adaptiveStream: false, dynacast: true });
  const session = {
    room,
    roomName,
    sessionId: Number(message.sessionId || 0),
    tabId: Number(message.tabId || 0),
  };
  activeSession = session;
  bindRoomEvents(session);
  try {
    await room.connect(serverUrl, participantToken, { autoSubscribe: false });
  } catch (error) {
    if (activeSession === session) activeSession = null;
    room.disconnect();
    throw error;
  }
  if (activeSession !== session) throw new Error("Camera session was replaced before it connected.");
  send("bpl-media-connected", mediaState(session));
  return { ok: true, idle: false, ...mediaState(session) };
}

async function toggleCamera(message) {
  if (!activeSession) throw new Error("Camera room is not connected.");
  await activeSession.room.localParticipant.setCameraEnabled(Boolean(message.enabled), cameraCapture, cameraPublish);
  const state = mediaState();
  send("bpl-media-track", { source: Track.Source.Camera, active: state.cameraEnabled, ...state });
  if (!state.cameraEnabled && !state.micEnabled) return disconnectMedia();
  return { ok: true, idle: false, ...state };
}

async function toggleMicrophone(message) {
  if (!activeSession) throw new Error("Microphone room is not connected.");
  await activeSession.room.localParticipant.setMicrophoneEnabled(Boolean(message.enabled), microphoneCapture);
  const state = mediaState();
  send("bpl-media-track", { source: Track.Source.Microphone, active: state.micEnabled, ...state });
  if (!state.cameraEnabled && !state.micEnabled) return disconnectMedia();
  return { ok: true, idle: false, ...state };
}

async function handleMessage(message) {
  if (message.type === "bpl-media-connect") return connectMedia(message);
  if (message.type === "bpl-media-camera") return toggleCamera(message);
  if (message.type === "bpl-media-mic") return toggleMicrophone(message);
  if (message.type === "bpl-media-disconnect") return disconnectMedia();
  return { ok: false, error: "Unknown media command." };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || !String(message.type || "").startsWith("bpl-media-")) return false;
  commandQueue = commandQueue
    .then(() => handleMessage(message))
    .then((result) => sendResponse(result || { ok: true }))
    .catch((error) => {
      const errorMessage = String(error?.message || error);
      send("bpl-media-error", { operation: message.type, error: errorMessage, ...mediaState() });
      sendResponse({ ok: false, error: errorMessage, ...mediaState() });
    });
  return true;
});
