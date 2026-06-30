export type TileSuit = "bam" | "crak" | "dot" | "wind" | "dragon" | "flower" | "joker";

export type TileCode =
  | `bam-${number}`
  | `crak-${number}`
  | `dot-${number}`
  | "wind-east"
  | "wind-south"
  | "wind-west"
  | "wind-north"
  | "dragon-red"
  | "dragon-green"
  | "dragon-white"
  | `flower-${number}`
  | `joker-${number}`;

export interface Tile {
  code: TileCode;
  suit: TileSuit;
  value?: number | string;
}

export interface HandPatternGroup {
  kind: "single" | "pair" | "pong" | "kong" | "quint";
  tile: TileCode | "any-flower" | "any-joker";
  concealed?: boolean;
  maxJokers?: number;
}

export interface AmericanHandPattern {
  id: string;
  name: string;
  section: string;
  groups: HandPatternGroup[];
  allowsJokers: boolean;
  points?: number;
  notes?: string;
}

export interface AmericanCard {
  id: string;
  title: string;
  patterns: AmericanHandPattern[];
}

export interface ValidationMatch {
  patternId: string;
  matched: boolean;
  jokerCount: number;
  reason?: string;
}

export interface HandValidationResult {
  matched: boolean;
  cardId: string;
  bestMatch?: ValidationMatch;
  attempted: ValidationMatch[];
}
