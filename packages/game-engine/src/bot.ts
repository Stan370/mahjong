/**
 * Bot AI for American Mahjong
 *
 * Strategy hierarchy:
 *   1. Find the closest matching card pattern
 *   2. Discard tiles furthest from that pattern
 *   3. Claim discards that advance the target pattern
 *   4. Declare mahjong when hand matches
 *
 * Keeps logic pure (no timers, no IO) — callers handle scheduling.
 */

import {
  tutorialCard,
  type AmericanHandPattern,
  type HandPatternGroup,
  type Tile,
  type TileCode
} from "@mahjong/american-card";

import type { ExposedMeld, SeatWind } from "./session.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotAction {
  type: "discard" | "claim" | "pass" | "mahjong" | "charleston-pass" | "charleston-vote";
}

export interface BotDiscardAction extends BotAction {
  type: "discard";
  tileCode: TileCode;
}

export interface BotClaimAction extends BotAction {
  type: "claim";
  claimType: "pong" | "kong" | "mahjong";
}

export interface BotPassAction extends BotAction {
  type: "pass";
}

export interface BotMahjongAction extends BotAction {
  type: "mahjong";
}

export interface BotCharlestonPassAction extends BotAction {
  type: "charleston-pass";
  tileCodes: TileCode[];
}

export interface BotCharlestonVoteAction extends BotAction {
  type: "charleston-vote";
  wantSecondRound: boolean;
}

export type AnyBotAction =
  | BotDiscardAction
  | BotClaimAction
  | BotPassAction
  | BotMahjongAction
  | BotCharlestonPassAction
  | BotCharlestonVoteAction;

// ---------------------------------------------------------------------------
// Pattern matching — how close is a hand to a card pattern?
// ---------------------------------------------------------------------------

interface PatternScore {
  pattern: AmericanHandPattern;
  distance: number; // lower = closer to winning
  neededTileCodes: Set<TileCode>;
  uselessTileCodes: Set<TileCode>;
}

function getRequiredCount(kind: HandPatternGroup["kind"]): number {
  switch (kind) {
    case "single": return 1;
    case "pair": return 2;
    case "pong": return 3;
    case "kong": return 4;
    case "quint": return 5;
  }
}

function scorePattern(
  hand: Tile[],
  exposedMelds: ExposedMeld[],
  pattern: AmericanHandPattern
): PatternScore {
  // Count tiles in hand + exposed melds
  const allTiles = [...hand, ...exposedMelds.flatMap((m) => m.tiles)];
  const counts = new Map<TileCode, number>();
  let jokerCount = 0;

  for (const tile of allTiles) {
    if (tile.suit === "joker") {
      jokerCount += 1;
    } else {
      counts.set(tile.code, (counts.get(tile.code) ?? 0) + 1);
    }
  }

  let distance = 0;
  const neededTileCodes = new Set<TileCode>();
  const allNeeded = new Set<TileCode>();

  // Clone counts for consumption
  const remaining = new Map(counts);
  let jokersLeft = jokerCount;

  for (const group of pattern.groups) {
    const required = getRequiredCount(group.kind);

    if (group.tile === "any-joker") {
      // Need jokers specifically
      const missing = Math.max(required - jokersLeft, 0);
      distance += missing;
      jokersLeft = Math.max(jokersLeft - required, 0);
      continue;
    }

    if (group.tile === "any-flower") {
      // Count all flower tiles
      let available = 0;
      for (const [code, count] of remaining) {
        if (code.startsWith("flower-")) {
          available += count;
        }
      }
      const jokerAllowance = group.maxJokers ?? required;
      const missing = Math.max(required - available, 0);
      const jokerFill = Math.min(missing, jokerAllowance, jokersLeft);
      distance += missing - jokerFill;

      // Consume flowers
      let toConsume = Math.min(required, available);
      for (const [code, count] of [...remaining]) {
        if (code.startsWith("flower-") && toConsume > 0) {
          const take = Math.min(count, toConsume);
          remaining.set(code, count - take);
          toConsume -= take;
          allNeeded.add(code);
        }
      }
      jokersLeft = Math.max(jokersLeft - jokerFill, 0);
      continue;
    }

    const tileCode = group.tile as TileCode;
    allNeeded.add(tileCode);
    const available = remaining.get(tileCode) ?? 0;
    const missing = Math.max(required - available, 0);
    const jokerAllowance = group.maxJokers ?? required;
    const jokerFill = Math.min(missing, jokerAllowance, jokersLeft);
    distance += missing - jokerFill;

    if (missing > 0) {
      neededTileCodes.add(tileCode);
    }

    remaining.set(tileCode, Math.max(available - required, 0));
    jokersLeft = Math.max(jokersLeft - jokerFill, 0);
  }

  // Determine useless tiles — tiles not needed by this pattern
  const uselessTileCodes = new Set<TileCode>();
  for (const tile of hand) {
    if (tile.suit === "joker") continue; // jokers always useful
    if (!allNeeded.has(tile.code)) {
      uselessTileCodes.add(tile.code);
    }
  }

  return { pattern, distance, neededTileCodes, uselessTileCodes };
}

/**
 * Find the closest matching patterns, sorted by distance (ascending).
 */
export function findClosestPatterns(
  hand: Tile[],
  exposedMelds: ExposedMeld[] = [],
  maxResults = 5
): PatternScore[] {
  const scores = tutorialCard.patterns.map((p) => scorePattern(hand, exposedMelds, p));
  scores.sort((a, b) => a.distance - b.distance);
  return scores.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Bot decisions
// ---------------------------------------------------------------------------

function isJoker(tile: Tile): boolean {
  return tile.suit === "joker";
}

/**
 * Pick the best tile to discard: farthest from the target pattern.
 */
export function botDecideDiscard(hand: Tile[], exposedMelds: ExposedMeld[] = []): BotDiscardAction | BotMahjongAction {
  const patterns = findClosestPatterns(hand, exposedMelds, 1);
  const best = patterns[0];

  // If distance = 0, declare mahjong
  if (best && best.distance === 0) {
    return { type: "mahjong" };
  }

  // Sort hand tiles by usefulness for the best pattern
  const nonJokerHand = hand.filter((t) => !isJoker(t));

  if (best) {
    // Prefer discarding tiles that are useless to the pattern
    const useless = nonJokerHand.filter((t) => best.uselessTileCodes.has(t.code));
    if (useless.length > 0) {
      return { type: "discard", tileCode: useless[0].code };
    }
  }

  // Fallback: discard the first non-joker tile
  if (nonJokerHand.length > 0) {
    return { type: "discard", tileCode: nonJokerHand[0].code };
  }

  // Extremely unlikely: all jokers. Shouldn't happen in real play.
  return { type: "discard", tileCode: hand[0].code };
}

/**
 * Decide whether to claim a discarded tile.
 */
export function botDecideClaim(
  hand: Tile[],
  exposedMelds: ExposedMeld[],
  discardedTile: Tile
): BotClaimAction | BotPassAction {
  const patterns = findClosestPatterns(hand, exposedMelds, 3);
  const best = patterns[0];
  if (!best) return { type: "pass" };

  const discardCode = discardedTile.code;

  // Check if this tile is needed by our target pattern
  if (!best.neededTileCodes.has(discardCode)) {
    return { type: "pass" };
  }

  // Count how many matching tiles + jokers we have
  const matchCount = hand.filter((t) => t.code === discardCode).length;
  const jokerCount = hand.filter((t) => isJoker(t)).length;

  // Check if we can mahjong with this tile
  const hypotheticalHand = [...hand, discardedTile];
  const mahjPatterns = findClosestPatterns(hypotheticalHand, exposedMelds, 1);
  if (mahjPatterns[0]?.distance === 0) {
    return { type: "claim", claimType: "mahjong" };
  }

  // Kong: need 3 in hand (matching + jokers)
  if (matchCount + jokerCount >= 3) {
    return { type: "claim", claimType: "kong" };
  }

  // Pong: need 2 in hand (matching + jokers)
  if (matchCount + jokerCount >= 2) {
    return { type: "claim", claimType: "pong" };
  }

  return { type: "pass" };
}

/**
 * Pick tiles to pass during Charleston. Never passes jokers.
 */
export function botCharlestonPass(
  hand: Tile[],
  exposedMelds: ExposedMeld[],
  count: number
): BotCharlestonPassAction {
  const patterns = findClosestPatterns(hand, exposedMelds, 1);
  const best = patterns[0];

  const passable = hand.filter((t) => !isJoker(t));

  let selected: Tile[];
  if (best) {
    // Pass useless tiles first
    const useless = passable.filter((t) => best.uselessTileCodes.has(t.code));
    const needed = passable.filter((t) => !best.uselessTileCodes.has(t.code));
    selected = [...useless, ...needed].slice(0, count);
  } else {
    selected = passable.slice(0, count);
  }

  return {
    type: "charleston-pass",
    tileCodes: selected.map((t) => t.code)
  };
}

/**
 * Decide whether to vote for a second charleston round.
 * Simple heuristic: vote yes if the hand is far from any pattern (distance > 4).
 */
export function botCharlestonVote(
  hand: Tile[],
  exposedMelds: ExposedMeld[] = []
): BotCharlestonVoteAction {
  const patterns = findClosestPatterns(hand, exposedMelds, 1);
  const best = patterns[0];
  const wantSecondRound = best ? best.distance > 4 : true;

  return { type: "charleston-vote", wantSecondRound };
}
