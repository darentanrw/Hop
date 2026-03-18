export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = globalThis.atob(normalized);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
