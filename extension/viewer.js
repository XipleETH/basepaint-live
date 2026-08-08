const { Room, RoomEvent, Track } = require("livekit-client");

(() => {
  const params = new URLSearchParams(window.location.search);
  const roomName = String(params.get("room") || "").toLowerCase();
  const artistName = String(params.get("artist") || "Artist stream").slice(0, 80);
  const apiBase = String(globalThis.__basepaintLiveConfig?.apiBase || "").replace(/\/+$/, "");
  const roomPattern = /^basepaint-day-\d+-0x[a-f0-9]{40}$/i;
  const screenVideo = document.getElementById("viewer-screen");
  const cameraVideo = document.getElementById("viewer-camera");
  const placeholder = document.getElementById("viewer-placeholder");
  const status = document.getElementById("viewer-status");
  const audioButton = document.getElementById("viewer-audio");
  let room = null;
  let reconnectTimer = 0;
  let closing = false;
  let audioEnabled = true;
  let audioNeedsGesture = false;

  document.getElementById("viewer-artist").textContent = artistName;
  document.getElementById("viewer-room").textContent = roomName
    ? `${roomName.slice(0, 24)}…${roomName.slice(-6)}`
    : "INVALID ROOM";

  function sourceFor(publication, track) {
    return publication?.source || track?.source || Track.Source.Unknown;
  }

  function setStatus(label, mode = "") {
    status.textContent = label;
    status.className = mode;
  }

  function attachOnce(track, element) {
    const attached = [...(track.attachedElements || [])];
    for (const current of attached) {
      if (current !== element) track.detach(current);
    }
    if (!attached.includes(element)) track.attach(element);
  }

  function audioElementId(participantId, sourceName) {
    const participant = String(participantId || "artist").replace(/[^a-z0-9_-]/gi, "");
    const sourceId = String(sourceName || "audio").replace(/[^a-z0-9_-]/gi, "");
    return `viewer-audio-${participant}-${sourceId}`;
  }

  function attachAudio(track, participantId, sourceName) {
    const id = audioElementId(participantId, sourceName);
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement("audio");
      element.id = id;
      element.className = "viewer-audio-track";
      element.autoplay = true;
      element.playsInline = true;
      element.style.display = "none";
      document.body.append(element);
    }
    attachOnce(track, element);
    element.muted = !audioEnabled;
    if (audioEnabled) {
      element.play?.().catch(() => {
        audioNeedsGesture = true;
        refreshMediaState();
      });
    }
  }

  function removeTrackElements(track) {
    const elements = [...(track?.attachedElements || [])];
    track?.detach();
    for (const element of elements) {
      if (element.classList?.contains("viewer-audio-track")) element.remove();
    }
  }

  function clearAudioElements() {
    document.querySelectorAll(".viewer-audio-track").forEach((element) => {
      element.pause?.();
      element.srcObject = null;
      element.remove();
    });
  }

  function activeMedia() {
    const media = { screen: false, camera: false, audio: false };
    if (!room) return media;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.isMuted || !publication.track) continue;
        const sourceName = sourceFor(publication, publication.track);
        if (sourceName === Track.Source.ScreenShare) media.screen = true;
        if (sourceName === Track.Source.Camera) media.camera = true;
        if (publication.track.kind === Track.Kind.Audio) media.audio = true;
      }
    }
    return media;
  }

  function refreshMediaState() {
    const media = activeMedia();
    screenVideo.classList.toggle("is-live", media.screen);
    cameraVideo.classList.toggle("is-live", media.camera);
    cameraVideo.classList.toggle("is-primary", media.camera && !media.screen);
    placeholder.classList.toggle("is-hidden", media.screen || media.camera);
    audioButton.textContent = audioEnabled ? "AUDIO ON" : "AUDIO OFF";

    if (audioNeedsGesture && media.audio && audioEnabled) return setStatus("CLICK AUDIO", "");
    if (media.screen && media.camera) return setStatus("SCREEN + CAMERA LIVE", "is-live");
    if (media.screen) return setStatus("SCREEN LIVE", "is-live");
    if (media.camera) return setStatus("CAMERA LIVE", "is-live");
    if (media.audio) return setStatus("MIC LIVE", "is-live");
    setStatus("WAITING FOR ARTIST", "");
  }

  function attachPublication(publication, participant) {
    if (!publication.isSubscribed) publication.setSubscribed(true);
    const track = publication.track;
    if (!track || publication.isMuted) return refreshMediaState();
    const sourceName = sourceFor(publication, track);
    if (track.kind === Track.Kind.Video && sourceName === Track.Source.ScreenShare) {
      attachOnce(track, screenVideo);
      screenVideo.muted = true;
      screenVideo.play?.().catch(() => {});
    }
    if (track.kind === Track.Kind.Video && sourceName === Track.Source.Camera) {
      attachOnce(track, cameraVideo);
      cameraVideo.muted = true;
      cameraVideo.play?.().catch(() => {});
    }
    if (track.kind === Track.Kind.Audio) attachAudio(track, participant?.identity, sourceName);
    refreshMediaState();
  }

  function subscribeExisting() {
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) attachPublication(publication, participant);
    }
    refreshMediaState();
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

  function bindRoomEvents(currentRoom) {
    currentRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
      publication.setSubscribed(true);
      if (publication.track) attachPublication(publication, participant);
    });
    currentRoom.on(RoomEvent.TrackSubscribed, (_track, publication, participant) => attachPublication(publication, participant));
    currentRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      removeTrackElements(track);
      refreshMediaState();
    });
    currentRoom.on(RoomEvent.TrackMuted, (publication) => {
      removeTrackElements(publication.track);
      refreshMediaState();
    });
    currentRoom.on(RoomEvent.TrackUnmuted, (publication, participant) => attachPublication(publication, participant));
    currentRoom.on(RoomEvent.ParticipantDisconnected, () => window.setTimeout(refreshMediaState, 0));
    currentRoom.on(RoomEvent.Reconnected, subscribeExisting);
    currentRoom.on(RoomEvent.Disconnected, () => {
      if (currentRoom !== room) return;
      clearAudioElements();
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
      refreshMediaState();
      if (closing) return;
      setStatus("RECONNECTING", "");
      scheduleReconnect();
    });
  }

  async function connect() {
    if (!apiBase || !roomPattern.test(roomName)) throw new Error("Invalid viewer configuration.");
    if (room) {
      const previousRoom = room;
      room = null;
      previousRoom.disconnect();
    }
    clearAudioElements();
    setStatus("CONNECTING", "");
    const response = await fetch(`${apiBase}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: roomName, role: "observer", displayName: "Pop-out viewer" }),
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(token.error || `Live API ${response.status}`);

    room = new Room({ adaptiveStream: false, dynacast: false });
    bindRoomEvents(room);
    await room.connect(token.serverUrl, token.participantToken, { autoSubscribe: true });
    subscribeExisting();
  }

  audioButton.addEventListener("click", async () => {
    const unlockingBlockedAudio = audioNeedsGesture && audioEnabled;
    if (!unlockingBlockedAudio) audioEnabled = !audioEnabled;
    audioNeedsGesture = false;
    const audioElements = [...document.querySelectorAll(".viewer-audio-track")];
    for (const element of audioElements) element.muted = !audioEnabled;
    if (audioEnabled) {
      const results = await Promise.allSettled(audioElements.map((element) => element.play?.()));
      audioNeedsGesture = results.some((result) => result.status === "rejected");
    }
    refreshMediaState();
  });

  window.addEventListener("beforeunload", () => {
    closing = true;
    window.clearTimeout(reconnectTimer);
    clearAudioElements();
    room?.disconnect();
  });

  connect().catch(showError);
})();
