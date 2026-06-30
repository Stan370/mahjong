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
  const [status, setStatus] = useState("Choose how you'd like to play.");
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

  function saveName() {
    if (name.trim()) {
      window.localStorage.setItem("mahjong-guest-name", name.trim());
    }
  }

  async function createRoom() {
    if (!name.trim()) {
      setStatus("Enter your name before creating a room.");
      return;
    }

    saveName();
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
    window.localStorage.setItem("mahjong-font-scale", fontScale);
    router.push(`/room/${created.roomId}`);
  }

  function joinRoom() {
    if (!joinCode.trim()) {
      setStatus("Paste a room link or enter the room code.");
      return;
    }

    saveName();
    const roomId = joinCode.includes("/") ? joinCode.split("/").at(-1) ?? "" : joinCode.toUpperCase();
    router.push(`/room/${roomId}`);
  }

  function quickPlay() {
    if (!name.trim()) {
      setStatus("Enter your name first.");
      return;
    }
    saveName();
    router.push("/play");
  }

  return (
    <main className={`page-shell scale-${fontScale.toLowerCase()}`}>
      <section className="hero-card">
        <p className="eyebrow">American Mahjong</p>
        <h1>Play with family, learn at your pace.</h1>
        <p className="hero-copy">
          Built for large screens, large tiles, and one-click room sharing. No account required.
        </p>
        <FontScalePicker value={fontScale} onChange={persistScale} />
        <p className="helper-copy">{helperText}</p>
      </section>

      {/* Name input */}
      <section className="panel name-section">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Grandma Lin"
          />
        </label>
      </section>

      {/* Three modes */}
      <section className="mode-grid">
        <article className="panel mode-card mode-quick">
          <div className="mode-icon">🎮</div>
          <h2>Quick Play</h2>
          <p className="helper-copy">
            Jump straight in against 3 AI bots. Perfect for practice or a quick game.
          </p>
          <button type="button" className="primary-button" onClick={quickPlay} disabled={busy}>
            Play now
          </button>
        </article>

        <article className="panel mode-card mode-room">
          <div className="mode-icon">👨‍👩‍👧‍👦</div>
          <h2>Family Room</h2>
          <p className="helper-copy">
            Create a private room and share the link with family.
          </p>
          <button type="button" className="primary-button" onClick={createRoom} disabled={busy}>
            Create room
          </button>
        </article>

        <article className="panel mode-card mode-join">
          <div className="mode-icon">🔗</div>
          <h2>Join a Game</h2>
          <p className="helper-copy">
            Got an invite link or room code? Jump right in.
          </p>
          <label className="field">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="Paste link or code"
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
