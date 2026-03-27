"use client";

import dynamic from "next/dynamic";

const ClientKeyRegistrar = dynamic(
  () =>
    import("./client-key-registrar").then((module) => ({
      default: module.ClientKeyRegistrar,
    })),
  {
    loading: () => null,
    ssr: false,
  },
);

const PwaCoachmark = dynamic(
  () =>
    import("./pwa-coachmark").then((module) => ({
      default: module.PwaCoachmark,
    })),
  {
    loading: () => null,
    ssr: false,
  },
);

const LocalQaPanel = dynamic(
  () =>
    import("./local-qa-panel").then((module) => ({
      default: module.LocalQaPanel,
    })),
  {
    loading: () => null,
    ssr: false,
  },
);

const localQaEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_QA === "true";

export function AppShellEnhancements() {
  return (
    <>
      <ClientKeyRegistrar />
      <PwaCoachmark />
      {localQaEnabled ? <LocalQaPanel /> : null}
    </>
  );
}
