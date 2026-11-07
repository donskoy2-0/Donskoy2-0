export const AUDIO_ASSETS = Object.freeze({
  L3_KEY: "/media/audio/l3-key.mp3",
  PHONE_0257: "/media/audio/phone-0257.mp3",
  CHAIN_LATCH: "/media/audio/chain-latch.mp3",
  DREAM_HORROR: "/media/audio/dream-horror.mp3",
  SYSTEM_ERROR: "/media/audio/system-error.mp3",
  DRY_CLICK: "/media/audio/dry-click.mp3",
  GUN_DRY: "/media/audio/gun-dry.mp3",
  BOMB_1_DISTANT: "/media/audio/bomb-1-distant.mp3",
  BOMB_2_CLOSE: "/media/audio/bomb-2-close.mp3",
  GUN_BURST: "/media/audio/gun-burst.mp3",
  HORSE_NEIGH: "/media/audio/horse-neigh.mp3",
  CLOCK: "/media/audio/clock.mp3",
});

const PRELOAD_PATHS = Object.freeze([...new Set(Object.values(AUDIO_ASSETS))]);

function defaultAudioContextCtor() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
}

function defaultFetch(...args) {
  if (typeof globalThis.fetch !== "function") throw new Error("FETCH_UNAVAILABLE");
  return globalThis.fetch(...args);
}

export function createAudioSession({
  getAudioContextCtor = defaultAudioContextCtor,
  fetchImpl = defaultFetch,
  documentObject = globalThis.document ?? null,
  windowObject = globalThis.window ?? null,
  logger = globalThis.console ?? null,
} = {}) {
  let context = null;
  let master = null;
  let active = false;
  let capabilityUnavailable = false;
  let capabilityWarned = false;
  let resumeWarned = false;
  let primed = false;
  let recoveryInstalled = false;

  const decodedByPath = new Map();
  const loadingByPath = new Map();
  const unavailablePaths = new Set();
  const warnedPaths = new Set();

  function warnOnce(kind, key, error) {
    if (kind === "MEDIA_AUDIO_CONTEXT_UNAVAILABLE") {
      if (capabilityWarned) return;
      capabilityWarned = true;
    } else if (kind === "MEDIA_AUDIO_RESUME_FAILED") {
      if (resumeWarned) return;
      resumeWarned = true;
    } else if (key) {
      const warningKey = `${kind}:${key}`;
      if (warnedPaths.has(warningKey)) return;
      warnedPaths.add(warningKey);
    }
    logger?.warn?.(kind, key ?? "AUDIO", error);
  }

  function ensureContextFromGesture() {
    if (capabilityUnavailable) return null;
    if (context) return context;

    const AudioContextCtor = getAudioContextCtor?.();
    if (typeof AudioContextCtor !== "function") {
      capabilityUnavailable = true;
      warnOnce("MEDIA_AUDIO_CONTEXT_UNAVAILABLE", null, new Error("WEB_AUDIO_UNSUPPORTED"));
      return null;
    }

    try {
      context = new AudioContextCtor();
      master = context.createGain();
      master.connect(context.destination);
      return context;
    } catch (error) {
      capabilityUnavailable = true;
      context = null;
      master = null;
      warnOnce("MEDIA_AUDIO_CONTEXT_UNAVAILABLE", null, error);
      return null;
    }
  }

  function primeFromGesture() {
    if (!context || primed) return;
    primed = true;
    try {
      const source = context.createBufferSource();
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.buffer = context.createBuffer(1, 1, context.sampleRate || 22_050);
      source.connect(silentGain);
      silentGain.connect(context.destination);
      source.onended = () => {
        try { source.disconnect(); } catch {}
        try { silentGain.disconnect(); } catch {}
      };
      source.start(0);
    } catch (error) {
      warnOnce("MEDIA_AUDIO_CONTEXT_UNAVAILABLE", null, error);
    }
  }

  function startPreloadIfReady() {
    if (!active || !context || context.state === "closed") return;
    for (const path of PRELOAD_PATHS) void preloadPath(path);
  }

  function requestResume() {
    if (!context || context.state === "running" || context.state === "closed") return;
    try {
      const result = context.resume();
      if (result?.then) {
        void result.then(() => {
          if (context?.state === "running") {
            resumeWarned = false;
            startPreloadIfReady();
          }
        }).catch((error) => warnOnce("MEDIA_AUDIO_RESUME_FAILED", null, error));
      }
    } catch (error) {
      warnOnce("MEDIA_AUDIO_RESUME_FAILED", null, error);
    }
  }

  async function preloadPath(path) {
    if (!path || unavailablePaths.has(path)) return null;
    if (decodedByPath.has(path)) return decodedByPath.get(path);
    if (!context || context.state === "closed") return null;
    if (loadingByPath.has(path)) return loadingByPath.get(path);

    const pending = (async () => {
      try {
        const response = await fetchImpl(path, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response?.ok) throw new Error(`HTTP_${response?.status ?? "UNAVAILABLE"}`);
        const bytes = await response.arrayBuffer();
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) throw new Error("EMPTY_AUDIO_ASSET");
        const decoded = await context.decodeAudioData(bytes.slice(0));
        if (!decoded) throw new Error("AUDIO_DECODE_EMPTY");
        decodedByPath.set(path, decoded);
        return decoded;
      } catch (error) {
        unavailablePaths.add(path);
        warnOnce("MEDIA_AUDIO_ASSET_UNAVAILABLE", path, error);
        return null;
      } finally {
        loadingByPath.delete(path);
      }
    })();

    loadingByPath.set(path, pending);
    return pending;
  }

  function armFromUserGesture() {
    try {
      const current = ensureContextFromGesture();
      if (!current) return false;
      primeFromGesture();
      if (current.state === "suspended" || current.state === "interrupted") requestResume();
      if (current.state === "running") startPreloadIfReady();
      return true;
    } catch (error) {
      warnOnce("MEDIA_AUDIO_CONTEXT_UNAVAILABLE", null, error);
      return false;
    }
  }

  function recover() {
    if (!active || !context || context.state === "closed") return false;
    if (context.state === "running") {
      startPreloadIfReady();
      return true;
    }
    if (context.state === "suspended" || context.state === "interrupted") requestResume();
    return false;
  }

  const READER_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);

  function onTrustedReaderGesture(event) {
    if (!active || event?.isTrusted !== true) return;
    const target = event.target;
    if (!target) return;

    const inReader = typeof target.closest === "function" && target.closest(".reader-shell");
    if (event.type === "keydown") {
      if (event.ctrlKey || event.metaKey || event.altKey || !READER_SCROLL_KEYS.has(event.key)) return;
      // PageDown/Space can scroll Reader even if the focused node is BODY,
      // rather than a focusable child of the Reader itself.
      const onReaderBody = (target === documentObject?.body || target === documentObject?.documentElement)
        && documentObject?.querySelector?.(".reader-shell");
      if (!inReader && !onReaderBody) return;
    } else if (!inReader) {
      return;
    }

    armFromUserGesture();
  }

  function onVisibilityChange() {
    if (documentObject?.visibilityState === "visible") recover();
  }

  function installRecovery() {
    if (recoveryInstalled) return;
    recoveryInstalled = true;
    // Only genuine Reader gestures may unlock Web Audio after a cold RELOAD.
    // Touchstart covers mobile scroll before click; pointerdown covers mouse/pen;
    // keydown covers keyboard scrolling. No synthetic scroll/untrusted event.
    documentObject?.addEventListener?.("pointerdown", onTrustedReaderGesture, { capture: true, passive: true });
    documentObject?.addEventListener?.("touchstart", onTrustedReaderGesture, { capture: true, passive: true });
    documentObject?.addEventListener?.("keydown", onTrustedReaderGesture, true);
    documentObject?.addEventListener?.("click", onTrustedReaderGesture, true);
    documentObject?.addEventListener?.("visibilitychange", onVisibilityChange);
    windowObject?.addEventListener?.("focus", recover);
  }

  function activate() {
    active = true;
    installRecovery();
    if (context?.state === "running") startPreloadIfReady();
    else recover();
  }

  function playPath(path, cueId = path) {
    try {
      if (!active || !path || capabilityUnavailable || unavailablePaths.has(path)) return false;
      if (!context || !master || context.state === "closed") return false;
      if (context.state !== "running") {
        if (context.state === "suspended" || context.state === "interrupted") requestResume();
        return false;
      }

      const buffer = decodedByPath.get(path);
      if (!buffer) {
        void preloadPath(path);
        return false;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.onended = () => {
        try { source.disconnect(); } catch {}
      };
      source.start(0);
      return true;
    } catch (error) {
      warnOnce("MEDIA_AUDIO_PLAY_FAILED", cueId, error);
      return false;
    }
  }

  // The visible dream image has a narrow audio cue window. A not-yet-decoded
  // asset may finish loading shortly after the image is displayed; play it
  // within that window, but never replay after the image/scene was abandoned.
  function playPathWhenReady(path, cueId = path, signal = null) {
    if (playPath(path, cueId)) return true;
    if (!active || signal?.aborted || !context || context.state !== "running" || unavailablePaths.has(path)) return false;
    const deadline = Date.now() + 900;
    void preloadPath(path).then((buffer) => {
      if (!buffer || !active || signal?.aborted || Date.now() > deadline || context?.state !== "running") return;
      playPath(path, cueId);
    }).catch(() => {});
    return false;
  }

  return Object.freeze({
    activate,
    armFromUserGesture,
    recover,
    playPath,
    playPathWhenReady,
  });
}

export const audioSession = createAudioSession();
