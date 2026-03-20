"use client";

import { useAction, useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../convex/_generated/api";

export function DashboardBackgroundSync() {
  const runMatching = useAction(api.mutations.runMatching);
  const advanceCurrentGroupLifecycle = useMutation(api.trips.advanceCurrentGroupLifecycle);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;

    void (async () => {
      try {
        await runMatching({});
        await advanceCurrentGroupLifecycle({});
      } catch (error) {
        console.error("Dashboard background sync failed.", error);
      }
    })();
  }, [advanceCurrentGroupLifecycle, runMatching]);

  return null;
}
