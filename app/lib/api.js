/**
 * API helpers for the Inventory Hub frontend.
 * These call the Next.js API routes which proxy to Acumatica and Gmail.
 */

/** Fetch data from Acumatica via our backend proxy */
export async function fetchAcumatica({ type, warehouse, username, password }) {
  const resp = await fetch("/api/acumatica", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, warehouse, username, password }),
  });

  const json = await resp.json();

  if (!resp.ok) {
    throw new Error(json.error || "Acumatica request failed");
  }

  return json.data || [];
}

/** Create Gmail drafts via our backend proxy */
export async function createGmailDrafts(drafts) {
  const resp = await fetch("/api/gmail-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drafts }),
  });

  const json = await resp.json();

  if (!resp.ok) {
    throw new Error(json.error || "Gmail draft creation failed");
  }

  return json;
}

/** Save credentials to localStorage (private to this browser) */
export function saveCredentials(username, password) {
  try {
    localStorage.setItem("vetcove-creds", JSON.stringify({ username, password }));
  } catch {}
}

/** Load credentials from localStorage */
export function loadCredentials() {
  try {
    const raw = localStorage.getItem("vetcove-creds");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Clear credentials from localStorage */
export function clearCredentials() {
  try {
    localStorage.removeItem("vetcove-creds");
  } catch {}
}
