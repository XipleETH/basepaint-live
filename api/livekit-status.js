const { RoomServiceClient, TrackSource } = require("livekit-server-sdk");

const ROOM_PATTERN = /^basepaint-day-(\d+)-(0x[a-f0-9]{40})$/i;
const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function send(response, status, payload) {
  response.status(status).json(payload);
}

function serviceClient() {
  const host = String(process.env.LIVEKIT_URL || "").replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  return new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

function participantMetadata(participant) {
  try {
    return JSON.parse(participant.metadata || "{}");
  } catch {}
  return {};
}

function participantRole(participant) {
  const metadata = participantMetadata(participant);
  if (metadata.role === "transmitter" || metadata.role === "observer") return metadata.role;
  return String(participant.identity || "").startsWith("artist-") ? "transmitter" : "observer";
}

function roomDetails(roomName) {
  const match = String(roomName || "").match(ROOM_PATTERN);
  if (!match) return null;
  return { day: Number(match[1]), address: match[2].toLowerCase() };
}

function verifiedTransmitter(participant, address) {
  const metadata = participantMetadata(participant);
  const participantAddress = String(metadata.address || "").toLowerCase();
  return participantRole(participant) === "transmitter"
    && metadata.brushVerified === true
    && ADDRESS_PATTERN.test(participantAddress)
    && participantAddress === address;
}

function activeTrack(participant, source) {
  return (participant.tracks || []).some((track) => track.source === source && !track.muted);
}

module.exports = async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return send(response, 405, { error: "Use GET." });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return send(response, 503, { error: "LiveKit server variables are not configured." });
  }

  const requestedRoom = String(request.query?.room || "").trim().toLowerCase();
  const requestedDayText = String(request.query?.day || "").trim();
  if (requestedRoom && !ROOM_PATTERN.test(requestedRoom)) {
    return send(response, 400, { error: "Invalid BasePaint room." });
  }
  if (!requestedRoom && requestedDayText && (!/^\d+$/.test(requestedDayText) || Number(requestedDayText) < 1)) {
    return send(response, 400, { error: "Invalid BasePaint day." });
  }

  try {
    const client = serviceClient();
    if (!requestedRoom) {
      const rooms = await client.listRooms();
      const requestedDay = requestedDayText ? Number(requestedDayText) : 0;
      const matchingRooms = rooms.filter((room) => {
        const details = roomDetails(room.name);
        return details
          && (!requestedDay || details.day === requestedDay)
          && Number(room.numPublishers || 0) > 0;
      });
      const liveArtists = (await Promise.all(matchingRooms.map(async (room) => {
        const details = roomDetails(room.name);
        const participants = await client.listParticipants(room.name).catch(() => []);
        const transmitters = participants.filter((participant) => verifiedTransmitter(participant, details.address));
        const observers = participants.filter((participant) => participantRole(participant) === "observer");
        const screenPublished = transmitters.some((participant) => activeTrack(participant, TrackSource.SCREEN_SHARE));
        const cameraPublished = transmitters.some((participant) => activeTrack(participant, TrackSource.CAMERA));
        const microphonePublished = transmitters.some((participant) => activeTrack(participant, TrackSource.MICROPHONE));
        if (!screenPublished && !cameraPublished && !microphonePublished) return null;
        const transmitter = transmitters[0];
        return {
          room: room.name,
          day: details.day,
          address: details.address,
          displayName: String(transmitter?.name || details.address).slice(0, 80),
          screenPublished,
          cameraPublished,
          microphonePublished,
          observerCount: observers.length,
        };
      }))).filter(Boolean);
      response.setHeader("Cache-Control", "public, max-age=0, s-maxage=4, stale-while-revalidate=2");
      return send(response, 200, {
        day: requestedDay || null,
        liveArtists,
        rooms: matchingRooms.map((room) => ({ room: room.name, participantCount: Number(room.numParticipants || 0) })),
      });
    }

    response.setHeader("Cache-Control", "no-store");
    const details = roomDetails(requestedRoom);
    const participants = await client.listParticipants(requestedRoom).catch(() => []);
    const transmitters = participants.filter((participant) => verifiedTransmitter(participant, details.address));
    const observers = participants.filter((participant) => participantRole(participant) === "observer");
    return send(response, 200, {
      room: requestedRoom,
      active: participants.length > 0,
      participantCount: participants.length,
      observerCount: observers.length,
      transmitterConnected: transmitters.length > 0,
      screenPublished: transmitters.some((participant) => activeTrack(participant, TrackSource.SCREEN_SHARE)),
      cameraPublished: transmitters.some((participant) => activeTrack(participant, TrackSource.CAMERA)),
      microphonePublished: transmitters.some((participant) => activeTrack(participant, TrackSource.MICROPHONE)),
    });
  } catch (error) {
    return send(response, 502, { error: "Unable to read LiveKit room state.", detail: String(error?.message || error) });
  }
};
