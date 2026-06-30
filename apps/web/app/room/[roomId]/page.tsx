"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  ActionBar,
  FontScalePicker,
  MahjongTile,
  SeatCard,
  prettifyTileCode,
  type FontScale
} from "@mahjong/ui";

type SeatWind = "east" | "south" | "west" | "north";
const SEAT_ORDER: SeatWind[] = ["east", "south", "west", "north"];

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
  seats: Record<SeatWind, { wind: SeatWind; playerId?: string; playerName?: string; ready: boolean; fontScale?: FontScale }>;
  game?: {
    currentTurn: SeatWind;
    discards: Array<{ code: string }>;
    wallCount: number;
    phase: "lobby" | "charleston" | "charleston-vote" | "awaiting-discard" | "claim-window" | "finished";
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

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId.toUpperCase();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState("Loading room...");
  const [selectedTiles, setSelectedTiles] = useState<Set<string>>(new Set());
  const [fontScale, setFontScale] = useState<FontScale>("M");
  const [guestId, setGuestId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const storedScale = window.localStorage.getItem("mahjong-font-scale");
    if (storedScale === "S" || storedScale === "M" || storedScale === "L") {
      setFontScale(storedScale);
    }
    setGuestId(window.localStorage.getItem("mahjong-guest-id") ?? "");
    setInviteUrl(window.location.href);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function ensureJoined() {
      const guestName = window.localStorage.getItem("mahjong-guest-name") ?? "";

      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId: guestId || undefined,
          name: guestName || "Guest Player",
          fontScale
        })
      });

      if (!response.ok) {
        setStatus("Room not found or backend unavailable.");
        return;
      }

      const joined = (await response.json()) as { guestId: string };
      window.localStorage.setItem("mahjong-guest-id", joined.guestId);
      setGuestId(joined.guestId);
      if (!guestName) {
        window.localStorage.setItem("mahjong-guest-name", "Guest Player");
      }

      const initial = await fetch(`${API_BASE_URL}/api/rooms/${roomId}?playerId=${joined.guestId}`);
      const nextSnapshot = (await initial.json()) as RoomSnapshot;
      if (mounted) {
        setSnapshot(nextSnapshot);
        setStatus("Connected to room.");
      }

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "joinRoom",
            payload: { roomId, playerId: joined.guestId }
          })
        );
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as { type: string; payload: unknown };
        if (message.type === "snapshot") {
          setSnapshot(message.payload as RoomSnapshot);
        }
        if (message.type === "error") {
          const payload = message.payload as { message: string };
          setStatus(payload.message);
        }
      };

      socket.onclose = () => {
        setStatus("Disconnected. Refresh to reconnect.");
      };
    }

    if (!fontScale) return;
    ensureJoined();

    return () => {
      mounted = false;
      socketRef.current?.close();
    };
  }, [fontScale, guestId, roomId]);

  const mySeat = snapshot
    ? (Object.values(snapshot.seats).find((seat) => seat.playerId === guestId)?.wind ?? null)
    : null;

  const isMyTurn = snapshot?.game?.currentTurn === mySeat;
  const phase = snapshot?.game?.phase ?? "lobby";

  function send(type: string, payload: Record<string, unknown>) {
    socketRef.current?.send(JSON.stringify({ type, payload }));
  }

  // --- Action handlers ---

  function takeSeatAction(wind: SeatWind) {
    if (!guestId) return;
    send("takeSeat", { roomId, playerId: guestId, wind });
  }

  function toggleReadyAction() {
    if (!guestId) return;
    send("toggleReady", { roomId, playerId: guestId });
  }

  function startGameAction() {
    if (!guestId) return;
    send("startGame", { roomId, playerId: guestId });
  }

  function toggleTileSelection(code: string) {
    setSelectedTiles((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        if (phase === "charleston") {
          if (next.size >= 3) return prev;
          next.add(code);
        } else {
          next.clear();
          next.add(code);
        }
      }
      return next;
    });
  }

  function discardAction() {
    if (!guestId || selectedTiles.size !== 1) return;
    const tileCode = [...selectedTiles][0];
    send("discardTile", { roomId, playerId: guestId, tileCode });
    setSelectedTiles(new Set());
  }

  function declareMahjongAction() {
    if (!guestId) return;
    send("declareMahjong", { roomId, playerId: guestId });
  }

  function submitClaimAction(claimType: "pong" | "kong" | "mahjong") {
    if (!guestId) return;
    send("submitClaim", { roomId, playerId: guestId, claimType });
  }

  function passClaimAction() {
    if (!guestId) return;
    send("passClaim", { roomId, playerId: guestId });
  }

  function submitCharlestonPassAction() {
    if (!guestId) return;
    const tileCodes = [...selectedTiles];
    send("submitCharlestonPass", { roomId, playerId: guestId, tileCodes });
    setSelectedTiles(new Set());
  }

  function submitCharlestonVoteAction(wantSecondRound: boolean) {
    if (!guestId) return;
    send("submitCharlestonVote", { roomId, playerId: guestId, wantSecondRound });
  }

  function updateScale(nextValue: FontScale) {
    setFontScale(nextValue);
    window.localStorage.setItem("mahjong-font-scale", nextValue);
  }

  // --- Derived UI state ---

  const charlestonInfo = snapshot?.game?.charleston;
  const claimWindow = snapshot?.game?.claimWindow;
  const canClaim = claimWindow && mySeat && claimWindow.discardedBy !== mySeat;
  const gameResult = snapshot?.game?.result;
  const myTiles = snapshot?.game?.myTiles ?? [];
  const discards = snapshot?.game?.discards ?? [];
  const wallCount = snapshot?.game?.wallCount ?? 0;

  // Determine opponent positions relative to mySeat
  const myIdx = mySeat ? SEAT_ORDER.indexOf(mySeat) : 0;
  const rightSeat = SEAT_ORDER[(myIdx + 1) % 4];
  const acrossSeat = SEAT_ORDER[(myIdx + 2) % 4];
  const leftSeat = SEAT_ORDER[(myIdx + 3) % 4];

  function oppInfo(wind: SeatWind) {
    const seat = snapshot?.seats[wind];
    const melds = snapshot?.game?.exposedMelds?.[wind] ?? [];
    const inTurn = snapshot?.game?.currentTurn === wind;
    const tileCount = 13 - melds.reduce((s, m) => s + m.tiles.length, 0) + (melds.length > 0 ? melds.length : 0);
    return { name: seat?.playerName ?? "Waiting...", melds, inTurn, tileCount: Math.max(tileCount, 0) };
  }

  const oppRight = oppInfo(rightSeat);
  const oppAcross = oppInfo(acrossSeat);
  const oppLeft = oppInfo(leftSeat);

  function renderBackTiles(count: number) {
    return Array.from({ length: Math.min(count, 14) }, (_, i) => (
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

  // If game has not started, show the lobby UI
  if (!snapshot?.game) {
    return (
      <main className={`page-shell room-page scale-${fontScale.toLowerCase()}`}>
        <section className="room-header panel">
          <div>
            <p className="eyebrow">Family Room</p>
            <h1>{roomId}</h1>
            <p className="helper-copy">Share this link: {inviteUrl}</p>
          </div>
          <div className="room-header-actions">
            <FontScalePicker value={fontScale} onChange={updateScale} />
            <button type="button" className="secondary-button" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              📋 Copy link
            </button>
          </div>
        </section>

        <div className="seat-grid">
          {SEAT_ORDER.map((wind) => {
            const seat = snapshot?.seats[wind];
            const isMine = seat?.playerId === guestId;
            return (
              <SeatCard
                key={wind}
                seat={wind.toUpperCase()}
                playerName={seat?.playerName}
                ready={seat?.ready}
                scale={fontScale}
                summary={seat?.playerId ? (isMine ? "You" : "In lobby") : "Open seat"}
                action={
                  !seat?.playerId ? (
                    <button type="button" className="secondary-button" onClick={() => takeSeatAction(wind)}>
                      Sit here
                    </button>
                  ) : null
                }
              />
            );
          })}
        </div>

        <ActionBar
          actions={[
            {
              id: "ready",
              label: snapshot?.seats[mySeat!]?.ready ? "Ready!" : "Not ready",
              onClick: toggleReadyAction,
              disabled: !mySeat
            },
            {
              id: "start",
              label: "Start Game",
              onClick: startGameAction,
              disabled: guestId !== snapshot?.hostId
            }
          ]}
        />
        
        <div className="status-grid">
          <article className="status-card panel">
            <h3>Status</h3>
            <p>{status}</p>
          </article>
        </div>
      </main>
    );
  }

  // If game has started, show the green table UI
  return (
    <main className={`play-page scale-${fontScale.toLowerCase()}`}>
      {/* ====== TABLE ====== */}
      <div className="table-area">
        {/* Top opponent (across) */}
        <div className="opp-top opp-slot">
          <span className={`opp-label ${oppAcross.inTurn ? "is-turn" : ""}`}>
            {oppAcross.name} ({oppAcross.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(oppAcross.tileCount)}</div>
          {renderOppMelds(oppAcross.melds)}
        </div>

        {/* Left opponent */}
        <div className="opp-left opp-slot">
          <span className={`opp-label ${oppLeft.inTurn ? "is-turn" : ""}`}>
            {oppLeft.name} ({oppLeft.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(oppLeft.tileCount)}</div>
          {renderOppMelds(oppLeft.melds)}
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
          <span className={`opp-label ${oppRight.inTurn ? "is-turn" : ""}`}>
            {oppRight.name} ({oppRight.tileCount} tiles)
          </span>
          <div className="opp-tiles">{renderBackTiles(oppRight.tileCount)}</div>
          {renderOppMelds(oppRight.melds)}
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
            onClick={submitCharlestonPassAction}
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
            <button type="button" className="primary-button" onClick={() => submitCharlestonVoteAction(true)}>
              ✅ Yes
            </button>
            <button type="button" className="secondary-button" onClick={() => submitCharlestonVoteAction(false)}>
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
              <button type="button" className="claim-button claim-pong" onClick={() => submitClaimAction("pong")}>Pong</button>
              <button type="button" className="claim-button claim-kong" onClick={() => submitClaimAction("kong")}>Kong</button>
              <button type="button" className="claim-button claim-mahjong" onClick={() => submitClaimAction("mahjong")}>Mahjong!</button>
              <button type="button" className="claim-button claim-pass" onClick={passClaimAction}>Pass</button>
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
              onClick={() => toggleTileSelection(tile.code)}
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
            onClick: declareMahjongAction,
            disabled: phase !== "awaiting-discard" || !isMyTurn
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
            {guestId === snapshot?.hostId && (
              <button type="button" className="primary-button" onClick={() => window.location.reload()}>
                Close Room
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
