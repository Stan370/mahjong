"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

import {
  ActionBar,
  FontScalePicker,
  MahjongTile,
  SeatCard,
  type FontScale
} from "@mahjong/ui";

type SeatWind = "east" | "south" | "west" | "north";

interface RoomSnapshot {
  roomId: string;
  hostId: string;
  seats: Record<SeatWind, { wind: SeatWind; playerId?: string; playerName?: string; ready: boolean; fontScale?: FontScale }>;
  game?: {
    currentTurn: SeatWind;
    discards: Array<{ code: string }>;
    wallCount: number;
    phase: "lobby" | "playing" | "finished" | "charleston-deferred";
    myTiles: Array<{ code: string }>;
    result?: { winnerId: string; patternId?: string; status: "mahjong" | "invalid" };
  };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8787";

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId.toUpperCase();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState("Loading room...");
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
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
            payload: {
              roomId,
              playerId: joined.guestId
            }
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

    if (!fontScale) {
      return;
    }

    ensureJoined();

    return () => {
      mounted = false;
      socketRef.current?.close();
    };
  }, [fontScale, guestId, roomId]);

  const mySeat = snapshot
    ? (Object.values(snapshot.seats).find((seat) => seat.playerId === guestId)?.wind ?? null)
    : null;

  function send(type: string, payload: Record<string, unknown>) {
    socketRef.current?.send(JSON.stringify({ type, payload }));
  }

  function takeSeatAction(wind: SeatWind) {
    if (!guestId) {
      return;
    }
    send("takeSeat", { roomId, playerId: guestId, wind });
  }

  function toggleReadyAction() {
    if (!guestId) {
      return;
    }
    send("toggleReady", { roomId, playerId: guestId });
  }

  function startGameAction() {
    if (!guestId) {
      return;
    }
    send("startGame", { roomId, playerId: guestId });
  }

  function discardAction() {
    if (!guestId || !selectedTile) {
      return;
    }
    send("discardTile", { roomId, playerId: guestId, tileCode: selectedTile });
    setSelectedTile(null);
  }

  function declareMahjongAction() {
    if (!guestId) {
      return;
    }
    send("declareMahjong", { roomId, playerId: guestId });
  }

  function updateScale(nextValue: FontScale) {
    setFontScale(nextValue);
    window.localStorage.setItem("mahjong-font-scale", nextValue);
  }

  return (
    <main className={`page-shell scale-${fontScale.toLowerCase()}`}>
      <section className="room-header panel">
        <div>
          <p className="eyebrow">Private room</p>
          <h1>Room {roomId}</h1>
          <p className="helper-copy">Share this link to invite family: {inviteUrl}</p>
        </div>
        <div className="room-header-actions">
          <FontScalePicker value={fontScale} onChange={updateScale} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigator.clipboard.writeText(inviteUrl)}
          >
            Copy invite link
          </button>
        </div>
      </section>

      <section className="table-layout">
        <div className="seat-grid">
          {(["east", "south", "west", "north"] as SeatWind[]).map((wind) => {
            const seat = snapshot?.seats[wind];
            const isMine = seat?.playerId === guestId;
            const inTurn = snapshot?.game?.currentTurn === wind;
            return (
              <SeatCard
                key={wind}
                seat={wind.toUpperCase()}
                playerName={seat?.playerName}
                ready={seat?.ready}
                isTurn={inTurn}
                scale={fontScale}
                summary={seat?.playerId ? (isMine ? "You are seated here." : "Waiting at table.") : "Tap to sit here."}
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

        <section className="panel board-panel">
          <div className="board-topline">
            <div>
              <h2>Table state</h2>
              <p className="helper-copy">
                {snapshot?.game
                  ? `Wall ${snapshot.game.wallCount} tiles. Current turn: ${snapshot.game.currentTurn.toUpperCase()}.`
                  : "Waiting for four seated and ready players."}
              </p>
            </div>
            <span className="seat-badge">
              {snapshot?.game?.phase === "charleston-deferred"
                ? "Charleston deferred"
                : snapshot?.game?.phase ?? "lobby"}
            </span>
          </div>

          <div className="discard-river">
            {(snapshot?.game?.discards ?? []).map((tile, index) => (
              <MahjongTile key={`${tile.code}-${index}`} code={tile.code} scale={fontScale} />
            ))}
          </div>

          <div className="hand-zone">
            {(snapshot?.game?.myTiles ?? []).map((tile) => (
              <MahjongTile
                key={tile.code}
                code={tile.code}
                scale={fontScale}
                interactive={snapshot?.game?.currentTurn === mySeat}
                selected={selectedTile === tile.code}
                onClick={() => setSelectedTile(tile.code)}
              />
            ))}
          </div>

          <ActionBar
            actions={[
              {
                id: "ready",
                label: "Ready / Not ready",
                onClick: toggleReadyAction,
                disabled: !mySeat || snapshot?.game?.phase === "playing"
              },
              {
                id: "start",
                label: "Host start hand",
                onClick: startGameAction,
                disabled: guestId !== snapshot?.hostId || snapshot?.game?.phase === "playing"
              },
              {
                id: "discard",
                label: "Discard selected tile",
                onClick: discardAction,
                disabled: !selectedTile || snapshot?.game?.currentTurn !== mySeat
              },
              {
                id: "mahjong",
                label: "Declare Mahjong",
                onClick: declareMahjongAction,
                disabled: snapshot?.game?.phase !== "playing"
              }
            ]}
          />

          <div className="status-grid">
            <article className="status-card">
              <h3>Status</h3>
              <p>{status}</p>
            </article>
            <article className="status-card">
              <h3>Rule note</h3>
              <p>V0 supports a single American card snapshot, including joker-aware validation. Charleston is deferred.</p>
            </article>
            <article className="status-card">
              <h3>Result</h3>
              <p>
                {snapshot?.game?.result
                  ? `${snapshot.game.result.status} ${snapshot.game.result.patternId ?? ""}`.trim()
                  : "No winner yet."}
              </p>
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
