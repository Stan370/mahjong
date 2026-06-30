"use client";

import { useEffect, useRef, useState } from "react";

import {
  ActionBar,
  MahjongTile,
  prettifyTileCode,
  type FontScale
} from "@mahjong/ui";

type SeatWind = "east" | "south" | "west" | "north";

interface ExposedMeld {
  tiles: Array<{ code: string; suit: string }>;
  meldType: "pair" | "pong" | "kong";
  claimedFrom?: SeatWind;
}

interface CharlestonInfo {
  direction: string;
  step: number;
  round: 1 | 2;
  voting?: boolean;
}

interface RoomSnapshot {
  roomId: string;
  hostId: string;
  seats: Record<SeatWind, { wind: SeatWind; playerId?: string; playerName?: string; ready: boolean }>;
  game?: {
    currentTurn: SeatWind;
    discards: Array<{ code: string }>;
    wallCount: number;
    phase: string;
    myTiles: Array<{ code: string }>;
    myExposedMelds: ExposedMeld[];
    exposedMelds: Record<SeatWind, ExposedMeld[]>;
    charleston?: CharlestonInfo;
    claimWindow?: { discardedTile: { code: string }; discardedBy: SeatWind };
    result?: { winnerId: string; patternId?: string; status: "mahjong" | "invalid" | "wall-exhausted" };
  };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787";

export default function PlayPage() {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState("Starting quick play...");
  const [selectedTiles, setSelectedTiles] = useState<Set<string>>(new Set());
  const [fontScale] = useState<FontScale>(() => {
    if (typeof window === "undefined") return "M";
    const stored = window.localStorage.getItem("mahjong-font-scale");
    return stored === "S" || stored === "M" || stored === "L" ? stored : "M";
  });
  const [guestId, setGuestId] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const [roomId, setRoomId] = useState("");

  useEffect(() => {
    let mounted = true;

    async function startQuickPlay() {
      const name = window.localStorage.getItem("mahjong-guest-name") || "Player";
      const response = await fetch(`${API_BASE_URL}/api/quickplay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, fontScale })
      });

      if (!response.ok) {
        setStatus("Could not start quick play. Is the server running?");
        return;
      }

      const data = (await response.json()) as { roomId: string; guestId: string };
      window.localStorage.setItem("mahjong-guest-id", data.guestId);
      setGuestId(data.guestId);
      setRoomId(data.roomId);

      const snapRes = await fetch(`${API_BASE_URL}/api/rooms/${data.roomId}?playerId=${data.guestId}`);
      const snap = (await snapRes.json()) as RoomSnapshot;
      if (mounted) {
        setSnapshot(snap);
        setStatus("Game started! You are East.");
      }

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "joinRoom", payload: { roomId: data.roomId, playerId: data.guestId } }));
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as { type: string; payload: unknown };
        if (msg.type === "snapshot") setSnapshot(msg.payload as RoomSnapshot);
        if (msg.type === "error") setStatus((msg.payload as { message: string }).message);
      };
      socket.onclose = () => setStatus("Disconnected. Refresh to reconnect.");
    }

    startQuickPlay();
    return () => { mounted = false; socketRef.current?.close(); };
  }, [fontScale]);

  const phase = snapshot?.game?.phase ?? "lobby";
  const isMyTurn = snapshot?.game?.currentTurn === "east";
  const charlestonInfo = snapshot?.game?.charleston;
  const claimWindow = snapshot?.game?.claimWindow;
  const canClaim = claimWindow && claimWindow.discardedBy !== "east";
  const gameResult = snapshot?.game?.result;
  const myTiles = snapshot?.game?.myTiles ?? [];
  const discards = snapshot?.game?.discards ?? [];
  const wallCount = snapshot?.game?.wallCount ?? 0;

  function send(type: string, payload: Record<string, unknown>) {
    socketRef.current?.send(JSON.stringify({ type, payload }));
  }

  function toggleTile(code: string) {
    setSelectedTiles((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else if (phase === "charleston") {
        if (next.size >= 3) return prev;
        next.add(code);
      } else {
        next.clear();
        next.add(code);
      }
      return next;
    });
  }

  function discardAction() {
    if (selectedTiles.size !== 1) return;
    send("discardTile", { roomId, playerId: guestId, tileCode: [...selectedTiles][0] });
    setSelectedTiles(new Set());
  }

  function submitCharlestonPass() {
    send("submitCharlestonPass", { roomId, playerId: guestId, tileCodes: [...selectedTiles] });
    setSelectedTiles(new Set());
  }

  // Opponent info
  function oppInfo(wind: SeatWind) {
    const seat = snapshot?.seats[wind];
    const melds = snapshot?.game?.exposedMelds?.[wind] ?? [];
    const inTurn = snapshot?.game?.currentTurn === wind;
    // Each player has 13 tiles minus exposed ones, we show tile count
    const tileCount = 13 - melds.reduce((s, m) => s + m.tiles.length, 0) + (melds.length > 0 ? melds.length : 0);
    return { name: seat?.playerName ?? "Bot", melds, inTurn, tileCount: Math.max(tileCount, 0) };
  }

  function renderBackTiles(count: number) {
    return Array.from({ length: Math.min(count, 13) }, (_, i) => (
      <div key={i} className="back-tile" />
    ));
  }

  function renderOppMelds(melds: ExposedMeld[]) {
    if (melds.length === 0) return null;
    return (
      <div className="opp-melds">
        {melds.flatMap((meld, mi) =>
          meld.tiles.map((tile, ti) => (
            <span key={`${mi}-${ti}`} className="opp-meld-tile">
              {prettifyTileCode(tile.code).replace("\n", "")}
            </span>
          ))
        )}
      </div>
    );
  }

  const south = oppInfo("south");
  const west = oppInfo("west");
  const north = oppInfo("north");

  return (
    <main className={`play-page scale-${fontScale.toLowerCase()}`}>
      {/* ====== TABLE ====== */}
      <div className="table-area">
        {/* Top opponent (across = west in visual layout) */}
        <div className="opp-top opp-slot">
          <span className={`opp-label ${west.inTurn ? "is-turn" : ""}`}>
            {west.name} ({west.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(west.tileCount)}</div>
          {renderOppMelds(west.melds)}
        </div>

        {/* Left opponent */}
        <div className="opp-left opp-slot">
          <span className={`opp-label ${south.inTurn ? "is-turn" : ""}`}>
            {south.name} ({south.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(south.tileCount)}</div>
          {renderOppMelds(south.melds)}
        </div>

        {/* Center — wall count + discards */}
        <div className="table-center">
          <div className="center-info">
            <div className="center-char">麻将</div>
            <div className="center-wall">{wallCount} tiles in wall</div>
          </div>
          {discards.length > 0 && (
            <div className="discard-center">
              {discards.map((tile, i) => (
                <div key={`${tile.code}-${i}`} className="discard-mini">
                  {prettifyTileCode(tile.code).replace("\n", "")}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right opponent */}
        <div className="opp-right opp-slot">
          <span className={`opp-label ${north.inTurn ? "is-turn" : ""}`}>
            {north.name} ({north.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(north.tileCount)}</div>
          {renderOppMelds(north.melds)}
        </div>
      </div>

      {/* ====== CHARLESTON / VOTE / CLAIM OVERLAY ====== */}
      {phase === "charleston" && charlestonInfo && (
        <div className="overlay-bar">
          <h3>🔄 Charleston R{charlestonInfo.round} → {charlestonInfo.direction}</h3>
          <span className="helper-copy">
            {charlestonInfo.direction === "courtesy" || charlestonInfo.step === 3
              ? "Pass 0–3 tiles" : "Select 3 tiles"}
            {" · Jokers cannot be passed"}
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={submitCharlestonPass}
            disabled={
              charlestonInfo.direction !== "courtesy" && charlestonInfo.step <= 2 && selectedTiles.size !== 3
            }
          >
            Pass {selectedTiles.size} → {charlestonInfo.direction}
          </button>
        </div>
      )}

      {phase === "charleston-vote" && (
        <div className="overlay-bar">
          <h3>🗳️ Second Charleston round?</h3>
          <span className="helper-copy">All must agree</span>
          <div className="vote-buttons">
            <button type="button" className="primary-button" onClick={() => send("submitCharlestonVote", { roomId, playerId: guestId, wantSecondRound: true })}>
              ✅ Yes
            </button>
            <button type="button" className="secondary-button" onClick={() => send("submitCharlestonVote", { roomId, playerId: guestId, wantSecondRound: false })}>
              ❌ No
            </button>
          </div>
        </div>
      )}

      {phase === "claim-window" && claimWindow && (
        <div className="overlay-bar">
          <h3>⚡ Claim</h3>
          <div className="claim-discard-tile">
            <MahjongTile code={claimWindow.discardedTile.code} scale={fontScale} />
            <span>from {claimWindow.discardedBy.toUpperCase()}</span>
          </div>
          {canClaim && (
            <div className="claim-actions">
              <button type="button" className="claim-button claim-pong" onClick={() => send("submitClaim", { roomId, playerId: guestId, claimType: "pong" })}>Pong</button>
              <button type="button" className="claim-button claim-kong" onClick={() => send("submitClaim", { roomId, playerId: guestId, claimType: "kong" })}>Kong</button>
              <button type="button" className="claim-button claim-mahjong" onClick={() => send("submitClaim", { roomId, playerId: guestId, claimType: "mahjong" })}>Mahjong!</button>
              <button type="button" className="claim-button claim-pass" onClick={() => send("passClaim", { roomId, playerId: guestId })}>Pass</button>
            </div>
          )}
        </div>
      )}

      {/* ====== MY EXPOSED MELDS ====== */}
      {(snapshot?.game?.myExposedMelds ?? []).length > 0 && (
        <div className="melds-bar">
          {(snapshot?.game?.myExposedMelds ?? []).map((meld, mi) => (
            <div key={mi} className="meld-group">
              {meld.tiles.map((tile, ti) => (
                <MahjongTile key={`${tile.code}-${ti}`} code={tile.code} scale={fontScale} />
              ))}
              <span className="meld-badge">{meld.meldType}</span>
            </div>
          ))}
        </div>
      )}

      {/* ====== PLAYER HAND ====== */}
      <div className="hand-bar">
        <div className="hand-bar-header">
          <span className="hand-label">Your hand · {myTiles.length} tiles</span>
          {phase === "awaiting-discard" && (
            <span className={`turn-badge ${isMyTurn ? "your-turn" : "waiting"}`}>
              {isMyTurn ? "Your turn — tap a tile to discard" : `${snapshot?.game?.currentTurn?.toUpperCase()}'s turn`}
            </span>
          )}
          {phase === "charleston" && (
            <span className="turn-badge your-turn">
              Select tiles to pass
            </span>
          )}
        </div>
        <div className="hand-tiles">
          {myTiles.map((tile, idx) => (
            <MahjongTile
              key={`${tile.code}-${idx}`}
              code={tile.code}
              scale={fontScale}
              interactive={(phase === "awaiting-discard" && isMyTurn) || phase === "charleston"}
              selected={selectedTiles.has(tile.code)}
              onClick={() => toggleTile(tile.code)}
            />
          ))}
        </div>
      </div>

      {/* ====== ACTIONS ====== */}
      <ActionBar
        actions={[
          {
            id: "discard",
            label: "Discard",
            onClick: discardAction,
            disabled: selectedTiles.size !== 1 || !isMyTurn || phase !== "awaiting-discard"
          },
          {
            id: "mahjong",
            label: "Mahjong! 🀄",
            onClick: () => send("declareMahjong", { roomId, playerId: guestId }),
            disabled: phase !== "awaiting-discard" || !isMyTurn
          },
          {
            id: "newgame",
            label: "New Game",
            onClick: () => window.location.reload(),
            disabled: phase !== "finished"
          }
        ]}
      />

      {/* ====== RESULT OVERLAY ====== */}
      {gameResult && (
        <div className="result-overlay">
          <div className={`result-card ${gameResult.status === "mahjong" ? "result-win" : "result-loss"}`}>
            <h2>
              {gameResult.status === "mahjong" ? "🎉 Mahjong!" : gameResult.status === "wall-exhausted" ? "🧱 Wall Exhausted" : "❌ Invalid Hand"}
            </h2>
            {gameResult.patternId && <p>Pattern: <strong>{gameResult.patternId}</strong></p>}
            <p>Winner: {gameResult.winnerId}</p>
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              Play Again
            </button>
          </div>
        </div>
      )}

      <div className="status-bar">{status}</div>
    </main>
  );
}
