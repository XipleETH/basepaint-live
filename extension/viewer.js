const { Room, RoomEvent, Track } = require("livekit-client");

(() => {
  const params = new URLSearchParams(window.location.search);
  const roomName = String(params.get("room") || "").toLowerCase();
  const artistName = String(params.get("artist") || "Artist screen").slice(0, 80);
  const apiBase = String(globalThis.__basepaintLiveConfig?.apiBase || "").replace(/\/+$/, "");
  const roomPattern = /^basepaint-day-\d+-0x[a-f0-9]{40}$/i;
  const video = document.getElementById("viewer-video");
  const audio = document.getElementById("viewer-audio-track");
  const placeholder = document.getElementById("viewer-placeholder");
  const status = document.getElementById("viewer-status");
  const audioButton = document.getElementById("viewer-audio");
  let room = null;
  let reconnectTimer = 0;
  let closing = false;

  document.getElementById("viewer-artist").textContent = artistName;
  document.getElementById("viewer-room").textContent = roomName
    ? `${roomName.slice(0, 24)}…${roomName.slice(-6)}`
    : "INVALID ROOM";

  function setStatus(label, mode = "") {
    status.textContent = label;
    status.className = mode;
  }

  function setVideoVisible(visible) {
    video.classList.toggle("is-live", visible);
    placeholder.classList.toggle("is-hidden", visible);
  }

  function attachOnce(track, element) {
    const attached = [...(track.attachedElements || [])];
    for (const current of attached) {
      if (current !== element) track.detach(current);
    }
    if (!attached.includes(element)) track.attach(element);
  }

  function attachPublication(publication) {
    if (!publication.isSubscribed) publication.setSubscribed(true);
    const track = publication.track;
    if (!track) return;
    const source = publication.source || track.source;
    if (track.kind === Track.Kind.Video && source === Track.Source.ScreenShare) {
      attachOnce(track, video);
      video.muted = true;
      video.play?.().catch(() => {});
      setVideoVisible(true);
      setStatus("SCREEN LIVE", "is-live");
    }
    if (track.kind === Track.Kind.Audio) {
      attachOnce(track, audio);
      audio.play?.().catch(() => setStatus("CLICK AUDIO", ""));
    }
  }

  function subscribeExisting() {
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) attachPublication(publication);
    }
  }

  function scheduleReconnect() {
    if (closing || reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      connect().catch(showError);
    }, 2500);
  }

  function showError(error) {
    setStatus(String(error?.message || error || "CONNECTION ERROR").slice(0, 80), "is-error");
    scheduleReconnect();
  }

  async function connect() {
    if (!apiBase || !roomPattern.test(roomName)) throw new Error("Invalid viewer configuration.");
    room?.disconnect();
    setStatus("CONNECTING", "");
    setVideoVisible(false);
    const response = await fetch(`${apiBase}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: roomName, role: "observer", displayName: "Pop-out viewer" }),
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(token.error || `Live API ${response.status}`);

    room = new Room({ adaptiveStream: false, dynacast: false });
    room.on(RoomEvent.TrackPublished, (publication) => {
      publication.setSubscribed(true);
      if (publication.track) attachPublication(publication);
    });
    room.on(RoomEvent.TrackSubscribed, (_track, publication) => attachPublication(publication));
    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      track.detach();
      if ((publication.source || track.source) === Track.Source.ScreenShare) {
        setVideoVisible(false);
        setStatus("WAITING FOR SCREEN", "");
      }
    });
    room.on(RoomEvent.Reconnected, () => {
      setStatus("CONNECTED", "");
      subscribeExisting();
    });
    room.on(RoomEvent.Disconnected, () => {
      setVideoVisible(false);
      setStatus("RECONNECTING", "");
      scheduleReconnect();
    });
    await room.connect(token.serverUrl, token.participantToken, { autoSubscribe: true });
    setStatus("WAITING FOR SCREEN", "");
    subscribeExisting();
  }

  audioButton.addEventListener("click", () => {
    audio.muted = !audio.muted;
    audioButton.textContent = audio.muted ? "AUDIO OFF" : "AUDIO ON";
    if (!audio.muted) audio.play?.().catch(() => {});
  });

  window.addEventListener("beforeunload", () => {
    closing = true;
    window.clearTimeout(reconnectTimer);
    room?.disconnect();
  });

  connect().catch(showError);
})();
