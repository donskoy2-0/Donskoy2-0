import { audioSession } from "/assets/reader/audio-session.mjs";

// Discourage casual inspection without touching Reader navigation or text input.
const INSPECTOR_KEYS = new Set(["i", "j", "c", "k", "m"]);
const EDITABLE_TARGETS = "input, textarea, [contenteditable]";

document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest(EDITABLE_TARGETS)) return;
  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing) return;
  const key = event.key.toLowerCase();
  const inspector = (
    (event.ctrlKey && event.shiftKey && !event.altKey && INSPECTOR_KEYS.has(key)) ||
    (event.metaKey && event.altKey && !event.ctrlKey && INSPECTOR_KEYS.has(key))
  );
  const editable = event.target instanceof Element && event.target.closest(EDITABLE_TARGETS);
  const sourceView = !editable && key === "u" && (event.ctrlKey || event.metaKey) &&
    !event.shiftKey && !event.altKey;
  if (key === "f12" || inspector || sourceView) event.preventDefault();
}, { capture: true });

const MODEL_URL = "/assets/entry-copy.v1.json";
const COVER_HOLD_MS = 3_000;
const COVER_EXIT_MS = 300;
const COVER_REDUCED_EXIT_MS = 80;
const COVER_LOAD_TIMEOUT_MS = 10_000;

const shell = document.querySelector("#shell");
const selector = document.querySelector("#language-selector");
const protocol = document.querySelector("#entry-protocol");
const subtitle = document.querySelector("#entry-subtitle");
const heading = document.querySelector("#entry-heading");
const copy = document.querySelector("#entry-copy");
const status = document.querySelector("#entry-status");
const button = document.querySelector("#entry-accept");
const humanHost = document.querySelector("#entry-human");
const turnstileHost = document.querySelector("#entry-turnstile");
const cover = document.querySelector("#outer-cover");
const coverArt = document.querySelector("#outer-cover-art");
const POST_OUTER_ROUTE = location.pathname === "/epilogue/" || location.pathname === "/epilogue";
let model = null;
let language = null;
let busy = false;
let resumeUnavailable = false;
let runtimeModulePromise = null;
let activeReaderRuntime = null;
let foregroundSyncPromise = null;
let humanMode = null;
let humanSitekey = null;
let humanToken = null;
let humanClientPromise = null;
let humanRenderGeneration = 0;

function presentOuterCover(root, artwork) {
  if (!(root instanceof HTMLElement) || !(artwork instanceof HTMLImageElement)) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const started = performance.now();
  let loaded = null;
  let exiting = false;
  let finished = false;
  let loadTimer = 0;
  let holdTimer = 0;
  let exitTimer = 0;

  const cleanup = () => {
    clearTimeout(loadTimer);
    clearTimeout(holdTimer);
    clearTimeout(exitTimer);
    root.removeEventListener("click", beginExit);
    root.removeEventListener("keydown", onKey);
    root.removeEventListener("transitionend", onEnd);
    artwork.removeEventListener("load", onLoad);
    artwork.removeEventListener("error", finish);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  function finish() {
    if (finished) return;
    finished = true;
    cleanup();
    root.remove();
  }
  function onEnd(event) {
    if (event.target === root && event.propertyName === "opacity") finish();
  }
  function beginExit() {
    if (exiting || finished) return;
    exiting = true;
    clearTimeout(loadTimer);
    clearTimeout(holdTimer);
    root.dataset.exiting = "";
    exitTimer = setTimeout(finish, reduced ? COVER_REDUCED_EXIT_MS + 100 : COVER_EXIT_MS + 100);
  }
  function onLoad() {
    if (loaded !== null || exiting || finished) return;
    loaded = performance.now();
    clearTimeout(loadTimer);
    holdTimer = setTimeout(beginExit, COVER_HOLD_MS);
  }
  function onKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    beginExit();
  }
  function onVisibility() {
    if (document.visibilityState !== "visible") return;
    const now = performance.now();
    if (loaded === null) {
      if (now - started >= COVER_LOAD_TIMEOUT_MS) finish();
      return;
    }
    const elapsed = now - loaded;
    if (elapsed >= COVER_HOLD_MS + COVER_EXIT_MS) finish();
    else if (elapsed >= COVER_HOLD_MS) beginExit();
  }

  root.addEventListener("click", beginExit);
  root.addEventListener("keydown", onKey);
  root.addEventListener("transitionend", onEnd);
  artwork.addEventListener("load", onLoad, { once: true });
  artwork.addEventListener("error", finish, { once: true });
  document.addEventListener("visibilitychange", onVisibility);
  loadTimer = setTimeout(finish, COVER_LOAD_TIMEOUT_MS);
  if (artwork.complete) queueMicrotask(artwork.naturalWidth > 0 ? onLoad : finish);
}

function assertModel(value) {
  if (value?.schema !== "donskoy.pages-entry-runtime.v1" || value?.boundary !== "CLIENT_PRESENTATION_NO_AUTHORITY") {
    throw new Error("invalid runtime model");
  }
  if (
    JSON.stringify(value.languages) !== JSON.stringify(["ru", "en", "ua"]) ||
    value.default_language !== "en" ||
    value.entry_accept?.semantic_id !== "ENTRY_ACCEPT" ||
    value.entry_accept?.shell_enabled !== true ||
    value.first_story?.cursor_scene_id !== "ch01.earth.packet.001"
  ) {
    throw new Error("invalid Entry model");
  }
}

function paragraph(text) {
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

function stateText(name) {
  return model?.entry_states?.[name]?.[language] || name.toUpperCase();
}

function humanReady() {
  return humanMode === "manual" || (humanMode === "turnstile" && typeof humanToken === "string" && humanToken.length > 0);
}

function entryStatusName() {
  if (resumeUnavailable) return "session_check_unavailable_reload";
  if (humanMode === "turnstile" && !humanReady()) return "human_required";
  return humanMode === "manual" || humanReady() ? "ready" : "entry_unavailable";
}

function humanClient() {
  if (!humanClientPromise) {
    humanClientPromise = import("/assets/entry-human.mjs").then(({ createEntryHuman }) =>
      createEntryHuman(turnstileHost, {
        onToken(token) {
          if (humanMode !== "turnstile" || busy) return;
          humanToken = token;
          lockControls(false);
          status.textContent = stateText("ready");
        },
        onInvalid() {
          humanToken = null;
          lockControls(busy);
          if (language && !busy) status.textContent = stateText("human_required");
        },
      }),
    ).catch((error) => {
      humanClientPromise = null;
      throw error;
    });
  }
  return humanClientPromise;
}

function renderHumanForLanguage(next) {
  if (humanMode !== "turnstile") return;
  const generation = ++humanRenderGeneration;
  humanToken = null;
  humanHost.hidden = false;
  lockControls(busy);
  void (async () => {
    const client = await humanClient();
    if (generation !== humanRenderGeneration || language !== next) return;
    await client.render(humanSitekey, next);
  })().catch((error) => {
    if (generation !== humanRenderGeneration) return;
    console.error("Cloudflare HUMAN widget unavailable", error);
    humanToken = null;
    status.textContent = stateText("entry_unavailable");
    lockControls(busy);
  });
}

function lockControls(locked) {
  busy = locked;
  button.disabled = locked || resumeUnavailable || !language || protocol.hidden || !humanReady();
  for (const control of selector.querySelectorAll("button[data-language]")) control.disabled = locked;
}

function renderLanguage(next) {
  language = next;
  const entry = model.entry[next];
  if (!entry) throw new Error(`missing Entry copy for ${next}`);
  document.documentElement.lang = next;
  subtitle.textContent = entry.subtitle;
  heading.textContent = entry.heading;
  copy.replaceChildren(...entry.paragraphs.map(paragraph));
  button.textContent = model.entry_accept.action[next];
  status.textContent = stateText(entryStatusName());
  protocol.hidden = false;
  button.disabled = busy || resumeUnavailable || !humanReady();
  renderHumanForLanguage(next);
  for (const control of selector.querySelectorAll("button[data-language]")) {
    control.setAttribute("aria-pressed", String(control.dataset.language === next));
  }
}

function renderSelector() {
  selector.replaceChildren(...model.ui_order.map((id) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "language__button";
    control.dataset.language = id;
    control.textContent = model.ui_labels[id];
    control.setAttribute("aria-pressed", "false");
    control.addEventListener("click", () => renderLanguage(id));
    return control;
  }));
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function configureHuman() {
  const { response, body } = await jsonFetch("/api/entry/human-config");
  if (!response.ok || !body || !["manual", "turnstile"].includes(body.mode)) {
    throw new Error("HUMAN_CONFIG_UNAVAILABLE");
  }
  if (body.mode === "turnstile" && (typeof body.sitekey !== "string" || !body.sitekey.trim())) {
    throw new Error("TURNSTILE_SITE_KEY_UNAVAILABLE");
  }
  humanMode = body.mode;
  humanSitekey = body.mode === "turnstile" ? body.sitekey : null;
  humanHost.hidden = true;
  // A language may have been selected while session/config I/O was pending.
  // Materialize its HUMAN mode immediately; do not require a second click.
  if (language && !protocol.hidden) renderLanguage(language);
}

function readerStateChanged(local, remote) {
  if (!local || !remote) return true;
  return [
    "run_id",
    "content_release_id",
    "cursor_scene_id",
    "language",
    "revision",
    "terminal_phase",
    "bootstrap_applied",
    "first_story_mounted",
  ].some((key) => local[key] !== remote[key]);
}

async function reconcileReaderOnForeground() {
  if (!activeReaderRuntime || POST_OUTER_ROUTE || location.pathname === "/epilogue/" || location.pathname === "/epilogue") return;
  if (document.visibilityState !== "visible") return;
  if (foregroundSyncPromise) return foregroundSyncPromise;

  const reader = activeReaderRuntime;
  const observedState = { ...reader.state };
  foregroundSyncPromise = (async () => {
    const { response, body } = await jsonFetch("/api/entry/resume", { method: "POST", body: "{}" });
    if (!response.ok || !body?.state) return;
    // A foreground response can arrive after Reader commits an advance, rewind,
    // or restart. Never reconcile against a stale pre-transition observation.
    if (activeReaderRuntime !== reader || reader.busy || readerStateChanged(observedState, reader.state)) return;
    if (readerStateChanged(reader.state, body.state)) await reader.reconcile();
  })().catch((error) => {
    console.error("Reader foreground reconciliation failed", error);
  }).finally(() => {
    foregroundSyncPromise = null;
  });

  return foregroundSyncPromise;
}

function onReaderForeground() {
  if (document.visibilityState === "visible") void reconcileReaderOnForeground();
}

window.addEventListener("focus", onReaderForeground);
document.addEventListener("visibilitychange", onReaderForeground);

function readerRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import("/assets/runtime/reader-runtime.mjs").catch((error) => {
      runtimeModulePromise = null;
      throw error;
    });
  }
  return runtimeModulePromise;
}

function restoreEntryShell(nextLanguage) {
  activeReaderRuntime = null;
  if (!shell.isConnected) document.body.replaceChildren(shell);
  lockControls(false);
  renderLanguage(nextLanguage);
}

async function handoff(state, { settled = false } = {}) {
  status.textContent = stateText("handoff");
  audioSession.activate();
  const { startReaderRuntime } = await readerRuntimeModule();
  activeReaderRuntime = await startReaderRuntime({ model, state, settledInitial: settled });
}

async function resume() {
  status.textContent = stateText("checking_session");
  let response;
  let body;
  try {
    ({ response, body } = await jsonFetch("/api/entry/resume", { method: "POST", body: "{}" }));
  } catch (error) {
    // A failed session check must not disable the language chooser or hide its error.
    console.error("Entry session check failed", error);
    resumeUnavailable = true;
    lockControls(false);
    status.textContent = stateText("session_check_unavailable_reload");
    return false;
  }
  if (response.ok && body?.state) {
    resumeUnavailable = false;
    // RELOAD preserves Story authority, but replays the current scene causally.
    // An unentered bootstrap keeps its existing settled resume behavior.
    await handoff(body.state, { settled: body.state.bootstrap_applied !== true });
    return true;
  }
  if (response.status === 401) {
    activeReaderRuntime = null;
    resumeUnavailable = false;
    lockControls(false);
    status.textContent = stateText("ready");
    return false;
  }
  // Keep consent and the reader locked, but permit language selection to expose the error.
  resumeUnavailable = true;
  lockControls(false);
  status.textContent = stateText("session_check_unavailable_reload");
  return false;
}

async function acceptEntry() {
  if (busy || !language || protocol.hidden) return;
  const humanCandidate = humanMode === "manual"
    ? { provider: "test", token: "verified" }
    : humanMode === "turnstile" && humanReady()
      ? { provider: "turnstile", token: humanToken }
      : null;
  if (!humanCandidate) {
    status.textContent = stateText("human_required");
    lockControls(false);
    return;
  }
  const acceptedLanguage = language;
  lockControls(true);
  audioSession.armFromUserGesture();
  status.textContent = stateText("committing");

  const entryPromise = jsonFetch("/api/entry/accept", {
    method: "POST",
    body: JSON.stringify({
      language: acceptedLanguage,
      accept: true,
      human_candidate: humanCandidate,
    }),
  }).then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error }),
  );

  let prepared = null;
  let authorityCommitted = false;
  try {
    const runtime = await readerRuntimeModule();
    prepared = await runtime.prepareReaderRuntime({ model, language: acceptedLanguage });
    const entry = await entryPromise;
    if (entry.error) throw entry.error;
    const { response, body } = entry.value;
    if (!response.ok || !body?.state) {
      prepared.live.destroy();
      prepared = null;
      restoreEntryShell(acceptedLanguage);
      status.textContent = response.status === 403 ? stateText("human_required") : stateText("entry_unavailable");
      return;
    }

    authorityCommitted = true;
    audioSession.activate();
    activeReaderRuntime = await runtime.startReaderRuntime({ model, state: body.state, settledInitial: false, prepared });
    if (humanClientPromise) void humanClientPromise.then((client) => client.dispose()).catch(() => {});
  } catch (error) {
    console.error("Entry handoff failed", error);
    prepared?.live.destroy();
    restoreEntryShell(acceptedLanguage);
    if (!authorityCommitted) {
      const entry = await entryPromise;
      authorityCommitted = !entry.error && entry.value?.response.ok === true && Boolean(entry.value?.body?.state);
    }
    if (authorityCommitted) {
      await resume();
      return;
    }
    status.textContent = stateText("entry_unavailable");
  }
}

async function boot() {
  if (POST_OUTER_ROUTE) {
    const { mountPostOuter } = await import("/assets/outer/post-outer.mjs");
    await mountPostOuter();
    return;
  }
  const response = await fetch(MODEL_URL, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`runtime model unavailable (${response.status})`);
  model = await response.json();
  assertModel(model);
  renderSelector();
  protocol.hidden = true;
  button.disabled = true;
  shell.dataset.state = "ready";
  button.addEventListener("click", acceptEntry);
  void readerRuntimeModule().catch(() => {});
  const resumed = await resume();
  if (!resumed && !resumeUnavailable) {
    try {
      await configureHuman();
    } catch (error) {
      console.error("Entry HUMAN configuration unavailable", error);
      humanMode = "unavailable";
      humanHost.hidden = true;
      status.textContent = stateText("entry_unavailable");
    }
  }
}

if (POST_OUTER_ROUTE) {
  cover?.remove();
  if (shell instanceof HTMLElement) shell.hidden = true;
} else {
  presentOuterCover(cover, coverArt);
}

boot().catch((error) => {
  console.error("Donskoy successor runtime failed closed.", error);
  shell.dataset.state = "failed-closed";
  selector.replaceChildren();
  copy.replaceChildren();
  subtitle.textContent = "interactive novel";
  heading.textContent = "PROTOCOL READY TO START";
  status.textContent = "ENTRY UNAVAILABLE";
  button.textContent = "START";
  button.disabled = true;
});
