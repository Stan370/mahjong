import * as React from "react";

export type FontScale = "S" | "M" | "L";

const scaleClassName: Record<FontScale, string> = {
  S: "scale-s",
  M: "scale-m",
  L: "scale-l"
};

function getSuit(code: string): string {
  return code.split("-")[0];
}

export function FontScalePicker(props: {
  value: FontScale;
  onChange: (nextValue: FontScale) => void;
}) {
  return (
    <div className="font-scale-picker" role="group" aria-label="Font size">
      {(["S", "M", "L"] as FontScale[]).map((size) => (
        <button
          key={size}
          type="button"
          className={props.value === size ? "chip chip-active" : "chip"}
          onClick={() => props.onChange(size)}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

export function MahjongTile(props: {
  code: string;
  concealed?: boolean;
  interactive?: boolean;
  selected?: boolean;
  scale?: FontScale;
  onClick?: () => void;
}) {
  const suit = getSuit(props.code);
  const classes = [
    "mahjong-tile",
    scaleClassName[props.scale ?? "M"],
    `tile-${suit}`,
    props.concealed ? "tile-concealed" : "",
    props.interactive ? "tile-interactive" : "",
    props.selected ? "tile-selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} onClick={props.onClick} disabled={!props.interactive}>
      <span>{props.concealed ? "" : prettifyTileCode(props.code)}</span>
    </button>
  );
}

export function SeatCard(props: {
  seat: string;
  playerName?: string;
  ready?: boolean;
  isTurn?: boolean;
  scale?: FontScale;
  action?: React.ReactNode;
  summary?: string;
}) {
  return (
    <section className={`seat-card ${scaleClassName[props.scale ?? "M"]}`}>
      <div className="seat-card-header">
        <div>
          <p className="seat-label">{props.seat}</p>
          <h3>{props.playerName ?? "Open seat"}</h3>
        </div>
        <span className={props.ready ? "seat-badge seat-ready" : "seat-badge"}>
          {props.isTurn ? "Current turn" : props.ready ? "Ready" : "Waiting"}
        </span>
      </div>
      {props.summary ? <p className="seat-summary">{props.summary}</p> : null}
      {props.action}
    </section>
  );
}

export function ActionBar(props: {
  actions: Array<{ id: string; label: string; disabled?: boolean; onClick: () => void }>;
}) {
  return (
    <div className="action-bar">
      {props.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="primary-button"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function prettifyTileCode(code: string): string {
  const [kind, rawValue] = code.split("-");

  // Chinese character representations
  const crakChars: Record<string, string> = {
    "1": "一\n万", "2": "二\n万", "3": "三\n万", "4": "四\n万", "5": "五\n万",
    "6": "六\n万", "7": "七\n万", "8": "八\n万", "9": "九\n万"
  };
  const dotChars: Record<string, string> = {
    "1": "一\n筒", "2": "二\n筒", "3": "三\n筒", "4": "四\n筒", "5": "五\n筒",
    "6": "六\n筒", "7": "七\n筒", "8": "八\n筒", "9": "九\n筒"
  };
  const bamChars: Record<string, string> = {
    "1": "一\n条", "2": "二\n条", "3": "三\n条", "4": "四\n条", "5": "五\n条",
    "6": "六\n条", "7": "七\n条", "8": "八\n条", "9": "九\n条"
  };

  if (kind === "crak") return crakChars[rawValue] ?? `${rawValue}\n万`;
  if (kind === "dot") return dotChars[rawValue] ?? `${rawValue}\n筒`;
  if (kind === "bam") return bamChars[rawValue] ?? `${rawValue}\n条`;

  if (kind === "wind") {
    const windChars: Record<string, string> = { east: "東", south: "南", west: "西", north: "北" };
    return windChars[rawValue] ?? rawValue;
  }
  if (kind === "dragon") {
    const dragonChars: Record<string, string> = { red: "中", green: "發", white: "白" };
    return dragonChars[rawValue] ?? rawValue;
  }
  if (kind === "joker") return "🃏";
  if (kind === "flower") return "🌸";

  return `${capitalize(kind)} ${rawValue}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
