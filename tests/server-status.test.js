const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const serverStatus = require("../api/server-status");

const environment = {
  MONITOR_SECRET: "test-monitor-secret",
  NITRADO_API_TOKEN: "test-nitrado-token",
  NITRADO_SERVICE_ID: "12345",
  DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
  KV_REST_API_URL: "https://redis.example",
  KV_REST_API_TOKEN: "test-redis-token",
};
const originalFetch = global.fetch;
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function createResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function mockMonitor({ serverStatus, initialState = null }) {
  Object.assign(process.env, environment);
  let storedState = initialState;
  let storedStartedAt = initialState === "started" ? "1" : null;
  const discordMessages = [];

  global.fetch = async (url, options = {}) => {
    if (url.startsWith("https://api.nitrado.net/")) {
      return createResponse({
        status: "success",
        data: {
          gameserver: {
            status: serverStatus,
            location: "DE",
          },
        },
      });
    }

    if (url === environment.KV_REST_API_URL) {
      const [command, key, value] = JSON.parse(options.body);
      if (command === "GET") {
        return createResponse({
          result: key.endsWith(":started-at") ? storedStartedAt : storedState,
        });
      }
      if (command === "SET") {
        if (key.endsWith(":started-at")) {
          storedStartedAt = value;
        } else {
          storedState = value;
        }
        return createResponse({ result: "OK" });
      }
      if (command === "DEL") {
        storedStartedAt = null;
        return createResponse({ result: 1 });
      }
    }

    if (url === environment.DISCORD_WEBHOOK_URL) {
      discordMessages.push(JSON.parse(options.body));
      return createResponse({}, true);
    }

    throw new Error("Unexpected request");
  };

  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader() {},
  };

  return {
    response,
    state: () => storedState,
    discordMessages: () => discordMessages,
    request: {
      method: "POST",
      headers: { authorization: `Bearer ${environment.MONITOR_SECRET}` },
      body: {
        report: {
          pingMs: 42,
          mapName: "Ragnarok",
          playerCount: 1,
          maxPlayers: 70,
          players: [{ name: "Survivor", durationSeconds: 3661 }],
        },
      },
    },
  };
}

test("initial poll records the current state without sending a notification", async () => {
  const monitor = mockMonitor({ serverStatus: "started" });

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.response.statusCode, 200);
  assert.equal(monitor.state(), "started");
  assert.equal(monitor.discordMessages().length, 1);
  assert.equal(monitor.response.body.notificationSent, false);
  assert.equal(monitor.response.body.reportSent, true);
  assert.match(monitor.discordMessages()[0].content, /servidor encendido/);
  assert.match(monitor.discordMessages()[0].content, /Ping: 42 ms/);
  assert.match(monitor.discordMessages()[0].content, /Jugadores: 1\/70/);
  assert.match(monitor.discordMessages()[0].content, /Región: DE/);
  assert.match(monitor.discordMessages()[0].content, /Mapa: Ragnarok/);
  assert.match(monitor.discordMessages()[0].content, /Survivor: 1 h 1 min/);
});

test("sends one notification when the server changes from stopped to started", async () => {
  const monitor = mockMonitor({
    serverStatus: "started",
    initialState: "stopped",
  });

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.response.statusCode, 200);
  assert.equal(monitor.state(), "started");
  assert.equal(monitor.discordMessages().length, 1);
  assert.match(monitor.discordMessages()[0].content, /Cambio detectado/);
  assert.equal(monitor.response.body.notificationSent, true);

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.discordMessages().length, 2);
  assert.equal(monitor.response.body.notificationSent, false);
});

test("sends one notification when the server changes from started to stopped", async () => {
  const monitor = mockMonitor({
    serverStatus: "stopped",
    initialState: "started",
  });

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.response.statusCode, 200);
  assert.equal(monitor.state(), "stopped");
  assert.equal(monitor.discordMessages().length, 1);
  assert.match(monitor.discordMessages()[0].content, /servidor apagado/);
  assert.equal(monitor.response.body.notificationSent, true);

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.discordMessages().length, 2);
  assert.equal(monitor.response.body.notificationSent, false);
});

test("rejects requests without the monitor secret before calling external services", async () => {
  const monitor = mockMonitor({ serverStatus: "started" });
  monitor.request.headers.authorization = "Bearer wrong-secret";

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.response.statusCode, 401);
  assert.deepEqual(monitor.discordMessages(), []);
});

test("public status endpoint returns only the stored server state", async () => {
  const monitor = mockMonitor({
    serverStatus: "started",
    initialState: "stopped",
  });
  monitor.request.method = "GET";
  monitor.request.headers = {};

  await serverStatus(monitor.request, monitor.response);

  assert.equal(monitor.response.statusCode, 200);
  assert.deepEqual(monitor.response.body, { status: "stopped" });
});
