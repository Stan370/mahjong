"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { FontScalePicker, type FontScale } from "@mahjong/ui";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function loadStoredScale(): FontScale {
  if (typeof window === "undefined") {
    return "M";
  }

  const stored = window.localStorage.getItem("mahjong-font-scale");
  return stored === "S" || stored === "M" || stored === "L" ? stored : "M";
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [fontScale, setFontScale] = useState<FontScale>(loadStoredScale);
  const [status, setStatus] = useState("Create a room or join a family table.");
  const [busy, setBusy] = useState(false);

  const helperText = useMemo(() => {
    if (fontScale === "L") {
      return "Large text mode keeps every tile and button readable from across the table.";
    }
    if (fontScale === "S") {
      return "Small text mode fits more content while keeping the same high-contrast controls.";
    }
    return "Medium text mode balances readability and table space.";
  }, [fontScale]);

  const persistScale = (nextValue: FontScale) => {
    setFontScale(nextValue);
    window.localStorage.setItem("mahjong-font-scale", nextValue);
  };

  async function createRoom() {
    if (!name.trim()) {
      setStatus("Enter your name before creating a room.");
      return;
    }

    setBusy(true);
    setStatus("Creating room...");

    const response = await fetch(`${API_BASE_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, fontScale })
    });

    setBusy(false);
    if (!response.ok) {
      setStatus("Could not create room. Check that the realtime service is running.");
      return;
    }

    const created = (await response.json()) as { roomId: string; guestId: string };
    window.localStorage.setItem("mahjong-guest-id", created.guestId);
    window.localStorage.setItem("mahjong-guest-name", name.trim());
    window.localStorage.setItem("mahjong-font-scale", fontScale);
    router.push(`/room/${created.roomId}`);
  }

  function joinRoom() {
    if (!joinCode.trim()) {
      setStatus("Paste a room link or enter the room code.");
      return;
    }

    const roomId = joinCode.includes("/") ? joinCode.split("/").at(-1) ?? "" : joinCode.toUpperCase();
    router.push(`/room/${roomId}`);
  }

  return (
    <main className={`page-shell scale-${fontScale.toLowerCase()}`}>
      <section className="hero-card">
        <p className="eyebrow">American Mahjong MVP</p>
        <h1>Play with family, not with a confusing lobby.</h1>
        <p className="hero-copy">
          Built for large screens, large tiles, and one-click room sharing. No account required to sit
          down and play.
        </p>
        <FontScalePicker value={fontScale} onChange={persistScale} />
        <p className="helper-copy">{helperText}</p>
      </section>

      <section className="form-grid">
        <article className="panel">
          <h2>Create a private room</h2>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Grandma Lin" />
          </label>
          <button type="button" className="primary-button" onClick={createRoom} disabled={busy}>
            Create room
          </button>
        </article>

        <article className="panel">
          <h2>Join from a shared link</h2>
          <label className="field">
            <span>Room link or code</span>
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="Paste a link or enter ABC123"
            />
          </label>
          <button type="button" className="primary-button" onClick={joinRoom}>
            Join room
          </button>
        </article>
      </section>

      <section className="panel status-panel" aria-live="polite">
        {status}
      </section>
    </main>
  );
}
