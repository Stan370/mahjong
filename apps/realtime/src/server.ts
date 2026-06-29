import http from "node:http";

import express from "express";
import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import {
  allClaimsIn,
  canStart,
  createRoomState,
  createSnapshot,
  declareMahjong,
  discardTile,
  exchangeJoker,
  passClaim,
  resolveClaims,
  startGame,
  submitClaim,
  takeSeat,
  toggleReady,
  upsertPlayer,
  type FontScale,
  type RoomState,
  type SeatWind
} from "@mahjong/game-engine";
import { createPersistenceAdapter } from "@mahjong/db";

const createRoomSchema = z.object({
  name: z.string().min(1).max(40),
  fontScale: z.enum(["S", "M", "L"]).default("M")
});

const joinRoomSchema = createRoomSchema.extend({
  guestId: z.string().min(3).max(64).optional()
});

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joinRoom"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  }),
  z.object({
    type: z.literal("takeSeat"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      wind: z.enum(["east", "south", "west", "north"])
    })
  }),
  z.object({
    type: z.literal("toggleReady"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  }),
  z.object({
    type: z.literal("startGame"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  }),
  z.object({
    type: z.literal("discardTile"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      tileCode: z.string()
    })
  }),
  z.object({
    type: z.literal("submitClaim"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      claimType: z.enum(["pong", "kong", "mahjong"])
    })
  }),
  z.object({
    type: z.literal("passClaim"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  }),
  z.object({
    type: z.literal("exchangeJoker"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      targetWind: z.enum(["east", "south", "west", "north"]),
      meldIndex: z.number(),
      naturalTileCode: z.string()
    })
  }),
  z.object({
    type: z.literal("declareMahjong"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  }),
  z.object({
    type: z.literal("requestSnapshot"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string()
    })
  })
]);

interface LiveStateAdapter {
  getRoom(roomId: string): Promise<RoomState | undefined>;
  saveRoom(room: RoomState): Promise<void>;
}

type SocketWithPlayerId = WebSocket & { playerId?: string };

class InMemoryLiveStateAdapter implements LiveStateAdapter {
  private readonly rooms = new Map<string, RoomState>();

  async getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  async saveRoom(room: RoomState) {
    this.rooms.set(room.id, room);
  }
}

class RedisLiveStateAdapter implements LiveStateAdapter {
  constructor(private readonly redis: Redis) {}

  async getRoom(roomId: string) {
    const raw = await this.redis.get(`room:${roomId}`);
    return raw ? (JSON.parse(raw) as RoomState) : undefined;
  }

  async saveRoom(room: RoomState) {
    await this.redis.set(`room:${room.id}`, JSON.stringify(room), "EX", 60 * 60 * 4);
  }
}

function createLiveStateAdapter(): LiveStateAdapter {
  if (process.env.REDIS_URL) {
    return new RedisLiveStateAdapter(new Redis(process.env.REDIS_URL));
  }

  return new InMemoryLiveStateAdapter();
}

const persistence = createPersistenceAdapter();
const liveState = createLiveStateAdapter();
const socketsByRoom = new Map<string, Set<SocketWithPlayerId>>();
const claimTimers = new Map<string, ReturnType<typeof setTimeout>>();

const CLAIM_WINDOW_MS = 10_000;

async function autoResolveClaims(roomId: string) {
  const room = await liveState.getRoom(roomId);
  if (!room?.game?.claimWindow) return;
  resolveClaims(room);
  if (room.game.phase === "finished" && room.game.result) {
    await persistence.updateRoomStatus(room.id, "finished");
    await persistence.saveHandSummary({
      roomId: room.id,
      winnerProfileId: room.game.result.winnerId,
      outcome: room.game.result.status === "mahjong" ? "mahjong"
        : room.game.result.status === "wall-exhausted" ? "wall-exhausted" : "invalid",
      matchedPatternId: room.game.result.patternId,
      summaryJson: JSON.stringify(room.game.result)
    });
  }
  await liveState.saveRoom(room);
  await broadcastRoom(room.id);
}

const app = express();
app.use(express.json());
app.use((_, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (response.req.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.get("/health", (_, response) => {
  response.json({ ok: true });
});

app.post("/api/rooms", async (request, response) => {
  const payload = createRoomSchema.parse(request.body);
  const guestId = nanoid(12);
  const roomId = nanoid(10).toUpperCase();
  const inviteCode = roomId.slice(0, 6);

  await persistence.upsertGuestProfile({
    id: guestId,
    displayName: payload.name,
    fontScale: payload.fontScale
  });

  const room = createRoomState(roomId, {
    id: guestId,
    name: payload.name,
    fontScale: payload.fontScale
  });

  takeSeat(room, guestId, "east");
  await liveState.saveRoom(room);
  await persistence.createRoom({
    id: roomId,
    hostProfileId: guestId,
    inviteCode,
    status: "lobby"
  });

  response.status(201).json({
    roomId,
    inviteCode,
    guestId,
    wsUrl: process.env.PUBLIC_WS_URL ?? "ws://localhost:8787"
  });
});

app.post("/api/rooms/:roomId/join", async (request, response) => {
  const payload = joinRoomSchema.parse(request.body);
  const room = await liveState.getRoom(request.params.roomId);

  if (!room) {
    response.status(404).json({ message: "Room not found." });
    return;
  }

  const guestId = payload.guestId ?? nanoid(12);
  await persistence.upsertGuestProfile({
    id: guestId,
    displayName: payload.name,
    fontScale: payload.fontScale
  });

  upsertPlayer(room, {
    id: guestId,
    name: payload.name,
    fontScale: payload.fontScale
  });
  await liveState.saveRoom(room);

  response.json({
    roomId: room.id,
    guestId,
    wsUrl: process.env.PUBLIC_WS_URL ?? "ws://localhost:8787"
  });
});

app.get("/api/rooms/:roomId", async (request, response) => {
  const room = await liveState.getRoom(request.params.roomId);
  const playerId = typeof request.query.playerId === "string" ? request.query.playerId : "";

  if (!room) {
    response.status(404).json({ message: "Room not found." });
    return;
  }

  response.json(createSnapshot(room, playerId));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function roomSockets(roomId: string): Set<SocketWithPlayerId> {
  const existing = socketsByRoom.get(roomId);
  if (existing) {
    return existing;
  }

  const created = new Set<SocketWithPlayerId>();
  socketsByRoom.set(roomId, created);
  return created;
}

async function broadcastRoom(roomId: string) {
  const room = await liveState.getRoom(roomId);
  if (!room) {
    return;
  }

  const sockets = roomSockets(roomId);
  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }

    const playerId = socket.playerId;
    if (!playerId) {
      continue;
    }

    socket.send(
      JSON.stringify({
        type: "snapshot",
        payload: createSnapshot(room, playerId)
      })
    );
  }
}

wss.on("connection", (socket) => {
  const playerSocket = socket as SocketWithPlayerId;

  socket.on("message", async (message) => {
    try {
      const parsed = clientMessageSchema.parse(JSON.parse(message.toString()));
      const room = await liveState.getRoom(parsed.payload.roomId);

      if (!room) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Room not found." } }));
        return;
      }

      playerSocket.playerId = parsed.payload.playerId;
      roomSockets(room.id).add(playerSocket);

      switch (parsed.type) {
        case "joinRoom":
          socket.send(JSON.stringify({ type: "snapshot", payload: createSnapshot(room, parsed.payload.playerId) }));
          break;
        case "takeSeat":
          takeSeat(room, parsed.payload.playerId, parsed.payload.wind as SeatWind);
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          break;
        case "toggleReady":
          toggleReady(room, parsed.payload.playerId);
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          break;
        case "startGame":
          if (parsed.payload.playerId !== room.hostId) {
            throw new Error("Only the host can start the game.");
          }
          if (!canStart(room)) {
            throw new Error("All seats must be filled and ready.");
          }
          startGame(room);
          await persistence.updateRoomStatus(room.id, "playing");
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          break;
        case "discardTile":
          discardTile(room, parsed.payload.playerId, parsed.payload.tileCode as never);
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          // Start claim window timeout
          claimTimers.set(room.id, setTimeout(() => autoResolveClaims(room.id), CLAIM_WINDOW_MS));
          break;
        case "submitClaim": {
          submitClaim(room, parsed.payload.playerId, parsed.payload.claimType as "pong" | "kong" | "mahjong");
          await liveState.saveRoom(room);
          if (allClaimsIn(room)) {
            clearTimeout(claimTimers.get(room.id));
            claimTimers.delete(room.id);
            await autoResolveClaims(room.id);
          } else {
            await broadcastRoom(room.id);
          }
          break;
        }
        case "passClaim": {
          passClaim(room, parsed.payload.playerId);
          await liveState.saveRoom(room);
          if (allClaimsIn(room)) {
            clearTimeout(claimTimers.get(room.id));
            claimTimers.delete(room.id);
            await autoResolveClaims(room.id);
          } else {
            await broadcastRoom(room.id);
          }
          break;
        }
        case "exchangeJoker":
          exchangeJoker(
            room,
            parsed.payload.playerId,
            parsed.payload.targetWind as SeatWind,
            parsed.payload.meldIndex,
            parsed.payload.naturalTileCode as never
          );
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          break;
        case "declareMahjong":
          declareMahjong(room, parsed.payload.playerId);
          await persistence.updateRoomStatus(room.id, "finished");
          await persistence.saveHandSummary({
            roomId: room.id,
            winnerProfileId: parsed.payload.playerId,
            outcome:
              room.game?.result?.status === "mahjong"
                ? "mahjong"
                : room.game?.result?.winnerId === "wall-exhausted"
                  ? "wall-exhausted"
                  : "invalid",
            matchedPatternId: room.game?.result?.patternId,
            summaryJson: JSON.stringify(room.game?.result ?? {})
          });
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          break;
        case "requestSnapshot":
          socket.send(JSON.stringify({ type: "snapshot", payload: createSnapshot(room, parsed.payload.playerId) }));
          break;
      }
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          payload: {
            message: error instanceof Error ? error.message : "Unexpected server error."
          }
        })
      );
    }
  });

  socket.on("close", () => {
    for (const sockets of socketsByRoom.values()) {
      sockets.delete(socket);
    }
  });
});

const port = Number(process.env.PORT ?? "8787");
server.listen(port, () => {
  console.log(`Realtime server listening on http://localhost:${port}`);
});
