module.exports = function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.status(200).json({
    ok: true,
    service: "basepaint-live",
    livekitConfigured: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
  });
};
