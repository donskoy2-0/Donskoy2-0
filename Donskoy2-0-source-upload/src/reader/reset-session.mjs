// Reader-local fresh start. Only runs after server confirms session revocation.
// Site cache/storage cleanup is best-effort; never pretend this wipes browser-wide data.
export async function resetCurrentSiteSession({
  request = globalThis.fetch,
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
  cacheStorage = globalThis.caches,
  location = globalThis.location,
} = {}) {
  const response = await request("/api/entry/reset", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("SESSION_RESET_UNAVAILABLE");
  try { local?.clear(); } catch {}
  try { session?.clear(); } catch {}
  try {
    if (cacheStorage?.keys && cacheStorage?.delete) {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map((key) => cacheStorage.delete(key)));
    }
  } catch {}
  location.replace("/");
}
