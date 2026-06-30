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

export type CharlestonDirection = "right" | "across" | "left" | "courtesy";

export interface CharlestonState {
  direction: CharlestonDirection;
  step: number;
  round: 1 | 2;
  submissions: Partial<Record<SeatWind, TileCode[]>>;
  /** Voting sub-phase between round 1 and round 2 */
  voting?: boolean;
  votes?: Partial<Record<SeatWind, boolean>>;
}

export type GamePhase =
  | "lobby"
  | "charleston"
  | "charleston-vote"
  | "awaiting-discard"
  | "claim-window"
  | "finished";

export interface GameState {
  deck: Tile[];
  currentTurn: SeatWind;
  discards: Tile[];
  players: Record<SeatWind, PlayerGameView>;
  phase: GamePhase;
  charleston?: CharlestonState;
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
    charleston?: { direction: CharlestonDirection; step: number; round: 1 | 2; voting?: boolean };
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

export function startGame(room: RoomState, skipCharleston = false): RoomState {
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

  // During charleston everyone gets 13; East draws 14th after charleston
  for (const wind of SEAT_ORDER) {
    players[wind].concealedTiles = deck.splice(0, 13);
  }

  if (skipCharleston) {
    // Skip straight to play — East gets 14th tile
    players.east.concealedTiles.push(deck.shift() as Tile);
    room.game = {
      deck, currentTurn: "east", discards: [], players,
      phase: "awaiting-discard"
    };
  } else {
    room.game = {
      deck, currentTurn: "east", discards: [], players,
      phase: "charleston",
      charleston: { direction: "right", step: 1, round: 1, submissions: {} }
    };
  }

  room.startedAt = new Date().toISOString();
  return room;
}

// --- Charleston ---

const CHARLESTON_ROUND1: { direction: CharlestonDirection; required: number }[] = [
  { direction: "right", required: 3 },
  { direction: "across", required: 3 },
  { direction: "left", required: 0 },   // 0 means 0-3 tiles allowed
];

const CHARLESTON_ROUND2: { direction: CharlestonDirection; required: number }[] = [
  { direction: "left", required: 3 },
  { direction: "across", required: 3 },
  { direction: "right", required: 0 },
];

const FINAL_COURTESY: { direction: CharlestonDirection; required: number } =
  { direction: "courtesy", required: 0 };

function getCharlestonSteps(round: 1 | 2): { direction: CharlestonDirection; required: number }[] {
  return round === 1 ? CHARLESTON_ROUND1 : CHARLESTON_ROUND2;
}

function charlestonTarget(from: SeatWind, direction: CharlestonDirection): SeatWind {
  const idx = SEAT_ORDER.indexOf(from);
  switch (direction) {
    case "right":   return SEAT_ORDER[(idx + 1) % 4];
    case "left":    return SEAT_ORDER[(idx + 3) % 4];
    case "across":  return SEAT_ORDER[(idx + 2) % 4];
    case "courtesy": return SEAT_ORDER[(idx + 2) % 4];
  }
}

export function submitCharlestonPass(
  room: RoomState,
  playerId: string,
  tileCodes: TileCode[]
): RoomState {
  if (!room.game || room.game.phase !== "charleston" || !room.game.charleston) {
    throw new Error("Not in charleston phase.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind) throw new Error("Player must be seated.");

  const cs = room.game.charleston;
  if (cs.voting) {
    throw new Error("Currently in voting phase, not passing.");
  }

  const steps = cs.direction === "courtesy"
    ? [FINAL_COURTESY]
    : getCharlestonSteps(cs.round);
  const stepIdx = cs.direction === "courtesy" ? 0 : cs.step - 1;
  const step = steps[stepIdx];
  if (!step) throw new Error("Invalid charleston step.");

  const minCount = step.required || 0;
  const maxCount = step.required || 3;

  if (step.required > 0 && tileCodes.length !== step.required) {
    throw new Error(`Must pass exactly ${step.required} tiles for ${step.direction} pass.`);
  }
  if (tileCodes.length < minCount || tileCodes.length > maxCount) {
    throw new Error(`Must pass ${minCount}-${maxCount} tiles for ${step.direction} pass.`);
  }

  // Validate: no jokers
  const hand = room.game.players[seatWind].concealedTiles;
  for (const code of tileCodes) {
    const tile = hand.find((t) => t.code === code);
    if (!tile) throw new Error(`Tile ${code} not in hand.`);
    if (isJokerTile(tile)) throw new Error("Cannot pass jokers during Charleston.");
  }

  room.game.charleston.submissions[seatWind] = tileCodes;
  return room;
}

export function allCharlestonSubmitted(room: RoomState): boolean {
  if (!room.game?.charleston) return false;
  return SEAT_ORDER.every((w) => w in room.game!.charleston!.submissions);
}

export function resolveCharleston(room: RoomState): RoomState {
  if (!room.game?.charleston) throw new Error("No charleston to resolve.");

  const cs = room.game.charleston;
  const direction = cs.direction;

  // For courtesy pass, find min tiles each across-pair is willing to exchange
  if (direction === "courtesy") {
    const pairs: [SeatWind, SeatWind][] = [["east", "west"], ["south", "north"]];
    for (const [a, b] of pairs) {
      const aTiles = cs.submissions[a] ?? [];
      const bTiles = cs.submissions[b] ?? [];
      const exchangeCount = Math.min(aTiles.length, bTiles.length);

      const aHand = room.game.players[a].concealedTiles;
      const bHand = room.game.players[b].concealedTiles;
      const aRemoved: Tile[] = [];
      const bRemoved: Tile[] = [];

      for (let i = 0; i < exchangeCount; i++) {
        const ai = aHand.findIndex((t) => t.code === aTiles[i]);
        if (ai !== -1) aRemoved.push(...aHand.splice(ai, 1));
        const bi = bHand.findIndex((t) => t.code === bTiles[i]);
        if (bi !== -1) bRemoved.push(...bHand.splice(bi, 1));
      }

      aHand.push(...bRemoved);
      bHand.push(...aRemoved);
    }
  } else {
    // Directional pass: each player sends tiles to their target
    const outgoing = new Map<SeatWind, Tile[]>();

    for (const wind of SEAT_ORDER) {
      const codes = cs.submissions[wind] ?? [];
      const hand = room.game.players[wind].concealedTiles;
      const removed: Tile[] = [];

      for (const code of codes) {
        const idx = hand.findIndex((t) => t.code === code);
        if (idx !== -1) removed.push(...hand.splice(idx, 1));
      }

      outgoing.set(wind, removed);
    }

    // Deliver tiles
    for (const from of SEAT_ORDER) {
      const target = charlestonTarget(from, direction);
      room.game.players[target].concealedTiles.push(...(outgoing.get(from) ?? []));
    }
  }

  // Handle final courtesy pass — done after this
  if (direction === "courtesy") {
    finishCharleston(room);
    return room;
  }

  // Advance to next step or finish round
  const steps = getCharlestonSteps(cs.round);
  const nextStep = cs.step + 1;

  if (nextStep > steps.length) {
    if (cs.round === 1) {
      // Enter voting phase for round 2
      room.game.phase = "charleston-vote";
      room.game.charleston = {
        direction: cs.direction,
        step: cs.step,
        round: 1,
        submissions: {},
        voting: true,
        votes: {}
      };
    } else {
      // Round 2 done → final courtesy pass
      room.game.charleston = {
        direction: "courtesy",
        step: 1,
        round: 2,
        submissions: {}
      };
      room.game.phase = "charleston";
    }
  } else {
    room.game.charleston = {
      direction: steps[nextStep - 1].direction,
      step: nextStep,
      round: cs.round,
      submissions: {}
    };
  }

  return room;
}

function finishCharleston(room: RoomState): void {
  if (!room.game) return;
  room.game.players.east.concealedTiles.push(room.game.deck.shift() as Tile);
  room.game.phase = "awaiting-discard";
  room.game.charleston = undefined;
}

// --- Charleston vote for round 2 ---

export function submitCharlestonVote(
  room: RoomState,
  playerId: string,
  wantSecondRound: boolean
): RoomState {
  if (!room.game || room.game.phase !== "charleston-vote" || !room.game.charleston?.voting) {
    throw new Error("Not in charleston voting phase.");
  }

  const seatWind = findSeatWind(room, playerId);
  if (!seatWind) throw new Error("Player must be seated.");

  if (!room.game.charleston.votes) room.game.charleston.votes = {};
  room.game.charleston.votes[seatWind] = wantSecondRound;

  return room;
}

export function allCharlestonVotesIn(room: RoomState): boolean {
  if (!room.game?.charleston?.votes) return false;
  return SEAT_ORDER.every((w) => w in room.game!.charleston!.votes!);
}

export function resolveCharlestonVote(room: RoomState): RoomState {
  if (!room.game?.charleston?.votes) throw new Error("No votes to resolve.");

  const allYes = SEAT_ORDER.every((w) => room.game!.charleston!.votes![w] === true);

  if (allYes) {
    // Start round 2
    room.game.phase = "charleston";
    room.game.charleston = {
      direction: "left",
      step: 1,
      round: 2,
      submissions: {}
    };
  } else {
    // Skip to final courtesy pass
    room.game.phase = "charleston";
    room.game.charleston = {
      direction: "courtesy",
      step: 1,
      round: 1,
      submissions: {}
    };
  }

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
          charleston: room.game.charleston
            ? {
                direction: room.game.charleston.direction,
                step: room.game.charleston.step,
                round: room.game.charleston.round,
                voting: room.game.charleston.voting
              }
            : undefined,
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
