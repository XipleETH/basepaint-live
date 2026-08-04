const crypto = require("crypto");
const { AccessToken } = require("livekit-server-sdk");
const { createPublicClient, http, verifyMessage } = require("viem");
const { base } = require("viem/chains");

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ROOM_PATTERN = /^basepaint-day-(\d+)-(0x[a-f0-9]{40})$/i;
const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;
const BASEPAINT_BRUSH_ADDRESS = "0xD68fe5b53e7E1AbeB5A4d0A6660667791f39263a";
const BRUSH_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }],
}];
let baseClient;

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function send(response, status, payload) {
  response.status(status).json(payload);
}

function requestBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return {}; }
}

function signedMessage({ address, room, timestamp }) {
  return [
    "BasePaint Live sign-in",
    `Address: ${address}`,
    `Room: ${room}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

function validRoom(room) {
  return typeof room === "string" && ROOM_PATTERN.test(room);
}

function roomAddress(room) {
  return String(room || "").match(ROOM_PATTERN)?.[2]?.toLowerCase() || "";
}

function basePublicClient() {
  if (!baseClient) {
    baseClient = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });
  }
  return baseClient;
}

async function ownsBasePaintBrush(address) {
  const balance = await basePublicClient().readContract({
    address: BASEPAINT_BRUSH_ADDRESS,
    abi: BRUSH_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return balance > 0n;
}

module.exports = async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return send(response, 405, { error: "Use POST." });

  const { address, displayName, room, role, signature, timestamp } = requestBody(request);
  const normalizedAddress = String(address || "").toLowerCase();
  const normalizedRole = role === "transmitter" ? "transmitter" : "observer";

  if (!validRoom(room)) return send(response, 400, { error: "Invalid BasePaint room." });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return send(response, 503, { error: "LiveKit server variables are not configured." });
  }

  if (normalizedRole === "transmitter") {
    const numericTimestamp = Number(timestamp);
    if (!ADDRESS_PATTERN.test(normalizedAddress) || typeof signature !== "string" || !Number.isFinite(numericTimestamp)) {
      return send(response, 400, { error: "A wallet signature is required to transmit." });
    }
    if (Math.abs(Date.now() - numericTimestamp) > MAX_CLOCK_SKEW_MS) {
      return send(response, 401, { error: "The wallet signature has expired." });
    }
    const message = signedMessage({ address: normalizedAddress, room, timestamp: numericTimestamp });
    try {
      const valid = await verifyMessage({ address: normalizedAddress, message, signature });
      if (!valid) return send(response, 401, { error: "Wallet signature rejected." });
    } catch {
      return send(response, 401, { error: "Wallet signature could not be verified." });
    }
    if (roomAddress(room) !== normalizedAddress) {
      return send(response, 403, { error: "The live room must match the connected BasePaint wallet." });
    }
    try {
      if (!await ownsBasePaintBrush(normalizedAddress)) {
        return send(response, 403, { code: "BRUSH_REQUIRED", error: "A BasePaint brush is required to go live." });
      }
    } catch (error) {
      return send(response, 503, {
        code: "BRUSH_CHECK_UNAVAILABLE",
        error: "BasePaint brush ownership could not be checked. Try again shortly.",
        detail: String(error?.message || error),
      });
    }
  }

  const identity = normalizedRole === "transmitter"
    ? `artist-${normalizedAddress.slice(2, 10)}`
    : `guest-${crypto.randomUUID()}`;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: displayName || (normalizedRole === "transmitter" ? normalizedAddress : "BasePaint guest"),
    metadata: JSON.stringify({
      role: normalizedRole,
      address: normalizedRole === "transmitter" ? normalizedAddress : null,
      brushVerified: normalizedRole === "transmitter",
    }),
  });
  token.addGrant({
    roomJoin: true,
    room,
    canSubscribe: true,
    canPublish: normalizedRole === "transmitter",
    canPublishData: true,
  });

  return send(response, 200, {
    serverUrl: process.env.LIVEKIT_URL,
    participantToken: await token.toJwt(),
    identity,
    role: normalizedRole,
  });
};
