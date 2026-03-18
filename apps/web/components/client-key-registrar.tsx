"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../convex/_generated/api";
import { exportPublicKeyBase64 } from "../lib/crypto-browser";

export function ClientKeyRegistrar() {
  const registerClientKey = useMutation(api.mutations.registerClientKey);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        const publicKey = await exportPublicKeyBase64();
        await registerClientKey({ publicKey });
      } catch (error) {
        console.error("Unable to register client key", error);
      }
    })();
  }, [registerClientKey]);

  return null;
}
