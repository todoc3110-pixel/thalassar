const { timingSafeEqual } = require("node:crypto");

const NITRADO_API_BASE_URL = "https://api.nitrado.net";
const REDIS_STATE_PREFIX = "thalassar:gameserver-status:";
const REDIS_STARTED_AT_SUFFIX = ":started-at";

function secureEquals(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function readJsonResponse(response, name) {
  if (!response.ok) {
    throw new Error(`${name}_request_failed`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${name}_invalid_json`);
  }
}

async function redisCommand(url, token, command) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
  } catch {
    throw new Error("redis_request_failed");
  }

  const result = await readJsonResponse(response, "redis");
  if (result.error) {
    throw new Error("redis_command_failed");
  }
  return result.result;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];

  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(" ");
}

function safeText(value, maxLength = 80) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function formatStatusReport({ status, previousStatus, region, report, uptimeSeconds }) {
  const online = status === "started";
  const liveReport = online ? report : null;
  const lines = [
    `${online ? "🟢" : "🔴"} **Thalassar — servidor ${online ? "encendido" : "apagado"}**`,
  ];

  if (previousStatus && previousStatus !== status) {
    lines.push(
      `Cambio detectado: ${previousStatus === "started" ? "encendido" : "apagado"} → ${online ? "encendido" : "apagado"}`,
    );
  }

  const ping =
    Number.isFinite(liveReport?.pingMs) && liveReport.pingMs >= 0
      ? `${Math.round(liveReport.pingMs)} ms`
      : "No disponible";
  const playerCount =
    Number.isInteger(liveReport?.playerCount) && liveReport.playerCount >= 0
      ? String(liveReport.playerCount)
      : "No disponible";
  const maxPlayers =
    Number.isInteger(liveReport?.maxPlayers) && liveReport.maxPlayers >= 0
      ? String(liveReport.maxPlayers)
      : "No disponible";
  const map = safeText(liveReport?.mapName, 60) || "No disponible";
  const safeRegion = safeText(region, 30) || "No disponible";

  lines.push(`Ping: ${ping} | Jugadores: ${playerCount}/${maxPlayers}`);
  lines.push(`Región: ${safeRegion} | Mapa: ${map}`);
  lines.push(
    `Tiempo activo: ${online && Number.isFinite(uptimeSeconds) ? formatDuration(uptimeSeconds) : "No disponible"}`,
  );

  if (Array.isArray(liveReport?.players)) {
    const players = liveReport.players
      .filter(
        (player) =>
          player &&
          typeof player.name === "string" &&
          Number.isFinite(player.durationSeconds) &&
          player.durationSeconds >= 0,
      )
      .slice(0, 40);
    lines.push("Tiempo conectado por jugador:");
    if (players.length === 0) {
      lines.push("• No hay jugadores conectados");
    } else {
      for (const player of players) {
        const name = safeText(player.name, 48);
        if (name) {
          lines.push(
            `• ${name}: ${formatDuration(player.durationSeconds)}`,
          );
        }
      }
    }
  } else {
    lines.push("Tiempo conectado por jugador: No disponible");
  }

  const content = lines.join("\n");
  return content.length <= 1900 ? content : `${content.slice(0, 1897)}...`;
}

module.exports = async function serverStatus(req, res) {
  const redisUrl =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    if (!redisUrl || !redisToken || !process.env.NITRADO_SERVICE_ID) {
      return res.status(503).json({ status: null });
    }

    try {
      const status = await redisCommand(
        redisUrl,
        redisToken,
        ["GET", `${REDIS_STATE_PREFIX}${process.env.NITRADO_SERVICE_ID}`],
      );
      if (status !== null && status !== "started" && status !== "stopped") {
        throw new Error("redis_state_invalid");
      }
      return res.status(200).json({ status });
    } catch (error) {
      const code = error instanceof Error ? error.message : "redis_read_failed";
      console.error("Public server status read failed:", code);
      return res.status(502).json({ status: null });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expectedSecret = process.env.MONITOR_SECRET;
  const authorization = req.headers.authorization || "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (
    !expectedSecret ||
    !suppliedSecret ||
    !secureEquals(suppliedSecret, expectedSecret)
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const requiredVariables = [
    "NITRADO_API_TOKEN",
    "NITRADO_SERVICE_ID",
    "DISCORD_WEBHOOK_URL",
  ];
  const missingVariables = requiredVariables.filter(
    (name) => !process.env[name],
  );
  if (!redisUrl) {
    missingVariables.push("KV_REST_API_URL or UPSTASH_REDIS_REST_URL");
  }
  if (!redisToken) {
    missingVariables.push(
      "KV_REST_API_TOKEN or UPSTASH_REDIS_REST_TOKEN",
    );
  }
  if (missingVariables.length > 0) {
    return res.status(500).json({
      error: "Missing environment variables",
      variables: missingVariables,
    });
  }

  const serviceId = process.env.NITRADO_SERVICE_ID;
  const stateKey = `${REDIS_STATE_PREFIX}${serviceId}`;

  try {
    let nitradoResponse;
    try {
      nitradoResponse = await fetch(
        `${NITRADO_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/gameservers`,
        {
          headers: {
            Authorization: `Bearer ${process.env.NITRADO_API_TOKEN}`,
            Accept: "application/json",
          },
        },
      );
    } catch {
      throw new Error("nitrado_request_failed");
    }

    const nitradoData = await readJsonResponse(nitradoResponse, "nitrado");
    const status = nitradoData.data?.gameserver?.status;
    if (
      nitradoData.status !== "success" ||
      (status !== "started" && status !== "stopped")
    ) {
      throw new Error("nitrado_status_unavailable");
    }

    const previousStatus = await redisCommand(
      redisUrl,
      redisToken,
      ["GET", stateKey],
    );
    if (
      previousStatus !== null &&
      previousStatus !== "started" &&
      previousStatus !== "stopped"
    ) {
      throw new Error("redis_state_invalid");
    }

    const statusChanged =
      (previousStatus === "stopped" && status === "started") ||
      (previousStatus === "started" && status === "stopped");
    const startedAtKey = `${stateKey}${REDIS_STARTED_AT_SUFFIX}`;
    let startedAt = await redisCommand(redisUrl, redisToken, [
      "GET",
      startedAtKey,
    ]);

    if (status === "started" && !startedAt) {
      startedAt = String(Math.floor(Date.now() / 1000));
    }

    const report =
      req.body && typeof req.body === "object" ? req.body.report : null;
    const region = nitradoData.data?.gameserver?.location;
    const uptimeSeconds =
      status === "started" && Number.isFinite(Number(startedAt))
        ? Math.max(0, Math.floor(Date.now() / 1000) - Number(startedAt))
        : null;
    const message = formatStatusReport({
      status,
      previousStatus,
      region,
      report,
      uptimeSeconds,
    });

    let discordResponse;
    try {
      discordResponse = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: message,
          allowed_mentions: { parse: [] },
        }),
      });
    } catch {
      throw new Error("discord_request_failed");
    }
    if (!discordResponse.ok) {
      throw new Error("discord_request_failed");
    }

    await redisCommand(
      redisUrl,
      redisToken,
      ["SET", stateKey, status],
    );
    if (status === "started") {
      await redisCommand(redisUrl, redisToken, [
        "SET",
        startedAtKey,
        startedAt,
      ]);
    } else {
      await redisCommand(redisUrl, redisToken, ["DEL", startedAtKey]);
    }

    return res.status(200).json({
      status,
      notificationSent: statusChanged,
      reportSent: true,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "monitor_failed";
    console.error("Server status monitor failed:", code);
    return res.status(502).json({ error: code });
  }
};
