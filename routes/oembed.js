const https = require("https");
const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  let { url: oembedUrl, type: oembedType } = req.query;

  if (oembedUrl) {
    oembedUrl = oembedUrl.trim();
  }

  if (!oembedUrl || !oembedType) {
    return res
      .status(400)
      .json({ error: "Missing url or type query parameter" });
  }

  let targetOembedUrl;

  if (oembedType === "bluesky") {
    targetOembedUrl = `https://embed.bsky.app/oembed?url=${encodeURIComponent(
      oembedUrl
    )}`;
  } else {
    return res.status(400).json({ error: "Unsupported oembedType" });
  }

  const oembedRequest = https.get(targetOembedUrl, (oembedRes) => {
    let rawData = "";
    oembedRes.on("data", (chunk) => {
      rawData += chunk;
    });

    oembedRes.on("end", () => {
      try {
        // The upstream response could be a success (2xx) or an error (4xx, 5xx).
        // We try to parse it as JSON in either case.
        const jsonData = JSON.parse(rawData);
        res.status(oembedRes.statusCode).json(jsonData);
      } catch (e) {
        // If the response isn't valid JSON, send it as plain text.
        // This can happen with some server errors that return HTML or plain text.
        res.status(oembedRes.statusCode || 500).send(rawData);
      }
    });
  });

  oembedRequest.on("error", (err) => {
    console.error("Error fetching oembed data:", err);
    res.status(500).json({
      error: "Failed to fetch oembed data",
      details: err.message,
    });
  });
});

module.exports = router;
