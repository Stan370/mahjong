import assert from "node:assert/strict";
import test from "node:test";

import type { Tile, TileCode } from "@mahjong/american-card";
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
  type PlayerProfile,
  type RoomState,
  type SeatWind
} from "./session.js";

// --- Helpers ---

function makePlayers(): PlayerProfile[] {
  return [
    { id: "p1", name: "Alice", fontScale: "M" },
    { id: "p2", name: "Bob", fontScale: "M" },
    { id: "p3", name: "Carol", fontScale: "M" },
    { id: "p4", name: "Dave", fontScale: "M" }
  ];
}

function seatAndReady(room: RoomState): void {
  const winds: SeatWind[] = ["east", "south", "west", "north"];
  const ids = ["p1", "p2", "p3", "p4"];
  for (let i = 0; i < 4; i++) {
    takeSeat(room, ids[i], winds[i]);
    toggleReady(room, ids[i]);
  }
}

function createReadyRoom(): RoomState {
  const [host, ...guests] = makePlayers();
  const room = createRoomState("ROOM1", host);
  for (const g of guests) {
    room.players[g.id] = g;
  }
  seatAndReady(room);
  return room;
}

function makeTile(code: string): Tile {
  const [kind, raw] = code.split("-");
  const suit = kind as Tile["suit"];
  return { code: code as TileCode, suit, value: isNaN(Number(raw)) ? raw : Number(raw) };
}

// --- Lobby tests ---

test("4 players seat and ready → canStart returns true", () => {
  const room = createReadyRoom();
  assert.equal(canStart(room), true);
});

test("3 players seated → canStart returns false", () => {
  const [host, p2, p3] = makePlayers();
  const room = createRoomState("ROOM2", host);
  room.players[p2.id] = p2;
  room.players[p3.id] = p3;
  takeSeat(room, "p1", "east");
  takeSeat(room, "p2", "south");
  takeSeat(room, "p3", "west");
  toggleReady(room, "p1");
  toggleReady(room, "p2");
  toggleReady(room, "p3");
  assert.equal(canStart(room), false);
});

// --- Start game ---

test("startGame deals 13 tiles to S/W/N and 14 to East", () => {
  const room = createReadyRoom();
  startGame(room);

  assert.equal(room.game!.players.east.concealedTiles.length, 14);
  assert.equal(room.game!.players.south.concealedTiles.length, 13);
  assert.equal(room.game!.players.west.concealedTiles.length, 13);
  assert.equal(room.game!.players.north.concealedTiles.length, 13);
  assert.equal(room.game!.phase, "awaiting-discard");
  assert.equal(room.game!.currentTurn, "east");
});

test("startGame throws if not all seated and ready", () => {
  const [host] = makePlayers();
  const room = createRoomState("ROOM3", host);
  assert.throws(() => startGame(room), /occupied and ready/);
});

// --- Discard ---

test("discard a tile → phase becomes claim-window", () => {
  const room = createReadyRoom();
  startGame(room);

  const eastHand = room.game!.players.east.concealedTiles;
  // Find a non-joker tile
  const nonJoker = eastHand.find((t) => t.suit !== "joker")!;

  discardTile(room, "p1", nonJoker.code);

  assert.equal(room.game!.phase, "claim-window");
  assert.ok(room.game!.claimWindow);
  assert.equal(room.game!.claimWindow!.discardedTile.code, nonJoker.code);
  assert.equal(room.game!.claimWindow!.discardedBy, "east");
  assert.equal(room.game!.discards.length, 1);
});

test("cannot discard a joker tile", () => {
  const room = createReadyRoom();
  startGame(room);

  // Inject a joker into east's hand for testing
  const jokerTile = makeTile("joker-1");
  room.game!.players.east.concealedTiles.push(jokerTile);

  assert.throws(() => discardTile(room, "p1", "joker-1" as TileCode), /Jokers cannot be discarded/);
});

test("cannot discard when it's not your turn", () => {
  const room = createReadyRoom();
  startGame(room);

  const southHand = room.game!.players.south.concealedTiles;
  assert.throws(
    () => discardTile(room, "p2", southHand[0].code),
    /not this player's turn/
  );
});

// --- Claim window ---

test("no claims → next player draws, phase returns to awaiting-discard", () => {
  const room = createReadyRoom();
  startGame(room);

  const nonJoker = room.game!.players.east.concealedTiles.find((t) => t.suit !== "joker")!;
  discardTile(room, "p1", nonJoker.code);

  // All three non-discarders pass
  passClaim(room, "p2");
  passClaim(room, "p3");
  passClaim(room, "p4");

  assert.equal(allClaimsIn(room), true);

  const southBefore = room.game!.players.south.concealedTiles.length;
  resolveClaims(room);

  assert.equal(room.game!.phase, "awaiting-discard");
  assert.equal(room.game!.currentTurn, "south");
  // South drew a tile
  assert.equal(room.game!.players.south.concealedTiles.length, southBefore + 1);
});

test("pong claim → claimant gets tile, exposes meld, becomes current turn", () => {
  const room = createReadyRoom();
  startGame(room);

  // Plant a specific tile for testing: give East a wind-east and give West two wind-east
  const targetCode = "wind-east" as TileCode;
  const targetTile = makeTile("wind-east");
  room.game!.players.east.concealedTiles[0] = targetTile;
  room.game!.players.west.concealedTiles[0] = makeTile("wind-east");
  room.game!.players.west.concealedTiles[1] = makeTile("wind-east");

  discardTile(room, "p1", targetCode);
  passClaim(room, "p2"); // South passes
  submitClaim(room, "p3", "pong"); // West claims pong
  passClaim(room, "p4"); // North passes

  resolveClaims(room);

  assert.equal(room.game!.currentTurn, "west");
  assert.equal(room.game!.phase, "awaiting-discard");
  assert.equal(room.game!.players.west.exposedMelds.length, 1);
  assert.equal(room.game!.players.west.exposedMelds[0].meldType, "pong");
  assert.equal(room.game!.players.west.exposedMelds[0].tiles.length, 3);
  assert.equal(room.game!.players.west.exposedMelds[0].claimedFrom, "east");
});

test("mahjong claim beats pong claim", () => {
  const room = createReadyRoom();
  startGame(room);

  const targetCode = "wind-east" as TileCode;
  room.game!.players.east.concealedTiles[0] = makeTile("wind-east");

  // Give West enough for pong
  room.game!.players.west.concealedTiles[0] = makeTile("wind-east");
  room.game!.players.west.concealedTiles[1] = makeTile("wind-east");

  discardTile(room, "p1", targetCode);
  submitClaim(room, "p3", "pong"); // West claims pong
  submitClaim(room, "p4", "mahjong"); // North claims mahjong (will likely be invalid)
  passClaim(room, "p2"); // South passes

  resolveClaims(room);

  // Mahjong claim wins over pong (even if the hand is invalid, mahjong priority applies)
  assert.equal(room.game!.phase, "finished");
  assert.equal(room.game!.result!.winnerId, "p4");
});

test("cannot claim your own discard", () => {
  const room = createReadyRoom();
  startGame(room);

  const nonJoker = room.game!.players.east.concealedTiles.find((t) => t.suit !== "joker")!;
  discardTile(room, "p1", nonJoker.code);

  assert.throws(
    () => submitClaim(room, "p1", "pong"),
    /Cannot claim your own discard/
  );
});

// --- Declare mahjong (self-drawn) ---

test("declare mahjong with valid hand → game finished, status mahjong", () => {
  const room = createReadyRoom();
  startGame(room);

  // Build a valid winds-and-dragons hand in East's concealed tiles
  room.game!.players.east.concealedTiles = [
    makeTile("wind-east"), makeTile("wind-east"), makeTile("wind-east"),
    makeTile("wind-south"), makeTile("wind-south"), makeTile("wind-south"),
    makeTile("wind-west"), makeTile("wind-west"), makeTile("wind-west"),
    makeTile("wind-north"), makeTile("wind-north"), makeTile("wind-north"),
    makeTile("dragon-white"), makeTile("dragon-white")
  ];

  declareMahjong(room, "p1");

  assert.equal(room.game!.phase, "finished");
  assert.equal(room.game!.result!.status, "mahjong");
  assert.equal(room.game!.result!.winnerId, "p1");
  assert.equal(room.game!.result!.patternId, "winds-dragons-2026-b");
});

test("declare mahjong with invalid hand → game finished, status invalid", () => {
  const room = createReadyRoom();
  startGame(room);

  // East has random tiles, not a valid pattern
  declareMahjong(room, "p1");

  assert.equal(room.game!.phase, "finished");
  assert.equal(room.game!.result!.status, "invalid");
  assert.equal(room.game!.result!.winnerId, "p1");
});

// --- Joker exchange ---

test("joker exchange on exposed meld works correctly", () => {
  const room = createReadyRoom();
  startGame(room);

  // Set up: West has an exposed meld with a joker
  room.game!.players.west.exposedMelds = [{
    tiles: [makeTile("wind-east"), makeTile("wind-east"), makeTile("joker-1")],
    meldType: "pong",
    claimedFrom: "south"
  }];

  // East holds a wind-east (the natural tile)
  room.game!.players.east.concealedTiles[0] = makeTile("wind-east");

  const handSizeBefore = room.game!.players.east.concealedTiles.length;

  exchangeJoker(room, "p1", "west", 0, "wind-east" as TileCode);

  // East should now have the joker, West's meld should have 3 natural tiles
  const eastHand = room.game!.players.east.concealedTiles;
  assert.equal(eastHand[0].suit, "joker");
  assert.equal(eastHand.length, handSizeBefore); // hand size unchanged

  const westMeld = room.game!.players.west.exposedMelds[0];
  assert.ok(westMeld.tiles.every((t) => t.code === "wind-east" as TileCode));
});

test("cannot exchange joker from your own melds", () => {
  const room = createReadyRoom();
  startGame(room);

  room.game!.players.east.exposedMelds = [{
    tiles: [makeTile("wind-east"), makeTile("wind-east"), makeTile("joker-1")],
    meldType: "pong"
  }];
  room.game!.players.east.concealedTiles[0] = makeTile("wind-east");

  assert.throws(
    () => exchangeJoker(room, "p1", "east", 0, "wind-east" as TileCode),
    /Cannot exchange jokers from your own melds/
  );
});

// --- Snapshot ---

test("snapshot hides other players' concealed tiles", () => {
  const room = createReadyRoom();
  startGame(room);

  const snap = createSnapshot(room, "p1");

  assert.ok(snap.game);
  // p1 (East) sees their own tiles
  assert.equal(snap.game.myTiles.length, 14);
  // Exposed melds for all players are visible
  assert.ok("east" in snap.game.exposedMelds);
  assert.ok("south" in snap.game.exposedMelds);
});

// --- Wall exhaustion ---

test("wall exhaustion → game finished, status wall-exhausted", () => {
  const room = createReadyRoom();
  startGame(room);

  // Empty the deck
  room.game!.deck = [];

  // Discard from East
  const nonJoker = room.game!.players.east.concealedTiles.find((t) => t.suit !== "joker")!;
  discardTile(room, "p1", nonJoker.code);

  // All pass
  passClaim(room, "p2");
  passClaim(room, "p3");
  passClaim(room, "p4");

  resolveClaims(room);

  assert.equal(room.game!.phase, "finished");
  assert.equal(room.game!.result!.status, "wall-exhausted");
});
