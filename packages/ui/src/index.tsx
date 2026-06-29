import * as React from "react";

export type FontScale = "S" | "M" | "L";

const scaleClassName: Record<FontScale, string> = {
  S: "scale-s",
  M: "scale-m",
  L: "scale-l"
};

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
  const classes = [
    "mahjong-tile",
    scaleClassName[props.scale ?? "M"],
    props.concealed ? "tile-concealed" : "",
    props.interactive ? "tile-interactive" : "",
    props.selected ? "tile-selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} onClick={props.onClick} disabled={!props.interactive}>
      <span>{props.concealed ? "Hidden" : prettifyTileCode(props.code)}</span>
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
  if (kind === "wind" || kind === "dragon") {
    return `${capitalize(rawValue)} ${capitalize(kind)}`;
  }
  if (kind === "joker") {
    return "Joker";
  }
  if (kind === "flower") {
    return "Flower";
  }
  return `${capitalize(kind)} ${rawValue}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
