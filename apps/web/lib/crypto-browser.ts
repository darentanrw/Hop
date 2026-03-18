"use client";

const DB_NAME = "hop-crypto";
const STORE_NAME = "keys";
const KEY_ID = "address-reveal";

type StoredKeyPair = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
};

async function openDb() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadPair(): Promise<StoredKeyPair | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(KEY_ID);
    request.onsuccess = () => resolve((request.result as StoredKeyPair | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function savePair(pair: StoredKeyPair) {
  const db = await openDb();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(pair, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

export async function ensureRevealKeyPair() {
  const existing = await loadPair();
  if (existing) return existing;

  const generated = (await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    false,
    ["encrypt", "decrypt"],
  )) as StoredKeyPair;

  await savePair(generated);
  return generated;
}

export async function exportPublicKeyBase64() {
  const pair = await ensureRevealKeyPair();
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return arrayBufferToBase64(spki);
}

export async function decryptEnvelope(ciphertext: string) {
  const pair = await ensureRevealKeyPair();
  const plaintext = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    pair.privateKey,
    base64ToArrayBuffer(ciphertext),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as {
    userId: string;
    displayName: string;
    address: string;
  };
}
