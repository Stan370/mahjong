import http from "node:http";

import express from "express";
import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import {
  allCharlestonSubmitted,
  allCharlestonVotesIn,
  allClaimsIn,
  canStart,
  createRoomState,
  createSnapshot,
  declareMahjong,
  discardTile,
  exchangeJoker,
  passClaim,
  resolveCharleston,
  resolveCharlestonVote,
  resolveClaims,
  startGame,
  submitCharlestonPass,
  submitCharlestonVote,
  submitClaim,
  takeSeat,
  toggleReady,
  upsertPlayer,
  // Bot AI
  botCharlestonPass,
  botCharlestonVote,
  botDecideClaim,
  botDecideDiscard,
  type FontScale,
  type RoomState,
  type SeatWind
} from "@mahjong/game-engine";
import type { TileCode } from "@mahjong/american-card";
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
    type: z.literal("submitCharlestonPass"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      tileCodes: z.array(z.string())
    })
  }),
  z.object({
    type: z.literal("submitCharlestonVote"),
    payload: z.object({
      roomId: z.string(),
      playerId: z.string(),
      wantSecondRound: z.boolean()
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
/** Track which player IDs are bots (for auto-play) */
const botPlayerIds = new Set<string>();

const CLAIM_WINDOW_MS = 10_000;
const BOT_DELAY_MS = 1200;
const SEAT_ORDER: SeatWind[] = ["east", "south", "west", "north"];

// --- Bot helper: find seat for a player id ---

function findBotSeatWind(room: RoomState, botId: string): SeatWind | undefined {
  return SEAT_ORDER.find((w) => room.seats[w].playerId === botId);
}

// --- Auto-resolve helpers ---

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

  // After resolving claims, if it's a bot's turn, schedule bot action
  if (room.game.phase === "awaiting-discard") {
    scheduleBotTurn(room);
  }
}

/** Schedule bot actions for the current turn if it's a bot */
async function scheduleBotTurn(room: RoomState) {
  if (!room.game || room.game.phase !== "awaiting-discard") return;
  const currentPlayerId = room.seats[room.game.currentTurn].playerId;
  if (!currentPlayerId || !botPlayerIds.has(currentPlayerId)) return;

  setTimeout(async () => {
    const fresh = await liveState.getRoom(room.id);
    if (!fresh?.game || fresh.game.phase !== "awaiting-discard") return;
    if (fresh.seats[fresh.game.currentTurn].playerId !== currentPlayerId) return;

    const seatWind = fresh.game.currentTurn;
    const hand = fresh.game.players[seatWind].concealedTiles;
    const exposed = fresh.game.players[seatWind].exposedMelds;
    const action = botDecideDiscard(hand, exposed);

    if (action.type === "mahjong") {
      declareMahjong(fresh, currentPlayerId);
      await persistence.updateRoomStatus(fresh.id, "finished");
      await persistence.saveHandSummary({
        roomId: fresh.id,
        winnerProfileId: currentPlayerId,
        outcome: fresh.game.result?.status === "mahjong" ? "mahjong" : "invalid",
        matchedPatternId: fresh.game.result?.patternId,
        summaryJson: JSON.stringify(fresh.game.result ?? {})
      });
    } else {
      discardTile(fresh, currentPlayerId, action.tileCode);
      // Start claim window — bots will respond
      claimTimers.set(fresh.id, setTimeout(() => autoResolveClaims(fresh.id), CLAIM_WINDOW_MS));
      scheduleBotClaimResponses(fresh);
    }

    await liveState.saveRoom(fresh);
    await broadcastRoom(fresh.id);
  }, BOT_DELAY_MS);
}

/** All bots in the room auto-respond to claim windows */
async function scheduleBotClaimResponses(room: RoomState) {
  if (!room.game?.claimWindow) return;

  const discarder = room.game.claimWindow.discardedBy;

  for (const wind of SEAT_ORDER) {
    if (wind === discarder) continue;
    const pid = room.seats[wind].playerId;
    if (!pid || !botPlayerIds.has(pid)) continue;

    setTimeout(async () => {
      const fresh = await liveState.getRoom(room.id);
      if (!fresh?.game?.claimWindow) return;
      // Already responded?
      if (wind in (fresh.game.claimWindow.claims ?? {})) return;

      const hand = fresh.game.players[wind].concealedTiles;
      const exposed = fresh.game.players[wind].exposedMelds;
      const discardedTile = fresh.game.claimWindow.discardedTile;
      const action = botDecideClaim(hand, exposed, discardedTile);

      if (action.type === "claim") {
        submitClaim(fresh, pid, action.claimType);
      } else {
        passClaim(fresh, pid);
      }

      await liveState.saveRoom(fresh);

      if (allClaimsIn(fresh)) {
        clearTimeout(claimTimers.get(fresh.id));
        claimTimers.delete(fresh.id);
        await autoResolveClaims(fresh.id);
      } else {
        await broadcastRoom(fresh.id);
      }
    }, BOT_DELAY_MS + Math.random() * 500);
  }
}

/** Bots submit charleston passes — sequential to avoid race conditions */
async function scheduleBotCharlestonPasses(room: RoomState) {
  if (!room.game || room.game.phase !== "charleston" || !room.game.charleston) return;
  const savedRoomId = room.id;

  setTimeout(async () => {
    const fresh = await liveState.getRoom(savedRoomId);
    if (!fresh?.game?.charleston || fresh.game.phase !== "charleston") return;

    // Submit all bot passes sequentially on fresh state
    for (const wind of SEAT_ORDER) {
      const pid = fresh.seats[wind].playerId;
      if (!pid || !botPlayerIds.has(pid)) continue;
      if (fresh.game.charleston!.submissions[wind]) continue;

      const hand = fresh.game.players[wind].concealedTiles;
      const exposed = fresh.game.players[wind].exposedMelds;
      const passAction = botCharlestonPass(hand, exposed, 3);

      try {
        submitCharlestonPass(fresh, pid, passAction.tileCodes);
      } catch {
        // If validation fails, pass fewer tiles (courtesy pass allows 0-3)
        try { submitCharlestonPass(fresh, pid, passAction.tileCodes.slice(0, 2)); } catch {
          try { submitCharlestonPass(fresh, pid, []); } catch { /* skip */ }
        }
      }
    }

    await liveState.saveRoom(fresh);

    if (allCharlestonSubmitted(fresh)) {
      resolveCharleston(fresh);
      await liveState.saveRoom(fresh);
      await broadcastRoom(fresh.id);
      // Continue with next charleston step or game
      if (fresh.game.phase === "charleston") {
        scheduleBotCharlestonPasses(fresh);
      } else if (fresh.game.phase === "charleston-vote") {
        scheduleBotCharlestonVotes(fresh);
      } else if (fresh.game.phase === "awaiting-discard") {
        scheduleBotTurn(fresh);
      }
    } else {
      await broadcastRoom(fresh.id);
    }
  }, BOT_DELAY_MS);
}

/** Bots submit charleston round 2 votes — sequential */
async function scheduleBotCharlestonVotes(room: RoomState) {
  if (!room.game || room.game.phase !== "charleston-vote" || !room.game.charleston?.voting) return;
  const savedRoomId = room.id;

  setTimeout(async () => {
    const fresh = await liveState.getRoom(savedRoomId);
    if (!fresh?.game?.charleston?.voting || fresh.game.phase !== "charleston-vote") return;

    for (const wind of SEAT_ORDER) {
      const pid = fresh.seats[wind].playerId;
      if (!pid || !botPlayerIds.has(pid)) continue;
      if (fresh.game.charleston!.votes?.[wind] !== undefined) continue;

      const hand = fresh.game.players[wind].concealedTiles;
      const exposed = fresh.game.players[wind].exposedMelds;
      const vote = botCharlestonVote(hand, exposed);
      submitCharlestonVote(fresh, pid, vote.wantSecondRound);
    }

    await liveState.saveRoom(fresh);

    if (allCharlestonVotesIn(fresh)) {
      resolveCharlestonVote(fresh);
      await liveState.saveRoom(fresh);
      await broadcastRoom(fresh.id);

      if (fresh.game.phase === "charleston") {
        scheduleBotCharlestonPasses(fresh);
      } else if (fresh.game.phase === "awaiting-discard") {
        scheduleBotTurn(fresh);
      }
    } else {
      await broadcastRoom(fresh.id);
    }
  }, BOT_DELAY_MS);
}

// --- Express app ---

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

/** Quick Play: creates a room with 3 bot opponents, auto-starts */
app.post("/api/quickplay", async (request, response) => {
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

  // Add 3 bots
  const botNames = ["Bot Linda", "Bot Susan", "Bot Karen"];
  const botWinds: SeatWind[] = ["south", "west", "north"];
  const botIds: string[] = [];

  for (let i = 0; i < 3; i++) {
    const botId = `bot-${nanoid(8)}`;
    botIds.push(botId);
    botPlayerIds.add(botId);
    room.players[botId] = { id: botId, name: botNames[i], fontScale: "M" };
    takeSeat(room, botId, botWinds[i]);
    room.seats[botWinds[i]].ready = true;
  }

  // Ready up the human too
  room.seats.east.ready = true;

  // Start game
  startGame(room);
  await liveState.saveRoom(room);
  await persistence.createRoom({
    id: roomId,
    hostProfileId: guestId,
    inviteCode,
    status: "playing"
  });

  response.status(201).json({
    roomId,
    inviteCode,
    guestId,
    wsUrl: process.env.PUBLIC_WS_URL ?? "ws://localhost:8787"
  });

  // Schedule bot actions for charleston or game
  if (room.game?.phase === "charleston") {
    scheduleBotCharlestonPasses(room);
  } else if (room.game?.phase === "awaiting-discard") {
    scheduleBotTurn(room);
  }
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
          // Schedule bot charleston if applicable
          if (room.game?.phase === "charleston") {
            scheduleBotCharlestonPasses(room);
          } else if (room.game?.phase === "awaiting-discard") {
            scheduleBotTurn(room);
          }
          break;
        case "submitCharlestonPass": {
          submitCharlestonPass(room, parsed.payload.playerId, parsed.payload.tileCodes as TileCode[]);
          await liveState.saveRoom(room);
          if (allCharlestonSubmitted(room)) {
            resolveCharleston(room);
            await liveState.saveRoom(room);
            await broadcastRoom(room.id);
            if (room.game?.phase === "charleston") {
              scheduleBotCharlestonPasses(room);
            } else if (room.game?.phase === "charleston-vote") {
              scheduleBotCharlestonVotes(room);
            } else if (room.game?.phase === "awaiting-discard") {
              scheduleBotTurn(room);
            }
          } else {
            await broadcastRoom(room.id);
          }
          break;
        }
        case "submitCharlestonVote": {
          submitCharlestonVote(room, parsed.payload.playerId, parsed.payload.wantSecondRound);
          await liveState.saveRoom(room);
          if (allCharlestonVotesIn(room)) {
            resolveCharlestonVote(room);
            await liveState.saveRoom(room);
            await broadcastRoom(room.id);
            if (room.game?.phase === "charleston") {
              scheduleBotCharlestonPasses(room);
            } else if (room.game?.phase === "awaiting-discard") {
              scheduleBotTurn(room);
            }
          } else {
            await broadcastRoom(room.id);
          }
          break;
        }
        case "discardTile":
          discardTile(room, parsed.payload.playerId, parsed.payload.tileCode as never);
          await liveState.saveRoom(room);
          await broadcastRoom(room.id);
          // Start claim window timeout
          claimTimers.set(room.id, setTimeout(() => autoResolveClaims(room.id), CLAIM_WINDOW_MS));
          // Bot claim responses
          scheduleBotClaimResponses(room);
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
