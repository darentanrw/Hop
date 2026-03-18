"use client";

import { useEffect, useState } from "react";

export function Countdown({ deadline }: { deadline: string }) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    function tick() {
      const ms = new Date(deadline).getTime() - Date.now();
      if (ms <= 0) {
        setDisplay("Expired");
        return;
      }
      const m = Math.floor(ms / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setDisplay(`${m}:${String(s).padStart(2, "0")}`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const expired = display === "Expired";

  return <span className={`countdown ${expired ? "expired" : ""}`}>{display}</span>;
}
