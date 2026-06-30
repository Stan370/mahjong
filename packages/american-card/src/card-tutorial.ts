/**
 * Tutorial Card for American Mahjong
 *
 * Based on the official tutorial card format. Each "line" on the card is a
 * template that can be instantiated with different suits/numbers/dragons.
 * This generator expands them into concrete AmericanHandPattern objects the
 * validator can check directly.
 *
 * Notation reference (from card):
 *   F = Flower, N/E/W/S = winds, D = Dragon
 *   Same colour numbers = same suit, different colours = different suits
 *   X = jokers allowed (eXposed ok), C = concealed (no jokers)
 */

import type { AmericanCard, AmericanHandPattern, HandPatternGroup, TileCode } from "./types.js";

type Suit = "bam" | "crak" | "dot";
const SUITS: Suit[] = ["bam", "crak", "dot"];

// --- helpers ---

function tc(suit: Suit | "wind" | "dragon" | "flower", value: string | number): TileCode {
  return `${suit}-${value}` as TileCode;
}

function g(kind: HandPatternGroup["kind"], tile: TileCode | "any-flower", maxJokers?: number): HandPatternGroup {
  return maxJokers !== undefined ? { kind, tile, maxJokers } : { kind, tile };
}

/** All ordered permutations of `k` items from `arr` (no repeats). */
function permutations<T>(arr: T[], k: number): T[][] {
  if (k === 1) return arr.map((v) => [v]);
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest, k - 1)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

const NEWS: HandPatternGroup[] = [
  g("single", "wind-north" as TileCode),
  g("single", "wind-east" as TileCode),
  g("single", "wind-west" as TileCode),
  g("single", "wind-south" as TileCode),
];

// --- pattern generators ---

function line1(): AmericanHandPattern[] {
  // FFFF 111 NEWS 111 — two pongs same number, different suits + flowers + winds
  const out: AmericanHandPattern[] = [];
  for (let n = 1; n <= 9; n++) {
    for (const [s1, s2] of permutations(SUITS, 2)) {
      out.push({
        id: `tut-1-${s1}${n}-${s2}${n}`,
        name: "Flowers, Like Numbers & Winds",
        section: "Tutorial",
        allowsJokers: true,
        points: 25,
        groups: [g("kong", "any-flower"), g("pong", tc(s1, n)), ...NEWS, g("pong", tc(s2, n))],
      });
    }
  }
  return out;
}

function line2(): AmericanHandPattern[] {
  // FFF 1111 222 3333 — consecutive numbers, 3 different suits
  const out: AmericanHandPattern[] = [];
  for (let n = 1; n <= 7; n++) {
    for (const [s1, s2, s3] of permutations(SUITS, 3)) {
      out.push({
        id: `tut-2-${s1}${n}-${s2}${n + 1}-${s3}${n + 2}`,
        name: "Consecutive Run (3 Suits)",
        section: "Tutorial",
        allowsJokers: true,
        points: 25,
        groups: [g("pong", "any-flower"), g("kong", tc(s1, n)), g("pong", tc(s2, n + 1)), g("kong", tc(s3, n + 2))],
      });
    }
  }
  return out;
}

function line3(): AmericanHandPattern[] {
  // 11111 NEWS DDDDD — quint of number + winds + quint of dragon
  const out: AmericanHandPattern[] = [];
  const dragons = ["red", "green", "white"] as const;
  for (let n = 1; n <= 9; n++) {
    for (const s of SUITS) {
      for (const d of dragons) {
        out.push({
          id: `tut-3-${s}${n}-${d}`,
          name: "Quint, Winds & Dragon Quint",
          section: "Tutorial",
          allowsJokers: true,
          points: 40,
          groups: [g("quint", tc(s, n)), ...NEWS, g("quint", tc("dragon", d))],
        });
      }
    }
  }
  return out;
}

function line4(): AmericanHandPattern[] {
  // FF 1111 3333 5555 — odd numbers, 3 different suits
  const out: AmericanHandPattern[] = [];
  const odds = [1, 3, 5, 7, 9];
  for (let i = 0; i < odds.length - 2; i++) {
    for (const [s1, s2, s3] of permutations(SUITS, 3)) {
      out.push({
        id: `tut-4-${s1}${odds[i]}-${s2}${odds[i + 1]}-${s3}${odds[i + 2]}`,
        name: "Odd Kongs (3 Suits)",
        section: "Tutorial",
        allowsJokers: true,
        points: 25,
        groups: [g("pair", "any-flower"), g("kong", tc(s1, odds[i])), g("kong", tc(s2, odds[i + 1])), g("kong", tc(s3, odds[i + 2]))],
      });
    }
  }
  return out;
}

function line5(): AmericanHandPattern[] {
  // 555 777 999 DDD DD — odd pongs, 2 opposite dragons (concealed, no jokers)
  const out: AmericanHandPattern[] = [];
  const dragons = ["red", "green", "white"] as const;
  for (const s of SUITS) {
    for (let i = 0; i < dragons.length; i++) {
      for (let j = 0; j < dragons.length; j++) {
        if (i === j) continue;
        out.push({
          id: `tut-5-${s}-${dragons[i]}-${dragons[j]}`,
          name: "Odd Pongs & Opposite Dragons",
          section: "Tutorial",
          allowsJokers: false,
          points: 30,
          groups: [
            g("pong", tc(s, 5), 0), g("pong", tc(s, 7), 0), g("pong", tc(s, 9), 0),
            g("pong", tc("dragon", dragons[i]), 0), g("pair", tc("dragon", dragons[j]), 0),
          ],
        });
      }
    }
  }
  return out;
}

function line6(): AmericanHandPattern[] {
  // 2222 444 666 8888 — even numbers, 3 different suits
  const out: AmericanHandPattern[] = [];
  const evens = [2, 4, 6, 8];
  for (const [s1, s2, s3] of permutations(SUITS, 3)) {
    out.push({
      id: `tut-6-${s1}2-${s2}4-${s3}6-${s1}8`,
      name: "Even Kongs & Pongs (3 Suits)",
      section: "Tutorial",
      allowsJokers: true,
      points: 25,
      groups: [g("kong", tc(s1, evens[0])), g("pong", tc(s2, evens[1])), g("pong", tc(s3, evens[2])), g("kong", tc(s1, evens[3]))],
    });
  }
  return out;
}

function line7(): AmericanHandPattern[] {
  // FFF 22 44 66 88 DDD — even pairs, 1 suit, any dragon
  const out: AmericanHandPattern[] = [];
  const dragons = ["red", "green", "white"] as const;
  for (const s of SUITS) {
    for (const d of dragons) {
      out.push({
        id: `tut-7-${s}-${d}`,
        name: "Even Pairs & Dragon (1 Suit)",
        section: "Tutorial",
        allowsJokers: true,
        points: 25,
        groups: [
          g("pong", "any-flower"),
          g("pair", tc(s, 2)), g("pair", tc(s, 4)), g("pair", tc(s, 6)), g("pair", tc(s, 8)),
          g("pong", tc("dragon", d)),
        ],
      });
    }
  }
  return out;
}

function line8(): AmericanHandPattern[] {
  // FF 333 66 999 6666 — 2 suits
  const out: AmericanHandPattern[] = [];
  for (const [s1, s2] of permutations(SUITS, 2)) {
    out.push({
      id: `tut-8-${s1}-${s2}`,
      name: "Mixed Pongs & Kong (2 Suits)",
      section: "Tutorial",
      allowsJokers: true,
      points: 25,
      groups: [
        g("pair", "any-flower"),
        g("pong", tc(s1, 3)), g("pair", tc(s2, 6)), g("pong", tc(s1, 9)), g("kong", tc(s2, 6)),
      ],
    });
  }
  return out;
}

function line9(): AmericanHandPattern[] {
  // NNN EE WW SSS DDDD — any dragon
  const out: AmericanHandPattern[] = [];
  const dragons = ["red", "green", "white"] as const;
  for (const d of dragons) {
    out.push({
      id: `tut-9-${d}`,
      name: "Winds & Dragon Kong",
      section: "Tutorial",
      allowsJokers: true,
      points: 25,
      groups: [
        g("pong", "wind-north" as TileCode), g("pair", "wind-east" as TileCode),
        g("pair", "wind-west" as TileCode), g("pong", "wind-south" as TileCode),
        g("kong", tc("dragon", d)),
      ],
    });
  }
  return out;
}

function line10(): AmericanHandPattern[] {
  // FF NN EE WW SS DD DD — 2 different dragons, concealed, no jokers
  const out: AmericanHandPattern[] = [];
  const dragons = ["red", "green", "white"] as const;
  for (const [d1, d2] of permutations([...dragons], 2)) {
    out.push({
      id: `tut-10-${d1}-${d2}`,
      name: "All Pairs — Winds & 2 Dragons",
      section: "Tutorial",
      allowsJokers: false,
      points: 50,
      groups: [
        g("pair", "any-flower"),
        g("pair", "wind-north" as TileCode, 0), g("pair", "wind-east" as TileCode, 0),
        g("pair", "wind-west" as TileCode, 0), g("pair", "wind-south" as TileCode, 0),
        g("pair", tc("dragon", d1), 0), g("pair", tc("dragon", d2), 0),
      ],
    });
  }
  return out;
}

// --- assemble ---

export function generateTutorialPatterns(): AmericanHandPattern[] {
  return [
    ...line1(), ...line2(), ...line3(), ...line4(), ...line5(),
    ...line6(), ...line7(), ...line8(), ...line9(), ...line10(),
  ];
}

export const tutorialCard: AmericanCard = {
  id: "tutorial-card-2026",
  title: "American Mahjong Tutorial Card",
  patterns: generateTutorialPatterns(),
};
