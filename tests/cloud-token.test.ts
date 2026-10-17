import { afterAll, expect, mock, test } from "bun:test";

// The session token lives in the OS keyring (set_cloud_token / get_cloud_token),
// url + email in localStorage.
const keyring: { token: string | null; broken: boolean } = { token: null, broken: false };
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { token: string | null }) => {
    if (keyring.broken) throw new Error("KeyringUnavailable");
    if (cmd === "set_cloud_token") return void (keyring.token = args!.token);
    if (cmd === "get_cloud_token") return keyring.token;
    throw new Error(`unmocked invoke: ${cmd}`);
  },
}));

const store = new Map<string, string>();
const saved = { localStorage: (globalThis as any).localStorage, fetch: globalThis.fetch };
afterAll(() => Object.assign(globalThis, saved));
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const seen: (string | null)[] = [];
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  seen.push(new Headers(init.headers).get("Authorization"));
  if (url.endsWith("/auth/login")) return Response.json({ token: "fresh" });
  if (url.endsWith("/api/me")) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ ok: true });
}) as typeof fetch;

const cloudLib = await import("$lib/cloud");
const { api, cloud, loadCloudToken, login, logout } = cloudLib;
const stored = () => JSON.parse(store.get("bookie.cloud") ?? "null");

test("a legacy localStorage token moves to the keyring; keyring failure keeps it", async () => {
  store.set("bookie.cloud", JSON.stringify({ url: "http://s", email: "e", token: "old" }));
  keyring.broken = true;
  await loadCloudToken();
  expect(stored().token).toBe("old"); // not lost
  expect(cloud()?.token).toBe("old");

  keyring.broken = false;
  await loadCloudToken();
  expect(keyring.token).toBe("old");
  expect(stored()).toEqual({ url: "http://s", email: "e" });
  expect(cloud()).toEqual({ url: "http://s", email: "e", token: "old" });
});

test("login stores the token in the keyring only; boot reloads it; logout clears both", async () => {
  await login("http://s/", "e", "pw");
  expect(keyring.token).toBe("fresh");
  expect(stored()).toEqual({ url: "http://s", email: "e" });
  await api("/api/x");
  expect(seen.at(-1)).toBe("Bearer fresh");

  await logout();
  expect(keyring.token).toBeNull();
  expect(store.has("bookie.cloud")).toBe(false);
  expect(cloud()).toBeNull();
});

test("expired session (401 unauthorized) signs out", async () => {
  await login("http://s", "e", "pw");
  await loadCloudToken();
  expect(cloud()?.token).toBe("fresh");
  await expect(api("/api/me")).rejects.toThrow("Sitzung abgelaufen");
  expect(cloud()).toBeNull();
  await Bun.sleep(0);
  expect(keyring.token).toBeNull();
});

test("unreadable keyring on boot: signed out, flagged, account kept for the login form", async () => {
  store.set("bookie.cloud", JSON.stringify({ url: "http://s", email: "e" }));
  keyring.broken = true;
  await loadCloudToken();
  keyring.broken = false;
  expect(cloud()).toBeNull();
  expect(cloudLib.keyringError).toBe(true);
  expect(cloudLib.savedAccount()).toEqual({ url: "http://s", email: "e" });
});
