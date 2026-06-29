import assert from "node:assert/strict";
import test from "node:test";

import { validateAmericanMahjongHand } from "./validate-hand.js";
import type { Tile } from "./types.js";

test("matches a valid winds and dragons hand without jokers in the pair", () => {
  const hand: Tile[] = [
    { code: "wind-east", suit: "wind" },
    { code: "wind-east", suit: "wind" },
    { code: "wind-east", suit: "wind" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "dragon-white", suit: "dragon" },
    { code: "dragon-white", suit: "dragon" }
  ];

  const result = validateAmericanMahjongHand(hand);
  assert.equal(result.matched, true);
  assert.equal(result.bestMatch?.patternId, "winds-dragons-2026-b");
});

test("allows jokers inside melds but not in a protected pair", () => {
  const hand: Tile[] = [
    { code: "wind-east", suit: "wind" },
    { code: "wind-east", suit: "wind" },
    { code: "joker-1", suit: "joker" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-south", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-west", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "wind-north", suit: "wind" },
    { code: "joker-2", suit: "joker" },
    { code: "dragon-white", suit: "dragon" }
  ];

  const result = validateAmericanMahjongHand(hand);
  assert.equal(result.matched, false);
});
