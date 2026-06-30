import { americanMahjongCard2026 } from "./card-2026.js";
import type {
  AmericanHandPattern,
  HandPatternGroup,
  HandValidationResult,
  Tile,
  TileCode,
  ValidationMatch
} from "./types.js";

const JOKER_SUIT = "joker";

function getRequiredCount(kind: HandPatternGroup["kind"]): number {
  switch (kind) {
    case "single":
      return 1;
    case "pair":
      return 2;
    case "pong":
      return 3;
    case "kong":
      return 4;
    case "quint":
      return 5;
  }
}

function countTiles(hand: Tile[]): Map<TileCode, number> {
  const counts = new Map<TileCode, number>();

  for (const tile of hand) {
    counts.set(tile.code, (counts.get(tile.code) ?? 0) + 1);
  }

  return counts;
}

function countJokers(hand: Tile[]): number {
  return hand.filter((tile) => tile.suit === JOKER_SUIT).length;
}

function consumeGroup(
  counts: Map<TileCode, number>,
  jokersLeft: number,
  group: HandPatternGroup
): { ok: boolean; jokersLeft: number; jokersUsed: number; reason?: string } {
  const required = getRequiredCount(group.kind);

  if (group.tile === "any-joker") {
    if (jokersLeft < required) {
      return { ok: false, jokersLeft, jokersUsed: 0, reason: "Not enough jokers." };
    }

    return { ok: true, jokersLeft: jokersLeft - required, jokersUsed: required };
  }

  if (group.tile === "any-flower") {
    const flowerEntries = [...counts.entries()].filter(([code]) => code.startsWith("flower-"));
    const available = flowerEntries.reduce((sum, [, count]) => sum + count, 0);
    const jokerAllowance = group.maxJokers ?? required;
    const missing = Math.max(required - available, 0);

    if (missing > jokerAllowance || missing > jokersLeft) {
      return { ok: false, jokersLeft, jokersUsed: 0, reason: "Not enough flowers or jokers." };
    }

    let toConsume = required;
    for (const [code, count] of flowerEntries) {
      if (toConsume === 0) {
        break;
      }

      const take = Math.min(count, toConsume);
      counts.set(code, count - take);
      toConsume -= take;
    }

    return { ok: true, jokersLeft: jokersLeft - missing, jokersUsed: missing };
  }

  const exactCount = counts.get(group.tile) ?? 0;
  const missing = Math.max(required - exactCount, 0);
  const jokerAllowance = group.maxJokers ?? required;

  if (missing > jokerAllowance || missing > jokersLeft) {
    return { ok: false, jokersLeft, jokersUsed: 0, reason: `Missing tiles for ${group.tile}.` };
  }

  counts.set(group.tile, Math.max(exactCount - required, 0));
  return { ok: true, jokersLeft: jokersLeft - missing, jokersUsed: missing };
}

function tryPattern(pattern: AmericanHandPattern, hand: Tile[]): ValidationMatch {
  const counts = countTiles(hand);
  const totalJokers = countJokers(hand);
  let jokersLeft = totalJokers;
  let jokerCount = 0;

  for (const group of pattern.groups) {
    const result = consumeGroup(counts, jokersLeft, group);
    if (!result.ok) {
      return {
        patternId: pattern.id,
        matched: false,
        jokerCount,
        reason: result.reason
      };
    }

    jokersLeft = result.jokersLeft;
    jokerCount += result.jokersUsed;
  }

  const leftovers = [...counts.entries()]
    .filter(([code, count]) => count > 0 && !code.startsWith("joker-"))
    .reduce((sum, [, count]) => sum + count, 0);

  if (leftovers > 0) {
    return {
      patternId: pattern.id,
      matched: false,
      jokerCount,
      reason: "Hand contains tiles outside the selected card pattern."
    };
  }

  return {
    patternId: pattern.id,
    matched: true,
    jokerCount
  };
}

export function validateAmericanMahjongHand(hand: Tile[]): HandValidationResult {
  const attempted = americanMahjongCard2026.patterns.map((pattern) => tryPattern(pattern, hand));
  const bestMatch = attempted.find((result) => result.matched);

  return {
    matched: Boolean(bestMatch),
    cardId: americanMahjongCard2026.id,
    bestMatch,
    attempted
  };
}
