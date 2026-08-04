const { Room, RoomEvent, ScreenSharePresets, Track } = require("livekit-client");

(() => {
  if (globalThis.__basepaintLiveRoomsLiveKitBridge) return;
  globalThis.__basepaintLiveRoomsLiveKitBridge = true;

  const source = "basepaint-live-rooms";
  let activeSession = null;
  let commandQueue = Promise.resolve();
  let regionCapture = null;

  // Screen content needs enough pixels and bitrate to keep BasePaint/Aseprite UI
  // readable. When the uplink is constrained, preserve detail and sacrifice frames.
  const highQualityScreenCapture = {
    resolution: ScreenSharePresets.h1080fps30.resolution,
    contentHint: "detail",
  };
  const highQualityScreenPublish = {
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    simulcast: true,
    degradationPreference: "maintain-resolution",
  };

  function post(type, payload = {}) {
    window.postMessage({ source, type, ...payload }, "*");
  }

  function sessionPayload(session) {
    return {
      room: session?.roomName || "",
      role: session?.role || "",
      sessionId: session?.sessionId || 0,
    };
  }

  function sourceFor(publication, track) {
    return publication?.source || track?.source || Track.Source.Unknown;
  }

  function targetFor(sourceName) {
    if (sourceName === Track.Source.ScreenShare) return "bpl-media-video";
    if (sourceName === Track.Source.Camera) return "bpl-inline-camera";
    return "";
  }

  function attachToOneElement(track, element) {
    const attached = [...(track.attachedElements || [])];
    for (const current of attached) {
      if (current !== element) track.detach(current);
    }
    if (!attached.includes(element)) track.attach(element);
  }

  function attachVideo(track, sourceName, muted) {
    const elementId = targetFor(sourceName);
    const element = elementId ? document.getElementById(elementId) : null;
    if (!element) return false;
    attachToOneElement(track, element);
    element.autoplay = true;
    element.playsInline = true;
    element.muted = Boolean(muted);
    element.style.display = "block";
    element.play?.().catch(() => {});
    return true;
  }

  function attachAudio(track, participantId) {
    const id = `bpl-live-audio-${String(participantId || "guest").replace(/[^a-z0-9_-]/gi, "")}`;
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement("audio");
      element.id = id;
      element.autoplay = true;
      element.playsInline = true;
      element.style.display = "none";
      document.body.append(element);
    }
    attachToOneElement(track, element);
    element.play?.().catch(() => {});
    return element;
  }

  function announceTrack(session, sourceName, active, remote, participantId) {
    post("bpl-livekit-track", {
      ...sessionPayload(session),
      source: sourceName,
      active,
      remote,
      participantId: participantId || "",
    });
  }

  function announceSnapshot(session) {
    if (!session || activeSession !== session) return;
    let remoteScreenPublished = false;
    let remoteScreenSubscribed = false;
    let remoteCameraPublished = false;
    let remoteCameraSubscribed = false;
    for (const participant of session.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const sourceName = sourceFor(publication, publication.track);
        if (sourceName === Track.Source.ScreenShare) {
          remoteScreenPublished = true;
          remoteScreenSubscribed ||= Boolean(publication.track);
        }
        if (sourceName === Track.Source.Camera) {
          remoteCameraPublished = true;
          remoteCameraSubscribed ||= Boolean(publication.track);
        }
      }
    }
    post("bpl-livekit-snapshot", {
      ...sessionPayload(session),
      remoteParticipantCount: session.room.remoteParticipants.size,
      remoteScreenPublished,
      remoteScreenSubscribed,
      remoteCameraPublished,
      remoteCameraSubscribed,
    });
  }

  function attachRemotePublication(session, publication, participant) {
    if (!publication.isSubscribed) publication.setSubscribed(true);
    const track = publication.track;
    if (!track) return false;
    const sourceName = sourceFor(publication, track);
    // Audio is attached separately, so video stays muted to satisfy autoplay rules.
    if (track.kind === Track.Kind.Video) attachVideo(track, sourceName, true);
    if (track.kind === Track.Kind.Audio) attachAudio(track, participant.identity);
    announceTrack(session, sourceName, true, true, participant.identity);
    return true;
  }

  function reattachSession(session) {
    if (!session || activeSession !== session) return;
    const { room } = session;
    for (const publication of room.localParticipant.trackPublications.values()) {
      if (!publication.track) continue;
      const sourceName = sourceFor(publication, publication.track);
      // The broadcaster keeps painting unobstructed. Only their camera gets a local preview.
      if (publication.track.kind === Track.Kind.Video && sourceName === Track.Source.Camera) {
        attachVideo(publication.track, sourceName, true);
      }
      announceTrack(session, sourceName, true, false, room.localParticipant.identity);
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        attachRemotePublication(session, publication, participant);
      }
    }
    announceSnapshot(session);
  }

  function bindRoomEvents(session) {
    const { room } = session;
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (activeSession !== session) return;
      publication.setSubscribed(true);
      if (publication.track) attachRemotePublication(session, publication, participant);
      announceSnapshot(session);
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (activeSession !== session) return;
      const sourceName = sourceFor(publication, track);
      if (track.kind === Track.Kind.Video) attachVideo(track, sourceName, true);
      if (track.kind === Track.Kind.Audio) attachAudio(track, participant.identity);
      announceTrack(session, sourceName, true, true, participant.identity);
      announceSnapshot(session);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      track.detach();
      announceTrack(session, sourceFor(publication, track), false, true, participant.identity);
      announceSnapshot(session);
    });
    room.on(RoomEvent.ParticipantConnected, () => announceSnapshot(session));
    room.on(RoomEvent.ParticipantDisconnected, () => announceSnapshot(session));
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (activeSession !== session) return;
      const sourceName = sourceFor(publication, publication.track);
      if (publication.track?.kind === Track.Kind.Video && sourceName === Track.Source.Camera) {
        attachVideo(publication.track, sourceName, true);
      }
      announceTrack(session, sourceName, true, false, room.localParticipant.identity);
      announceSnapshot(session);
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      publication.track?.detach();
      announceTrack(session, sourceFor(publication, publication.track), false, false, room.localParticipant.identity);
      announceSnapshot(session);
    });
    room.on(RoomEvent.Reconnected, () => {
      if (activeSession !== session) return;
      post("bpl-livekit-connected", sessionPayload(session));
      reattachSession(session);
    });
    room.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant) => {
      if (activeSession !== session) return;
      post("bpl-livekit-error", {
        ...sessionPayload(session),
        operation: "remote-track-subscribe",
        error: `Unable to subscribe to ${participant?.identity || "artist"} track ${trackSid}.`,
      });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (activeSession === session) activeSession = null;
      post("bpl-livekit-disconnected", sessionPayload(session));
    });
  }

  async function connectRoom(payload) {
    const { room: roomName, serverUrl, participantToken, role } = payload || {};
    const sessionId = Number(payload?.sessionId || 0);
    if (!roomName || !serverUrl || !participantToken) throw new Error("Missing LiveKit connection details.");

    if (activeSession?.roomName === roomName && activeSession?.role === role) {
      activeSession.sessionId = sessionId;
      post("bpl-livekit-connected", sessionPayload(activeSession));
      reattachSession(activeSession);
      return;
    }

    if (activeSession) {
      const previous = activeSession;
      await stopRegionCapture(false);
      activeSession = null;
      previous.room.disconnect();
    }

    // The screen element starts hidden until the publication arrives. Adaptive stream
    // can pause that hidden element before the UI has a chance to reveal it.
    const room = new Room({ adaptiveStream: false, dynacast: true });
    const session = { room, roomName, role, sessionId };
    activeSession = session;
    bindRoomEvents(session);
    await room.connect(serverUrl, participantToken, { autoSubscribe: true });
    if (activeSession !== session) {
      room.disconnect();
      return;
    }
    post("bpl-livekit-connected", sessionPayload(session));
    reattachSession(session);
  }

  function currentRoom(roomName) {
    if (!activeSession) return null;
    if (roomName && activeSession.roomName !== roomName) return null;
    return activeSession.room;
  }

  async function toggleCamera(payload) {
    const room = currentRoom(payload?.room);
    if (!room) throw new Error("LiveKit room is not connected.");
    await room.localParticipant.setCameraEnabled(Boolean(payload.enabled));
  }

  async function toggleMicrophone(payload) {
    const room = currentRoom(payload?.room);
    if (!room) throw new Error("LiveKit room is not connected.");
    await room.localParticipant.setMicrophoneEnabled(Boolean(payload.enabled));
  }

  async function toggleScreen(payload) {
    const room = currentRoom(payload?.room);
    if (!room) throw new Error("LiveKit room is not connected.");
    if (payload.enabled) await stopRegionCapture();
    await room.localParticipant.setScreenShareEnabled(
      Boolean(payload.enabled),
      { audio: true, ...highQualityScreenCapture },
      highQualityScreenPublish,
    );
    if (!payload.enabled) await stopRegionCapture();
  }

  function waitForVideo(video) {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("The selected source did not provide a video preview."));
      }, 15000);
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("loadedmetadata", ready);
        video.removeEventListener("error", failed);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Unable to preview the selected source.")); };
      video.addEventListener("loadedmetadata", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
    });
  }

  function stopRegionFrameLoop(capture) {
    if (!capture?.frameHandle) return;
    if (capture.frameMode === "video" && capture.sourceVideo.cancelVideoFrameCallback) {
      capture.sourceVideo.cancelVideoFrameCallback(capture.frameHandle);
    } else {
      window.cancelAnimationFrame(capture.frameHandle);
    }
    capture.frameHandle = 0;
  }

  function drawRegionFrame(capture) {
    if (regionCapture !== capture || !capture.canvas || !capture.context) return;
    if (capture.sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const { sourceX, sourceY, sourceWidth, sourceHeight } = capture;
      capture.context.drawImage(
        capture.sourceVideo,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        capture.canvas.width,
        capture.canvas.height,
      );
    }
    if (capture.sourceVideo.requestVideoFrameCallback) {
      capture.frameMode = "video";
      capture.frameHandle = capture.sourceVideo.requestVideoFrameCallback(() => drawRegionFrame(capture));
    } else {
      capture.frameMode = "animation";
      capture.frameHandle = window.requestAnimationFrame(() => drawRegionFrame(capture));
    }
  }

  async function stopRegionCapture(announce = true) {
    const capture = regionCapture;
    if (!capture) return;
    regionCapture = null;
    stopRegionFrameLoop(capture);
    const room = capture.session?.room;
    for (const track of [capture.outputVideoTrack, capture.publishedAudioTrack]) {
      if (!track) continue;
      try { await room?.localParticipant.unpublishTrack(track, true); } catch {}
      try { track.stop(); } catch {}
    }
    capture.outputStream?.getTracks().forEach((track) => track.stop());
    capture.sourceStream?.getTracks().forEach((track) => track.stop());
    if (capture.sourceVideo) {
      capture.sourceVideo.pause?.();
      capture.sourceVideo.srcObject = null;
    }
    if (announce) post("bpl-livekit-region-stopped", sessionPayload(capture.session));
  }

  async function prepareRegionCapture(payload) {
    const room = currentRoom(payload?.room);
    if (!room || !activeSession) throw new Error("LiveKit room is not connected.");
    await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    await stopRegionCapture(false);
    const sourceVideo = document.getElementById("bpl-region-preview-video");
    if (!sourceVideo) throw new Error("The area selector is not available.");
    const sourceStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: true,
    });
    const capture = {
      session: activeSession,
      sourceStream,
      sourceVideo,
      canvas: null,
      context: null,
      outputStream: null,
      outputVideoTrack: null,
      publishedAudioTrack: null,
      frameHandle: 0,
      frameMode: "",
    };
    regionCapture = capture;
    sourceVideo.srcObject = sourceStream;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    await sourceVideo.play();
    await waitForVideo(sourceVideo);
    sourceStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (regionCapture === capture) stopRegionCapture().catch(() => {});
    }, { once: true });
    post("bpl-livekit-region-ready", {
      ...sessionPayload(activeSession),
      width: sourceVideo.videoWidth,
      height: sourceVideo.videoHeight,
    });
  }

  async function startRegionCapture(payload) {
    const capture = regionCapture;
    if (!capture || activeSession !== capture.session) throw new Error("Select a screen source before choosing an area.");
    const crop = payload?.crop || {};
    const x = Math.min(0.98, Math.max(0, Number(crop.x) || 0));
    const y = Math.min(0.98, Math.max(0, Number(crop.y) || 0));
    const width = Math.min(1 - x, Math.max(0.02, Number(crop.width) || 1));
    const height = Math.min(1 - y, Math.max(0.02, Number(crop.height) || 1));
    const sourceWidth = Math.max(2, Math.round(capture.sourceVideo.videoWidth * width));
    const sourceHeight = Math.max(2, Math.round(capture.sourceVideo.videoHeight * height));
    const outputScale = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(sourceWidth * outputScale));
    canvas.height = Math.max(2, Math.round(sourceHeight * outputScale));
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) throw new Error("Unable to create the selected-area video.");
    capture.canvas = canvas;
    capture.context = context;
    capture.sourceX = Math.round(capture.sourceVideo.videoWidth * x);
    capture.sourceY = Math.round(capture.sourceVideo.videoHeight * y);
    capture.sourceWidth = sourceWidth;
    capture.sourceHeight = sourceHeight;
    capture.outputStream = canvas.captureStream(30);
    capture.outputVideoTrack = capture.outputStream.getVideoTracks()[0];
    capture.outputVideoTrack.contentHint = "detail";
    drawRegionFrame(capture);
    try {
      await capture.session.room.localParticipant.publishTrack(capture.outputVideoTrack, {
        source: Track.Source.ScreenShare,
        name: "selected-area",
        stream: "screen",
        ...highQualityScreenPublish,
      });
      const sourceAudio = capture.sourceStream.getAudioTracks()[0];
      if (sourceAudio) {
        capture.publishedAudioTrack = sourceAudio;
        await capture.session.room.localParticipant.publishTrack(sourceAudio, {
          source: Track.Source.ScreenShareAudio,
          name: "selected-area-audio",
          stream: "screen",
        });
      }
    } catch (error) {
      await stopRegionCapture();
      throw error;
    }
    post("bpl-livekit-region-started", {
      ...sessionPayload(capture.session),
      width: canvas.width,
      height: canvas.height,
    });
  }

  async function handleLiveKitMessage(data) {
    if (data.type === "bpl-livekit-connect") return connectRoom(data);
    if (data.type === "bpl-livekit-camera") return toggleCamera(data);
    if (data.type === "bpl-livekit-mic") return toggleMicrophone(data);
    if (data.type === "bpl-livekit-screen") return toggleScreen(data);
    if (data.type === "bpl-livekit-region-prepare") return prepareRegionCapture(data);
    if (data.type === "bpl-livekit-region-start") return startRegionCapture(data);
    if (data.type === "bpl-livekit-region-cancel") return stopRegionCapture();
    if (data.type === "bpl-livekit-reattach") return reattachSession(activeSession);
    if (data.type === "bpl-livekit-disconnect") {
      if (!activeSession || (data.room && activeSession.roomName !== data.room)) return;
      const session = activeSession;
      await stopRegionCapture(false);
      activeSession = null;
      session.room.disconnect();
    }
  }

  function enqueueLiveKitMessage(data) {
    commandQueue = commandQueue
      .then(() => handleLiveKitMessage(data))
      .catch((error) => {
        post("bpl-livekit-error", {
          room: data.room || "",
          role: data.role || "",
          sessionId: Number(data.sessionId || 0),
          operation: data.type || "",
          error: String(error?.message || error),
        });
      });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== source) return;
    if (event.data?.type?.startsWith("bpl-livekit-")) enqueueLiveKitMessage(event.data);
  });
})();
