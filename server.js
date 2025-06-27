const WebSocket = require("ws");
// const https = require("https");
const http = require("http");
const express = require("express");
const cors = require("cors");
// const fs = require("fs");
const crypto = require("crypto");

const oembedRoutes = require("./routes/oembed");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/oembed", oembedRoutes);
app.get("/", (req, res) => {
  res.send("WebSocket server is running");
});

// HTTPS server for WSS
// const httpsOptions = {
//   key: fs.readFileSync("./certs/key.pem"),
//   cert: fs.readFileSync("./certs/cert.pem"),
// };
//
// const httpsServer = https.createServer(httpsOptions, (req, res) => {
//   res.writeHead(200, { "Content-Type": "text/plain" });
//   res.end("WebSocket Secure server is running");
// });

// HTTP server for WS
// const httpServer = http.createServer((req, res) => {
//   res.writeHead(200, { "Content-Type": "text/plain" });
//   res.end("WebSocket server is running");
// });

const httpServer = http.createServer(app);

// Create WebSocket servers
// const wss = new WebSocket.Server({ server: httpsServer });
const ws = new WebSocket.Server({ server: httpServer });

// In-memory stores
const sessions = new Map();
const users = new Map();
const streams = new Map();
const cardLocks = new Map();

// Mock data
const mockUsers = {
  user1: {
    id: "user1",
    email: "john@example.com",
    firstName: "John",
    lastName: "Doe",
    role: "author",
  },
  user2: {
    id: "user2",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Smith",
    role: "editor",
  },
};

const mockStreams = {
  stream1: {
    id: "stream1",
    title: "Breaking News Live",
    status: "active",
    cards: [
      {
        id: "card1",
        title: "Breaking News",
        content: { text: "Major event happening", format: "lexical" },
        status: "published",
        position: 0,
      },
      {
        id: "card2",
        title: "Updates",
        content: { text: "More details coming", format: "lexical" },
        status: "draft",
        position: 1,
      },
    ],
    activeUsers: new Map(),
  },
};

// Initialize mock data
Object.values(mockUsers).forEach((user) => users.set(user.id, user));
Object.values(mockStreams).forEach((stream) => streams.set(stream.id, stream));

// Handle connections for both servers
[ws].forEach((server) => {
  server.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", (message) => {
      console.log("Received message:", message);
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message);
      } catch (error) {
        sendError(ws, "INVALID_MESSAGE", "Malformed JSON message");
        return;
      }

      const { type, payload } = parsedMessage;
      console.log("Received:", type, payload);

      switch (type) {
        case "AUTH":
          handleAuth(ws, payload);
          break;
        case "PING":
          handlePing(ws, payload);
          break;
        case "STREAM_SUBSCRIBE":
          handleStreamSubscribe(ws, payload);
          break;
        case "STREAM_UNSUBSCRIBE":
          handleStreamUnsubscribe(ws, payload);
          break;
        case "CARD_LOCK_REQUEST":
          handleCardLockRequest(ws, payload);
          break;
        case "CARD_LOCK_RELEASE":
          handleCardLockRelease(ws, payload);
          break;
        case "CARD_LOCK_EXTEND":
          handleCardLockExtend(ws, payload);
          break;
        case "CARD_UPDATE_DRAFT":
          handleCardUpdateDraft(ws, payload);
          break;
        case "CARD_PUBLISH":
          handleCardPublish(ws, payload);
          break;
        case "CARD_CREATE":
          handleCardCreate(ws, payload);
          break;
        case "CARD_DELETE":
          handleCardDelete(ws, payload);
          break;
        case "DISCONNECT":
          handleDisconnect(ws, payload);
          break;
        default:
          sendError(
            ws,
            "UNKNOWN_MESSAGE_TYPE",
            `Unknown message type: ${type}`
          );
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      cleanupSession(ws);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
});

function handleAuth(ws, payload) {
  if (!payload?.token || !payload?.sessionId) {
    ws.send(
      JSON.stringify({
        type: "AUTH_ERROR",
        payload: {
          code: "INVALID_TOKEN",
          message: "Missing token or sessionId",
        },
      })
    );
    return;
  }

  // Mock authentication - in real app, validate JWT
  const userId = payload.token === "valid_token" ? "user1" : "user2";
  const user = users.get(userId);

  if (!user) {
    ws.send(
      JSON.stringify({
        type: "AUTH_ERROR",
        payload: { code: "INVALID_TOKEN", message: "Invalid token" },
      })
    );
    return;
  }

  sessions.set(payload.sessionId, {
    userId,
    ws,
    subscriptions: new Set(),
  });

  ws.send(
    JSON.stringify({
      type: "AUTH_SUCCESS",
      payload: {
        userId,
        sessionId: payload.sessionId,
        user,
      },
    })
  );
}

function handlePing(ws, payload) {
  ws.send(
    JSON.stringify({
      type: "PONG",
      payload: { timestamp: payload?.timestamp || Date.now() },
    })
  );
}

function handleStreamSubscribe(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) {
    sendError(ws, "UNAUTHORIZED", "Not authenticated");
    return;
  }

  const { streamId } = payload;
  const stream = streams.get(streamId);

  if (!stream) {
    ws.send(
      JSON.stringify({
        type: "STREAM_ERROR",
        payload: {
          streamId,
          code: "STREAM_NOT_FOUND",
          message: "Stream not found",
        },
      })
    );
    return;
  }

  session.subscriptions.add(streamId);
  const user = users.get(session.userId);
  stream.activeUsers.set(session.userId, {
    userId: session.userId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  ws.send(
    JSON.stringify({
      type: "STREAM_SUBSCRIBED",
      payload: {
        streamId,
        stream: {
          id: stream.id,
          title: stream.title,
          status: stream.status,
          cards: stream.cards,
          activeUsers: Array.from(stream.activeUsers.values()),
        },
      },
    })
  );

  broadcastToStream(
    streamId,
    {
      type: "USER_JOINED",
      payload: {
        streamId,
        user: {
          userId: session.userId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
    },
    ws
  );
}

function handleStreamUnsubscribe(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { streamId } = payload;
  session.subscriptions.delete(streamId);

  const stream = streams.get(streamId);
  if (stream) {
    stream.activeUsers.delete(session.userId);
    broadcastToStream(
      streamId,
      {
        type: "USER_LEFT",
        payload: { streamId, userId: session.userId },
      },
      ws
    );
  }

  ws.send(
    JSON.stringify({
      type: "STREAM_UNSUBSCRIBED",
      payload: { streamId },
    })
  );
}

function handleCardLockRequest(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) {
    sendError(ws, "UNAUTHORIZED", "Not authenticated");
    return;
  }

  const { cardId, streamId } = payload;
  const existingLock = cardLocks.get(cardId);

  if (existingLock && existingLock.expiresAt > Date.now()) {
    const lockedByUser = users.get(existingLock.userId);
    ws.send(
      JSON.stringify({
        type: "CARD_LOCK_DENIED",
        payload: {
          cardId,
          streamId,
          lockedBy: {
            userId: existingLock.userId,
            email: lockedByUser.email,
            firstName: lockedByUser.firstName,
            lastName: lockedByUser.lastName,
          },
          expiresAt: new Date(existingLock.expiresAt).toISOString(),
        },
      })
    );
    return;
  }

  const lockId = crypto.randomUUID();
  const expiresAt = Date.now() + 60000; // 1 minute

  cardLocks.set(cardId, {
    streamId,
    userId: session.userId,
    lockId,
    expiresAt,
  });

  ws.send(
    JSON.stringify({
      type: "CARD_LOCK_ACQUIRED",
      payload: {
        cardId,
        streamId,
        lockId,
        expiresAt: new Date(expiresAt).toISOString(),
      },
    })
  );

  const user = users.get(session.userId);
  broadcastToStream(
    streamId,
    {
      type: "CARD_LOCKED",
      payload: {
        cardId,
        streamId,
        lockedBy: {
          userId: session.userId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
    },
    ws
  );
}

function handleCardLockRelease(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { cardId, streamId } = payload;
  const lock = cardLocks.get(cardId);

  if (lock && lock.userId === session.userId) {
    cardLocks.delete(cardId);

    ws.send(
      JSON.stringify({
        type: "CARD_LOCK_RELEASED",
        payload: { cardId, streamId },
      })
    );

    broadcastToStream(
      streamId,
      {
        type: "CARD_UNLOCKED",
        payload: { cardId, streamId },
      },
      ws
    );
  }
}

function handleCardLockExtend(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { cardId, streamId, lockId } = payload;
  const lock = cardLocks.get(cardId);

  if (lock && lock.userId === session.userId && lock.lockId === lockId) {
    lock.expiresAt = Date.now() + 60000;

    ws.send(
      JSON.stringify({
        type: "CARD_LOCK_EXTENDED",
        payload: {
          cardId,
          streamId,
          lockId,
          expiresAt: new Date(lock.expiresAt).toISOString(),
        },
      })
    );
  }
}

function handleCardUpdateDraft(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { cardId, streamId, content } = payload;
  const stream = streams.get(streamId);

  if (stream) {
    const card = stream.cards.find((c) => c.id === cardId);
    if (card) {
      card.content = content;

      ws.send(
        JSON.stringify({
          type: "CARD_DRAFT_SAVED",
          payload: {
            cardId,
            streamId,
            version: Math.floor(Math.random() * 100),
          },
        })
      );

      const user = users.get(session.userId);
      broadcastToStream(
        streamId,
        {
          type: "CARD_UPDATED",
          payload: {
            cardId,
            streamId,
            card,
            editingUser: {
              userId: session.userId,
              email: user.email,
            },
            lastActivity: new Date().toISOString(),
          },
        },
        ws
      );
    }
  }
}

function handleCardPublish(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { cardId, streamId } = payload;
  const stream = streams.get(streamId);

  if (stream) {
    const card = stream.cards.find((c) => c.id === cardId);
    if (card) {
      card.status = "published";
      card.publishedAt = new Date().toISOString();
      card.author = users.get(session.userId);

      broadcastToStream(streamId, {
        type: "CARD_PUBLISHED",
        payload: {
          cardId,
          streamId,
          card,
        },
      });
    }
  }
}

function handleCardCreate(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { streamId, title, content } = payload;
  const stream = streams.get(streamId);

  if (stream) {
    const newCard = {
      id: crypto.randomUUID(),
      title,
      content,
      status: "draft",
      position: stream.cards.length,
      author: users.get(session.userId),
    };

    stream.cards.push(newCard);

    broadcastToStream(streamId, {
      type: "CARD_CREATED",
      payload: {
        streamId,
        card: newCard,
      },
    });
  }
}

function handleCardDelete(ws, payload) {
  const session = findSessionByWs(ws);
  if (!session) return;

  const { cardId, streamId } = payload;
  const stream = streams.get(streamId);

  if (stream) {
    stream.cards = stream.cards.filter((c) => c.id !== cardId);
    cardLocks.delete(cardId);

    broadcastToStream(streamId, {
      type: "CARD_DELETED",
      payload: { cardId, streamId },
    });
  }
}

function handleDisconnect(ws, payload) {
  cleanupSession(ws);
  ws.close();
}

function findSessionByWs(wsInstance) {
  for (const [sessionId, sessionData] of sessions.entries()) {
    if (sessionData.ws === wsInstance) {
      return { ...sessionData, sessionId };
    }
  }
  return null;
}

function cleanupSession(ws) {
  const session = findSessionByWs(ws);
  if (session) {
    session.subscriptions.forEach((streamId) => {
      const stream = streams.get(streamId);
      if (stream) {
        stream.activeUsers.delete(session.userId);
        broadcastToStream(
          streamId,
          {
            type: "USER_LEFT",
            payload: { streamId, userId: session.userId },
          },
          ws
        );
      }
    });
    sessions.delete(session.sessionId);
  }
}

function broadcastToStream(streamId, message, excludeWs) {
  const stream = streams.get(streamId);
  if (!stream) return;

  stream.activeUsers.forEach((userInfo, userId) => {
    const session = findSessionByUserId(userId);
    if (
      session &&
      session.ws !== excludeWs &&
      session.ws.readyState === WebSocket.OPEN
    ) {
      try {
        session.ws.send(JSON.stringify(message));
      } catch (e) {
        console.error(`Failed to send message to user ${userId}:`, e);
      }
    }
  });
}

function findSessionByUserId(userId) {
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      return session;
    }
  }
  return null;
}

function sendError(ws, code, message, details = {}) {
  ws.send(
    JSON.stringify({
      type: "ERROR",
      payload: {
        code,
        message,
        details,
        timestamp: new Date().toISOString(),
      },
    })
  );
}

const WS_PORT = 8080;

httpServer.listen(WS_PORT, () => {
  console.log(`WebSocket server listening on port ${WS_PORT}`);
});
