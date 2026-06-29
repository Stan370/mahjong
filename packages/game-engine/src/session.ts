import { validateAmericanMahjongHand, type Tile, type TileCode } from "@mahjong/american-card";

export type FontScale = "S" | "M" | "L";
export type SeatWind = "east" | "south" | "west" | "north";

export interface PlayerProfile {
  id: string;
  name: string;
  fontScale: FontScale;
  connectionId?: string;
}

export interface PlayerSeat {
  wind: SeatWind;
  playerId?: string;
  ready: boolean;
}

export interface RoomState {
  id: string;
  hostId: string;
  players: Record<string, PlayerProfile>;
  seats: Record<SeatWind, PlayerSeat>;
  startedAt?: string;
  game?: GameState;
}

// --- New types for the real American Mahjong loop ---

export interface ExposedMeld {
  tiles: Tile[];
  meldType: "pair" | "pong" | "kong";
  claimedFrom?: SeatWind;
}

export interface ClaimIntent {
  type: "pong" | "kong" | "mahjong";
  playerId: string;
}

export interface ClaimWindow {
  discardedTile: Tile;
  discardedBy: SeatWind;
  claims: Partial<Record<SeatWind, ClaimIntent | null>>; // null = passed
  nextDrawWind: SeatWind;
}

export interface PlayerGameView {
  concealedTiles: Tile[];
  exposedMelds: ExposedMeld[];
}

export type GamePhase =
  | "lobby"
  | "awaiting-discard"
  | "claim-window"
  | "finished";

export interface GameState {
  deck: Tile[];
  currentTurn: SeatWind;
  discards: Tile[];
  players: Record<SeatWind, PlayerGameView>;
  phase: GamePhase;
  claimWindow?: ClaimWindow;
  result?: {
    winnerId: string;
    patternId?: string;
    status: "mahjong" | "invalid" | "wall-exhausted";
  };
}

export interface RoomSnapshot {
  roomId: string;
  hostId: string;
  seats: Record<SeatWind, PlayerSeat & { playerName?: string; fontScale?: FontScale }>;
  game?: {
    currentTurn: SeatWind;
    discards: Tile[];
    phase: GamePhase;
    wallCount: number;
    myTiles: Tile[];
    myExposedMelds: ExposedMeld[];
    exposedMelds: Record<SeatWind, ExposedMeld[]>;
    claimWindow?: { discardedTile: Tile; discardedBy: SeatWind };
    result?: GameState["result"];
  };
}

// --- Constants ---

const SEAT_ORDER: SeatWind[] = ["east", "south", "west", "north"];
const SUITS: Array<"bam" | "crak" | "dot"> = ["bam", "crak", "dot"];
const JOKER_SUIT = "joker";

// --- Helpers ---

function makeTile(code: TileCode): Tile {
  if (code.startsWith("bam-")) {
    return { code, suit: "bam", value: Number(code.split("-")[1]) };
  }
  if (code.startsWith("crak-")) {
    return { code, suit: "crak", value: Number(code.split("-")[1]) };
  }
  if (code.startsWith("dot-")) {
    return { code, suit: "dot", value: Number(code.split("-")[1]) };
  }
  if (code.startsWith("flower-")) {
    return { code, suit: "flower", value: Number(code.split("-")[1]) };
  }
  if (code.startsWith("joker-")) {
    return { code, suit: "joker", value: Number(code.split("-")[1]) };
  }
  if (code.startsWith("wind-")) {
    return { code, suit: "wind", value: code.replace("wind-", "") };
  }

  return { code, suit: "dragon", value: code.replace("dragon-", "") };
}

function buildDeck(): Tile[] {
  const tiles: Tile[] = [];

  for (const suit of SUITS) {
    for (let value = 1; value <= 9; value += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        tiles.push(makeTile(`${suit}-${value}` as TileCode));
      }
    }
  }

  for (const wind of ["east", "south", "west", "north"] as const) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push(makeTile(`wind-${wind}` as TileCode));
    }
  }

  for (const dragon of ["red", "green", "white"] as const) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push(makeTile(`dragon-${dragon}` as TileCode));
    }
  }

  for (let value = 1; value <= 8; value += 1) {
    tiles.push(makeTile(`flower-${value}` as TileCode));
  }

  for (let value = 1; value <= 8; value += 1) {
    tiles.push(makeTile(`joker-${value}` as TileCode));
  }

  return shuffle(tiles);
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function nextWind(wind: SeatWind): SeatWind {
  const idx = SEAT_ORDER.indexOf(wind);
  return SEAT_ORDER[(idx + 1) % SEAT_ORDER.length];
}

function findSeatWind(room: RoomState, playerId: string): SeatWind | undefined {
  return SEAT_ORDER.find((wind) => room.seats[wind].playerId === playerId);
}

function isJokerTile(tile: Tile): boolean {
  return tile.suit === JOKER_SUIT;
}

// --- Room management (unchanged) ---

export function createRoomState(roomId: string, host: PlayerProfile): RoomState {
  return {
    id: roomId,
    hostId: host.id,
    players: {
      [host.id]: host
    },
    seats: {
      east: { wind: "east", ready: false },
      south: { wind: "south", ready: false },
      west: { wind: "west", ready: false },
      north: { wind: "north", ready: false }
    }
  };
}

export function upsertPlayer(room: RoomState, player: PlayerProfile): RoomState {
  room.players[player.id] = player;
  return room;
}

export function takeSeat(room: RoomState, playerId: string, wind: SeatWind): RoomState {
  const existingSeat = SEAT_ORDER.find((seatWind) => room.seats[seatWind].playerId === playerId);
  if (existingSeat) {
    room.seats[existingSeat].playerId = undefined;
    room.seats[existingSeat].ready = false;
  }

  room.seats[wind].playerId = playerId;
  room.seats[wind].ready = false;
  return room;
}

export function toggleReady(room: RoomState, playerId: string): RoomState {
  const seatWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === playerId);
  if (!seatWind) {
    return room;
  }

  room.seats[seatWind].ready = !room.seats[seatWind].ready;
  return room;
}

export function canStart(room: RoomState): boolean {
  return SEAT_ORDER.every((wind) => room.seats[wind].playerId && room.seats[wind].ready);
}

// --- Game lifecycle ---

export function startGame(room: RoomState): RoomState {
  if (!canStart(room)) {
    throw new Error("All four seats must be occupied and ready before the hand can start.");
  }

  const deck = buildDeck();
  const players: Record<SeatWind, PlayerGameView> = {
    east: { concealedTiles: [], exposedMelds: [] },
    south: { concealedTiles: [], exposedMelds: [] },
    west: { concealedTiles: [], exposedMelds: [] },
    north: { concealedTiles: [], exposedMelds: [] }
  };

  for (const wind of SEAT_ORDER) {
    players[wind].concealedTiles = deck.splice(0, 13);
  }

  // East gets 14th tile (first turn advantage)
  players.east.concealedTiles.push(deck.shift() as Tile);

  room.game = {
    deck,
    currentTurn: "east",
    discards: [],
    players,
    phase: "awaiting-discard"
  };
  room.startedAt = new Date().toISOString();

  return room;
}

// --- Core action: discard ---

export function discardTile(room: RoomState, playerId: string, tileCode: TileCode): RoomState {
  if (!room.game || room.game.phase !== "awaiting-discard") {
    throw new Error("Cannot discard right now.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind || seatWind !== room.game.currentTurn) {
    throw new Error("It is not this player's turn.");
  }

  const hand = room.game.players[seatWind].concealedTiles;
  const tileIndex = hand.findIndex((tile) => tile.code === tileCode);
  if (tileIndex === -1) {
    throw new Error("Tile is not present in the concealed hand.");
  }

  const tile = hand[tileIndex];

  // American Mahjong rule: cannot discard jokers
  if (isJokerTile(tile)) {
    throw new Error("Jokers cannot be discarded in American Mahjong.");
  }

  hand.splice(tileIndex, 1);
  room.game.discards.push(tile);

  // Enter claim window so other players can pong/kong/mahjong
  room.game.phase = "claim-window";
  room.game.claimWindow = {
    discardedTile: tile,
    discardedBy: seatWind,
    claims: {},
    nextDrawWind: nextWind(seatWind)
  };

  return room;
}

// --- Core action: submit claim during claim window ---

export function submitClaim(
  room: RoomState,
  playerId: string,
  claimType: "pong" | "kong" | "mahjong"
): RoomState {
  if (!room.game || room.game.phase !== "claim-window" || !room.game.claimWindow) {
    throw new Error("No active claim window.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind) {
    throw new Error("Player must be seated.");
  }

  if (seatWind === room.game.claimWindow.discardedBy) {
    throw new Error("Cannot claim your own discard.");
  }

  // Validate the player actually has tiles to form the meld
  const hand = room.game.players[seatWind].concealedTiles;
  const discardedCode = room.game.claimWindow.discardedTile.code;

  if (claimType === "pong") {
    const matchCount = hand.filter((t) => t.code === discardedCode).length;
    const jokerCount = hand.filter((t) => isJokerTile(t)).length;
    if (matchCount + jokerCount < 2) {
      throw new Error("Not enough matching tiles or jokers to pong.");
    }
  } else if (claimType === "kong") {
    const matchCount = hand.filter((t) => t.code === discardedCode).length;
    const jokerCount = hand.filter((t) => isJokerTile(t)).length;
    if (matchCount + jokerCount < 3) {
      throw new Error("Not enough matching tiles or jokers to kong.");
    }
  }
  // mahjong claim validation happens at resolution

  room.game.claimWindow.claims[seatWind] = { type: claimType, playerId };

  return room;
}

// --- Core action: pass on claim ---

export function passClaim(room: RoomState, playerId: string): RoomState {
  if (!room.game || room.game.phase !== "claim-window" || !room.game.claimWindow) {
    throw new Error("No active claim window.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind) {
    throw new Error("Player must be seated.");
  }

  if (seatWind === room.game.claimWindow.discardedBy) {
    throw new Error("Discarder doesn't need to pass.");
  }

  room.game.claimWindow.claims[seatWind] = null;

  return room;
}

// --- Check if all non-discarder players have responded ---

export function allClaimsIn(room: RoomState): boolean {
  if (!room.game?.claimWindow) {
    return false;
  }

  const discarder = room.game.claimWindow.discardedBy;
  const respondents = SEAT_ORDER.filter((w) => w !== discarder);
  return respondents.every((w) => w in room.game!.claimWindow!.claims);
}

// --- Resolve claim window: pick winner or advance turn ---

const CLAIM_PRIORITY: Record<string, number> = { mahjong: 3, kong: 2, pong: 1 };

export function resolveClaims(room: RoomState): RoomState {
  if (!room.game || !room.game.claimWindow) {
    throw new Error("No claim window to resolve.");
  }

  const cw = room.game.claimWindow;

  // Find highest-priority claim
  let bestWind: SeatWind | undefined;
  let bestPriority = 0;

  for (const [wind, claim] of Object.entries(cw.claims)) {
    if (!claim) continue; // passed
    const priority = CLAIM_PRIORITY[claim.type] ?? 0;
    if (priority > bestPriority) {
      bestPriority = priority;
      bestWind = wind as SeatWind;
    }
  }

  room.game.claimWindow = undefined;

  if (!bestWind) {
    // No claims — next player draws from wall
    const drawnTile = room.game.deck.shift();
    if (!drawnTile) {
      room.game.phase = "finished";
      room.game.result = { winnerId: "wall-exhausted", status: "wall-exhausted" };
      return room;
    }

    room.game.players[cw.nextDrawWind].concealedTiles.push(drawnTile);
    room.game.currentTurn = cw.nextDrawWind;
    room.game.phase = "awaiting-discard";
    return room;
  }

  const claim = cw.claims[bestWind]!;
  const playerView = room.game.players[bestWind];

  if (claim.type === "mahjong") {
    // Add the discarded tile to their hand and validate
    playerView.concealedTiles.push(cw.discardedTile);
    // Remove from discard pile (it was claimed)
    const discardIdx = room.game.discards.findIndex((t) => t === cw.discardedTile);
    if (discardIdx !== -1) room.game.discards.splice(discardIdx, 1);

    const allTiles = [
      ...playerView.concealedTiles,
      ...playerView.exposedMelds.flatMap((m) => m.tiles)
    ];
    const result = validateAmericanMahjongHand(allTiles);

    room.game.phase = "finished";
    room.game.result = {
      winnerId: claim.playerId,
      patternId: result.bestMatch?.patternId,
      status: result.matched ? "mahjong" : "invalid"
    };
    return room;
  }

  // Pong or Kong — form the exposed meld
  const meldSize = claim.type === "pong" ? 2 : 3; // tiles from hand (discard is the +1)
  const meldTiles: Tile[] = [cw.discardedTile];

  // Remove from discard pile
  const discardIdx = room.game.discards.findIndex((t) => t === cw.discardedTile);
  if (discardIdx !== -1) room.game.discards.splice(discardIdx, 1);

  // Take matching natural tiles first, then jokers if needed
  let needed = meldSize;
  const hand = playerView.concealedTiles;

  // First pass: take natural matches
  for (let i = hand.length - 1; i >= 0 && needed > 0; i -= 1) {
    if (hand[i].code === cw.discardedTile.code) {
      meldTiles.push(hand.splice(i, 1)[0]);
      needed -= 1;
    }
  }

  // Second pass: fill remaining with jokers
  for (let i = hand.length - 1; i >= 0 && needed > 0; i -= 1) {
    if (isJokerTile(hand[i])) {
      meldTiles.push(hand.splice(i, 1)[0]);
      needed -= 1;
    }
  }

  playerView.exposedMelds.push({
    tiles: meldTiles,
    meldType: claim.type,
    claimedFrom: cw.discardedBy
  });

  // Claimer draws a tile (to have a discard) only if they need one
  // After claiming, the claimer should have N*3 concealed + exposed. They need to discard.
  // In American Mahjong, after a claim the claimer does NOT draw — they just discard.
  room.game.currentTurn = bestWind;
  room.game.phase = "awaiting-discard";

  return room;
}

// --- Core action: joker exchange ---

export function exchangeJoker(
  room: RoomState,
  playerId: string,
  targetWind: SeatWind,
  meldIndex: number,
  naturalTileCode: TileCode
): RoomState {
  if (!room.game || room.game.phase !== "awaiting-discard") {
    throw new Error("Can only exchange jokers on your turn before discarding.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind || seatWind !== room.game.currentTurn) {
    throw new Error("It is not this player's turn.");
  }

  if (seatWind === targetWind) {
    throw new Error("Cannot exchange jokers from your own melds.");
  }

  const targetMelds = room.game.players[targetWind].exposedMelds;
  if (meldIndex < 0 || meldIndex >= targetMelds.length) {
    throw new Error("Invalid meld index.");
  }

  const meld = targetMelds[meldIndex];
  const jokerIdx = meld.tiles.findIndex((t) => isJokerTile(t));
  if (jokerIdx === -1) {
    throw new Error("No joker in this meld to exchange.");
  }

  // Player must hold the natural tile
  const myHand = room.game.players[seatWind].concealedTiles;
  const myTileIdx = myHand.findIndex((t) => t.code === naturalTileCode);
  if (myTileIdx === -1) {
    throw new Error("You don't hold the required natural tile.");
  }

  // Perform the swap
  const jokerTile = meld.tiles[jokerIdx];
  const naturalTile = myHand[myTileIdx];

  meld.tiles[jokerIdx] = naturalTile;
  myHand[myTileIdx] = jokerTile;

  return room;
}

// --- Core action: declare mahjong (self-drawn) ---

export function declareMahjong(room: RoomState, playerId: string): RoomState {
  if (!room.game || room.game.phase !== "awaiting-discard") {
    throw new Error("Can only declare mahjong on your turn.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind || seatWind !== room.game.currentTurn) {
    throw new Error("It is not this player's turn.");
  }

  const allTiles = [
    ...room.game.players[seatWind].concealedTiles,
    ...room.game.players[seatWind].exposedMelds.flatMap((m) => m.tiles)
  ];
  const result = validateAmericanMahjongHand(allTiles);

  room.game.phase = "finished";
  room.game.result = {
    winnerId: playerId,
    patternId: result.bestMatch?.patternId,
    status: result.matched ? "mahjong" : "invalid"
  };

  return room;
}

// --- Snapshot (hides other players' tiles) ---

export function createSnapshot(room: RoomState, viewerId: string): RoomSnapshot {
  const seats = Object.fromEntries(
    SEAT_ORDER.map((wind) => {
      const seat = room.seats[wind];
      const player = seat.playerId ? room.players[seat.playerId] : undefined;
      return [
        wind,
        {
          ...seat,
          playerName: player?.name,
          fontScale: player?.fontScale
        }
      ];
    })
  ) as RoomSnapshot["seats"];

  const viewerWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === viewerId);

  return {
    roomId: room.id,
    hostId: room.hostId,
    seats,
    game: room.game
      ? {
          currentTurn: room.game.currentTurn,
          discards: room.game.discards,
          phase: room.game.phase,
          wallCount: room.game.deck.length,
          myTiles: viewerWind ? room.game.players[viewerWind].concealedTiles : [],
          myExposedMelds: viewerWind ? room.game.players[viewerWind].exposedMelds : [],
          exposedMelds: {
            east: room.game.players.east.exposedMelds,
            south: room.game.players.south.exposedMelds,
            west: room.game.players.west.exposedMelds,
            north: room.game.players.north.exposedMelds
          },
          claimWindow: room.game.claimWindow
            ? {
                discardedTile: room.game.claimWindow.discardedTile,
                discardedBy: room.game.claimWindow.discardedBy
              }
            : undefined,
          result: room.game.result
        }
      : undefined
  };
}
