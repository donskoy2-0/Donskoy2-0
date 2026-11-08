const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

function getTurnstile() {
  if (globalThis.turnstile?.render && globalThis.turnstile?.reset) return globalThis.turnstile;
  return null;
}

function loadTurnstile() {
  const existing = getTurnstile();
  if (existing) return Promise.resolve(existing);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.dataset.entryTurnstile = "";
      script.onload = () => {
        const api = getTurnstile();
        if (api) resolve(api);
        else reject(new Error("TURNSTILE_API_UNAVAILABLE"));
      };
      script.onerror = () => reject(new Error("TURNSTILE_SCRIPT_UNAVAILABLE"));
      document.head.append(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

const CF_LANGUAGE = Object.freeze({ ru: "ru", en: "en", ua: "uk" });

// Purely pre-authority widget lifecycle: a HUMAN token is not consent.
// No localStorage, Story cursor, session, telemetry or automatic ENTRY_ACCEPT.
export function createEntryHuman(host, { onToken, onInvalid } = {}) {
  let api = null;
  let widget = null;
  let token = null;
  let generation = 0;
  let disposed = false;
  let lastSitekey = null;
  let lastLanguage = null;
  const phoneQuery = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(max-width: 639px)") : null;

  function handleViewportChange() {
    if (disposed || lastSitekey === null || lastLanguage === null) return;
    invalidate();
    void render(lastSitekey, lastLanguage).catch(() => invalidate());
  }
  phoneQuery?.addEventListener?.("change", handleViewportChange);

  function invalidate() {
    token = null;
    onInvalid?.();
  }

  async function render(sitekey, language) {
    if (disposed || typeof sitekey !== "string" || !sitekey.trim() ||
        !Object.hasOwn(CF_LANGUAGE, language)) {
      throw new Error("TURNSTILE_RENDER_CONFIGURATION_INVALID");
    }
    lastSitekey = sitekey;
    lastLanguage = language;
    const epoch = ++generation;
    invalidate();
    if (widget !== null) {
      api.remove(widget);
      widget = null;
    }
    const loaded = await loadTurnstile();
    if (disposed || generation !== epoch) return;
    api = loaded;
    // Mobile always uses the provider-supported 150px compact challenge;
    // desktop also falls back to compact if the host is narrower than 300px.
    const availableWidth = typeof host?.getBoundingClientRect === "function"
      ? host.getBoundingClientRect().width : null;
    const size = phoneQuery?.matches || (Number.isFinite(availableWidth) && availableWidth > 0 && availableWidth < 300)
      ? "compact" : "flexible";
    const options = {
      sitekey,
      action: "entry_accept",
      language: CF_LANGUAGE[language],
      theme: "dark",
      size,
      retry: "auto",
      "retry-interval": 8000,
      "response-field": false,
      callback(value) {
        if (disposed || generation !== epoch) return;
        if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
          invalidate();
          return;
        }
        token = value;
        onToken?.(value);
      },
      "expired-callback"() {
        if (disposed || generation !== epoch) return;
        invalidate();
        if (widget !== null) api.reset(widget);
      },
      "timeout-callback"() {
        if (disposed || generation !== epoch) return;
        invalidate();
        if (widget !== null) api.reset(widget);
      },
      "error-callback"() {
        if (!disposed && generation === epoch) invalidate();
        // Falsy: Cloudflare retains its native transient-error retry behavior.
        return false;
      },
      "unsupported-callback"() {
        if (!disposed && generation === epoch) invalidate();
      },
    };
    widget = api.render(host, options);
    if (widget === undefined || widget === null || widget === "") {
      widget = null;
      throw new Error("TURNSTILE_WIDGET_UNAVAILABLE");
    }
  }

  function currentToken() { return token; }

  function reset() {
    if (disposed) return;
    invalidate();
    if (api && widget !== null) api.reset(widget);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    token = null;
    phoneQuery?.removeEventListener?.("change", handleViewportChange);
    if (api && widget !== null) api.remove(widget);
    widget = null;
  }

  return Object.freeze({ render, currentToken, reset, dispose });
}
