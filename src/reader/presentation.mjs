import { AUDIO_ASSETS, audioSession } from "./audio-session.mjs";
import { narrativeProseImageAfter, narrativeProseImageAtStart, narrativeHiddenSystemImage, NARRATIVE_GALLERY_ITEMS } from "./media-image-plan.mjs";

const LAYERS = new Set(["system", "earth", "heaven"]);
const BLOCK_KINDS = new Set(["prose", "dialogue", "verse", "document"]);
const FRONTIER_ACTIVATION_RATIO = 0.78;
const FRONTIER_DOCUMENT_END_EPSILON_PX = 2;
const GRAPHEME_MS = 12;
const LINE_SETTLE_MS = 300;
const NARRATIVE_IMAGE_HOLD_MS = 1000;
const NARRATIVE_IMAGE_READY_GRACE_MS = 150;
const SECRET_CHAIN_ENABLED = 0; // 0 = off, 1 = on
const SECRET_CHAIN_CODE = "";
const SECRET_CHAIN_LENGTH = 3;
const SECRET_CHAIN_TEMP_TEXT = "Съешь ещё этих мягких французских булок.";
const PILOT_L3_KEY_PATH = AUDIO_ASSETS.L3_KEY;
const PILOT_PHONE_PATH = AUDIO_ASSETS.PHONE_0257;
const PILOT_CHAIN_PATH = AUDIO_ASSETS.CHAIN_LATCH;
const PILOT_SYSTEM_ERROR_PATH = AUDIO_ASSETS.SYSTEM_ERROR;
const settlements = new WeakMap();
const systemSettlements = new WeakMap();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be non-empty`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function systemTone(tone) {
  return ["info", "success", "warning", "error", "muted"].includes(tone) ? tone : "info";
}

function isSystemBlock(block) {
  return (block?.role ?? block?.kind) === "system";
}

function isSupremeBlock(block) {
  return typeof block?.content_id === "string" && /\.supreme\./u.test(block.content_id);
}

function systemPrimitiveIdentity(block) {
  const contentId = typeof block?.content_id === "string" ? block.content_id : "";
  const canonical = /^(l3\.L3V-CH\d{2}-\d{3})(?:\.[A-Za-z0-9_-]+)?$/u.exec(contentId);
  return canonical?.[1] ?? contentId;
}

export function pilotAudioPlan(contentId) {
  const identity = systemPrimitiveIdentity({ content_id: contentId });
  const sound0 = /^l3\.L3V-CH(?:0[1-9]|1[0-2])-\d{3}$/u.test(identity)
    && identity !== "l3.L3V-CH05-004"
    && identity !== "l3.L3V-CH10-001";
  if (identity === "l3.L3V-CH03-004") {
    return Object.freeze({
      sound0,
      oneShot: Object.freeze({ cueId: "CH03_PHONE_0257", src: PILOT_PHONE_PATH }),
    });
  }
  if (identity === "l3.L3V-CH04-013" || identity === "l3.L3V-CH04-016") {
    return Object.freeze({
      sound0,
      oneShot: Object.freeze({ cueId: identity === "l3.L3V-CH04-013" ? "CH04_CHAIN_LATCH" : "CH04_METAL_CLICK", src: PILOT_CHAIN_PATH }),
    });
  }
  if (identity === "l3.L3V-CH05-008") {
    return Object.freeze({
      sound0,
      oneShot: Object.freeze({ cueId: "CH05_CHAIN_LATCH", src: PILOT_CHAIN_PATH }),
    });
  }
  if (identity === "l3.L3V-CH10-001") {
    return Object.freeze({
      sound0: false,
      oneShot: Object.freeze({ cueId: "CH10_SYSTEM_ERROR", src: PILOT_SYSTEM_ERROR_PATH }),
    });
  }
  return Object.freeze({ sound0, oneShot: null });
}

export function hiddenSystemAudioPlan(contentId) {
  const identity = systemPrimitiveIdentity({ content_id: contentId });
  if (identity !== "l3.L3V-CH05-004") return null;
  return Object.freeze({
    afterContentId: "ch05.earth.003",
    cueId: "CH05_DREAM_HORROR",
    src: AUDIO_ASSETS.DREAM_HORROR,
  });
}

function playL3Key(signal) {
  audioSession.playPathWhenReady(PILOT_L3_KEY_PATH, "L3_KEY", signal);
}

function playOneShot(src, cueId, signal) {
  audioSession.playPathWhenReady(src, cueId, signal);
}

function markContentIdentity(node, block) {
  if (!block?.content_id) return;
  node.dataset.contentId = block.content_id;
}

function abortError() {
  return new DOMException("Presentation sequence aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

async function waitVisiblePeriod(ms, signal) {
  let remaining = ms;
  while (remaining > 0) {
    throwIfAborted(signal);
    if (document.visibilityState === "hidden") {
      await new Promise((resolve, reject) => {
        const onVisible = () => {
          if (document.visibilityState !== "visible") return;
          cleanup();
          resolve();
        };
        const onAbort = () => { cleanup(); reject(abortError()); };
        const cleanup = () => {
          document.removeEventListener("visibilitychange", onVisible);
          signal?.removeEventListener("abort", onAbort);
        };
        document.addEventListener("visibilitychange", onVisible);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      continue;
    }
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(finish, remaining);
      const onVisibility = () => { if (document.visibilityState === "hidden") finish(); };
      const onAbort = () => { cleanup(); reject(abortError()); };
      function cleanup() {
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
        signal?.removeEventListener("abort", onAbort);
      }
      function finish() { cleanup(); resolve(); }
      document.addEventListener("visibilitychange", onVisibility);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    remaining = Math.max(0, remaining - Math.min(remaining, performance.now() - started));
  }
}

function graphemes(text) {
  if (Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(({ segment }) => segment);
  }
  return Array.from(text);
}

export function l3ParagraphStartIndexes(text) {
  if (typeof text !== "string") throw new TypeError("Layer 3 text must be a string");
  const parts = graphemes(text);
  const starts = [];
  let paragraphPending = true;
  let consecutiveLineBreaks = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "\n") {
      consecutiveLineBreaks += 1;
      if (consecutiveLineBreaks >= 2) paragraphPending = true;
      continue;
    }
    if (/^[\t\r ]+$/u.test(part)) continue;
    if (/^\s+$/u.test(part)) continue;

    if (paragraphPending) {
      starts.push(index);
      paragraphPending = false;
    }
    consecutiveLineBreaks = 0;
  }

  return Object.freeze(starts);
}

function invokePresentationSideEffect(effect) {
  if (typeof effect !== "function") return;
  try {
    effect();
  } catch (error) {
    console.warn("MEDIA_PRESENTATION_EFFECT_FAILED", error);
  }
}


/** TECH-004: transient character-card frames, with grapheme-safe reverse deletion. */
export function characterNameRewriteFrames({ prefix, previousGiven, finalName }) {
  if (![prefix, previousGiven, finalName].every((part) => typeof part === "string" && part.length > 0)) {
    throw new TypeError("TECH004_NAME_REWRITE_INVALID");
  }
  const frames = [];
  const visible = [];
  for (const part of graphemes(prefix)) {
    visible.push(part);
    frames.push(visible.join(""));
  }
  const oldParts = graphemes(previousGiven);
  for (const part of oldParts) {
    visible.push(part);
    frames.push(visible.join(""));
  }
  for (let i = 0; i < oldParts.length; i += 1) {
    visible.pop();
    frames.push(visible.join(""));
  }
  for (const part of graphemes(finalName)) {
    visible.push(part);
    frames.push(visible.join(""));
  }
  return Object.freeze(frames);
}

/** Every fresh canonical L3 frontier gets a new once-only closure. */
export function oncePerL3Block(effect) {
  if (typeof effect !== "function") throw new TypeError("L3_BLOCK_EFFECT_REQUIRED");
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    effect();
  };
}

async function typeSystemLine(node, text, signal, settled = false, { onParagraphStart = null, forceCausalStreaming = false, nameRewrite = null } = {}) {
  throwIfAborted(signal);
  if (settled) {
    node.textContent = text;
    node.dataset.systemLineState = "settled";
    return;
  }
  node.dataset.systemLineState = "streaming";
  if (nameRewrite && !prefersReducedMotion()) {
    if (`${nameRewrite.prefix}${nameRewrite.finalName}` !== text) {
      throw new Error("TECH004_FINAL_NAME_COPY_MISMATCH");
    }
    node.textContent = "";
    for (const frame of characterNameRewriteFrames(nameRewrite)) {
      throwIfAborted(signal);
      node.textContent = frame;
      await waitVisiblePeriod(GRAPHEME_MS, signal);
    }
    node.textContent = text;
    node.dataset.systemLineState = "committed";
    await waitVisiblePeriod(LINE_SETTLE_MS, signal);
    node.dataset.systemLineState = "settled";
    return;
  }
  const parts = graphemes(text);
  const paragraphStarts = typeof onParagraphStart === "function" ? l3ParagraphStartIndexes(text) : [];
  const paragraphStartSet = new Set(paragraphStarts);

  if (prefersReducedMotion() && !forceCausalStreaming) {
    node.textContent = text;
    if (paragraphStarts.length === 0) {
      await waitVisiblePeriod(parts.length * GRAPHEME_MS, signal);
    } else {
      let cursor = 0;
      for (const start of paragraphStarts) {
        await waitVisiblePeriod(Math.max(0, start - cursor) * GRAPHEME_MS, signal);
        invokePresentationSideEffect(onParagraphStart);
        cursor = start;
      }
      await waitVisiblePeriod(Math.max(0, parts.length - cursor) * GRAPHEME_MS, signal);
    }
  } else {
    node.textContent = "";
    let visible = "";
    for (let index = 0; index < parts.length; index += 1) {
      throwIfAborted(signal);
      if (paragraphStartSet.has(index)) invokePresentationSideEffect(onParagraphStart);
      visible += parts[index];
      node.textContent = visible;
      await waitVisiblePeriod(GRAPHEME_MS, signal);
    }
  }
  node.textContent = text;
  node.dataset.systemLineState = "committed";
  await waitVisiblePeriod(LINE_SETTLE_MS, signal);
  node.dataset.systemLineState = "settled";
}

function readerTopLine(root) {
  const statusbar = root.closest(".reader-shell")?.querySelector(".reader-statusbar");
  return Math.max(0, statusbar?.getBoundingClientRect().bottom ?? 0) + 10;
}

function readerAtDocumentEnd() {
  const scrolling = document.scrollingElement;
  if (!scrolling) return false;
  return scrolling.scrollHeight - scrolling.clientHeight - scrolling.scrollTop <= FRONTIER_DOCUMENT_END_EPSILON_PX;
}

export function actionRevealScrollDelta(buttonBottom, safeBottom, remainingScroll) {
  if (![buttonBottom, safeBottom, remainingScroll].every(Number.isFinite)) return 0;
  return Math.min(Math.max(0, buttonBottom - safeBottom), Math.max(0, remainingScroll));
}

export function frontierAdmission({ geometryReady, atDocumentEnd, visibleInViewport, freshForwardProgress, chained }) {
  if (geometryReady && (!chained || freshForwardProgress)) return true;
  return Boolean(atDocumentEnd && visibleInViewport && freshForwardProgress);
}

function frontierReady(node, root, { freshForwardProgress = false, chained = false } = {}) {
  if (!node.isConnected) return true;
  const line = Math.max(readerTopLine(root) + 48, window.innerHeight * FRONTIER_ACTIVATION_RATIO);
  const rect = node.getBoundingClientRect();
  return frontierAdmission({
    geometryReady: rect.top <= line,
    atDocumentEnd: readerAtDocumentEnd(),
    visibleInViewport: rect.top < window.innerHeight,
    freshForwardProgress,
    chained,
  });
}

function forwardKey(event) {
  if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") return true;
  return (event.key === " " || event.key === "Spacebar") && !event.shiftKey;
}

async function waitForFrontierActivation(node, root, signal, { chained = false } = {}) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    let frame = 0;
    let done = false;
    let freshForwardProgress = false;
    let lastTouchY = null;

    const cleanup = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      signal?.removeEventListener("abort", onAbort);
      if (frame) cancelAnimationFrame(frame);
    };
    const markForwardProgress = () => {
      freshForwardProgress = true;
      schedule();
    };
    const onWheel = (event) => {
      if (event.deltaY > 0) markForwardProgress();
    };
    const onKeyDown = (event) => {
      if (forwardKey(event)) markForwardProgress();
    };
    const onTouchStart = (event) => {
      lastTouchY = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event) => {
      const nextY = event.touches?.[0]?.clientY ?? null;
      if (lastTouchY !== null && nextY !== null && nextY < lastTouchY - 1) markForwardProgress();
      lastTouchY = nextY;
    };
    const finish = () => {
      if (done || !frontierReady(node, root, { freshForwardProgress, chained })) return;
      done = true;
      cleanup();
      resolve();
    };
    const check = () => { frame = 0; finish(); };
    const schedule = () => { if (!frame && !done) frame = requestAnimationFrame(check); };
    const onAbort = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(abortError());
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else schedule();
  });
}

function literaryBoundaryReady(node, root, edge, { freshForwardProgress = false } = {}) {
  if (!node.isConnected) return false;
  const line = Math.max(readerTopLine(root) + 48, window.innerHeight * FRONTIER_ACTIVATION_RATIO);
  const rect = node.getBoundingClientRect();
  const geometryReady = edge === "after" ? rect.bottom <= line : rect.top <= line;
  if (geometryReady) return true;
  return Boolean(readerAtDocumentEnd() && rect.top < window.innerHeight && freshForwardProgress);
}

async function waitForLiteraryBoundaryActivation(node, root, signal, edge) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    let frame = 0;
    let done = false;
    let freshForwardProgress = false;
    let lastTouchY = null;

    const cleanup = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      signal?.removeEventListener("abort", onAbort);
      if (frame) cancelAnimationFrame(frame);
    };
    const markForwardProgress = () => {
      freshForwardProgress = true;
      schedule();
    };
    const onWheel = (event) => {
      if (event.deltaY > 0) markForwardProgress();
    };
    const onKeyDown = (event) => {
      if (forwardKey(event)) markForwardProgress();
    };
    const onTouchStart = (event) => {
      lastTouchY = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event) => {
      const nextY = event.touches?.[0]?.clientY ?? null;
      if (lastTouchY !== null && nextY !== null && nextY < lastTouchY - 1) markForwardProgress();
      lastTouchY = nextY;
    };
    const finish = () => {
      if (done || !literaryBoundaryReady(node, root, edge, { freshForwardProgress })) return;
      done = true;
      cleanup();
      resolve();
    };
    const check = () => { frame = 0; finish(); };
    const schedule = () => { if (!frame && !done) frame = requestAnimationFrame(check); };
    const onAbort = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(abortError());
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else schedule();
  });
}

export function compilePresentationPrimitives(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new TypeError("literary scene requires blocks");
  const primitives = [];
  for (let index = 0; index < blocks.length;) {
    const first = blocks[index];
    const kind = isSystemBlock(first) ? "system" : isSupremeBlock(first) ? "supreme" : "literary";
    const systemIdentity = kind === "system" ? systemPrimitiveIdentity(first) : null;
    const group = [];
    while (index < blocks.length) {
      const block = blocks[index];
      const nextKind = isSystemBlock(block) ? "system" : isSupremeBlock(block) ? "supreme" : "literary";
      if (nextKind !== kind) break;
      if (kind === "system" && systemPrimitiveIdentity(block) !== systemIdentity) break;
      group.push(block);
      index += 1;
    }
    primitives.push(Object.freeze({ kind, blocks: Object.freeze(group) }));
  }
  return Object.freeze(primitives);
}

function sliceAfterContentId(blocks, contentId) {
  if (!contentId) throw new Error("LANGUAGE_BOUNDARY_CONTENT_ID_REQUIRED");
  const index = blocks.findIndex((block) => block?.content_id === contentId);
  if (index < 0) throw new Error(`LANGUAGE_BOUNDARY_TOPOLOGY_MISMATCH:${contentId}`);
  return blocks.slice(index + 1);
}

export function createReaderSurface(root) {
  if (!(root instanceof HTMLElement)) throw new TypeError("reader surface root must be an HTMLElement");
  const flow = root.querySelector("[data-reader-flow]");
  const actionHost = root.querySelector("[data-reader-actions]");
  const gateHost = root.querySelector("[data-reader-gate]");
  const overlayRoot = root.querySelector("[data-reader-overlay]");
  if (!(flow instanceof HTMLElement) || !(actionHost instanceof HTMLElement) || !(gateHost instanceof HTMLElement) || !(overlayRoot instanceof HTMLElement)) {
    throw new Error("reader surface DOM contract incomplete");
  }

  const gateHome = gateHost.parentElement;
  let renderAbort = new AbortController();
  let consumeFrame = 0;
  let destroyed = false;
  // Image downloads/decodes begin when a scene is rendered, not at its reading boundary.
  // This cache outlives individual render epochs so REWIND can reuse decoded assets.
  const narrativeImageCache = new Map();
  let coverImageCleanup = null;
  // The gallery is a projection of existing media events, never persisted state.
  const galleryUnlocked = new Set();
  function setGalleryBaseline(ids = []) {
    galleryUnlocked.clear();
    for (const id of ids) {
      if (NARRATIVE_GALLERY_ITEMS.some((item) => item.id === id && id !== "COVER")) galleryUnlocked.add(id);
    }
  }

  function restoreGateHost() {
    if (gateHome && gateHost.parentElement !== gateHome) gateHome.insertBefore(gateHost, actionHost);
  }

  function findVisibleSuccessor(frontier) {
    let node = frontier.nextElementSibling;
    while (node) {
      if (node instanceof HTMLElement && !node.hidden && node.dataset.frontierState !== "consumed") return node;
      node = node.nextElementSibling;
    }
    return null;
  }

  function findContentNode(contentId) {
    for (const node of flow.querySelectorAll("[data-content-id]")) {
      if (node instanceof HTMLElement && node.dataset.contentId === contentId) return node;
    }
    return null;
  }

  function scheduleConsumption() {
    if (destroyed || consumeFrame) return;
    consumeFrame = requestAnimationFrame(consumePassedFrontier);
  }

  function consumePassedFrontier() {
    consumeFrame = 0;
    if (destroyed) return;
    for (const frontier of flow.querySelectorAll('[data-system-frontier][data-frontier-state="complete"]')) {
      if (!(frontier instanceof HTMLElement)) continue;
      if (frontier.getBoundingClientRect().bottom > readerTopLine(flow)) continue;
      const anchor = findVisibleSuccessor(frontier);
      if (!(anchor instanceof HTMLElement)) continue;
      const before = anchor.getBoundingClientRect().top;
      frontier.dataset.frontierState = "consumed";
      frontier.remove();
      requestAnimationFrame(() => {
        if (!anchor.isConnected) return;
        const after = anchor.getBoundingClientRect().top;
        const delta = after - before;
        const scrolling = document.scrollingElement;
        if (scrolling && Number.isFinite(delta) && Math.abs(delta) >= .5) scrolling.scrollTop += delta;
      });
      break;
    }
  }

  window.addEventListener("scroll", scheduleConsumption, { passive: true });
  window.addEventListener("resize", scheduleConsumption, { passive: true });

  function closeOverlay() {
    // The same overlay may be closed on REWIND, scene replacement or teardown.
    coverImageCleanup?.();
    coverImageCleanup = null;
    overlayRoot.hidden = true;
    overlayRoot.replaceChildren();
    delete overlayRoot.dataset.variant;
    delete overlayRoot.dataset.imageCue;
    overlayRoot.style.removeProperty("--narrative-image-duration");
    flow.inert = false;
    if (gateHome instanceof HTMLElement) gateHome.inert = false;
  }


  // Tools > Images: still the same Reader overlay, zoom and close behavior.
  // The cover is permanent; other assets appear only after canonical media cues.
  function presentCoverImage() {
    if (destroyed || !overlayRoot.hidden) return false;
    const available = NARRATIVE_GALLERY_ITEMS.filter((item) => item.id === "COVER" || galleryUnlocked.has(item.id));
    const backdrop = el("div", "reader-overlay__backdrop");
    backdrop.setAttribute("aria-hidden", "true");
    const dialog = el("section", "reader-overlay__dialog reader-overlay__dialog--cover-image");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Images");
    dialog.tabIndex = -1;

    const topbar = el("div", "reader-overlay__topbar reader-overlay__topbar--notebook");
    const title = el("span", "reader-overlay__cover-title", "IMAGES / COVER");
    const counter = el("span", "reader-overlay__gallery-counter");
    const previous = el("button", "reader-overlay__gallery-nav", "←");
    previous.type = "button";
    previous.setAttribute("aria-label", "Previous image");
    const next = el("button", "reader-overlay__gallery-nav", "→");
    next.type = "button";
    next.setAttribute("aria-label", "Next image");
    const close = el("button", "reader-overlay__icon-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close images");
    close.title = "Close";
    topbar.append(title, counter, previous, next, close);

    const viewport = el("div", "reader-overlay__cover-viewport");
    const stage = el("div", "reader-overlay__cover-stage");
    const image = el("img", "reader-overlay__cover-image");
    image.src = "/media/outer/cover-00.webp";
    image.alt = "Donskoy 2.0 cover";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Toggle 4x image zoom");
    image.draggable = false;
    stage.append(image);
    viewport.append(stage);
    dialog.append(topbar, viewport);

    const opener = root.querySelector("[data-reader-settings-trigger]");
    let pressTimer = 0;
    let press = null;
    let longPressed = false;
    let pageIndex = 0;

    const stopPress = () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = 0;
    };
    const setZoom = (zoomed) => {
      stage.dataset.zoomed = String(zoomed);
      image.setAttribute("aria-pressed", String(zoomed));
      requestAnimationFrame(() => {
        if (!viewport.isConnected) return;
        viewport.scrollLeft = zoomed ? (viewport.scrollWidth - viewport.clientWidth) / 2 : 0;
        viewport.scrollTop = zoomed ? (viewport.scrollHeight - viewport.clientHeight) / 2 : 0;
      });
    };
    const showPage = (index) => {
      if (index < 0 || index >= available.length) return;
      pageIndex = index;
      const item = available[index];
      image.src = item.src;
      image.alt = item.label === "COVER" ? "Donskoy 2.0 cover" : item.label;
      title.textContent = `IMAGES / ${item.label}`;
      counter.textContent = `${index + 1} / ${available.length}`;
      previous.disabled = index === 0;
      next.disabled = index === available.length - 1;
      setZoom(false);
    };
    const dismiss = () => {
      closeOverlay();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (event.key === "ArrowLeft" && stage.dataset.zoomed !== "true") {
        event.preventDefault();
        showPage(pageIndex - 1);
      } else if (event.key === "ArrowRight" && stage.dataset.zoomed !== "true") {
        event.preventDefault();
        showPage(pageIndex + 1);
      }
    };
    const onImageKey = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setZoom(stage.dataset.zoomed !== "true");
    };
    const onPointerDown = (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      stopPress();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      longPressed = false;
      if (stage.dataset.zoomed !== "true") {
        pressTimer = window.setTimeout(() => {
          longPressed = true;
          pressTimer = 0;
          setZoom(true);
        }, 480);
      }
    };
    const onPointerMove = (event) => {
      if (!press || event.pointerId !== press.id) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) stopPress();
    };
    const onPointerUp = (event) => {
      if (!press || event.pointerId !== press.id) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      press = null;
      stopPress();
      if (stage.dataset.zoomed !== "true" && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        showPage(pageIndex + (dx < 0 ? 1 : -1));
      } else if (!longPressed && Math.hypot(dx, dy) < 10) {
        setZoom(stage.dataset.zoomed !== "true");
      }
    };
    const onPointerCancel = () => { press = null; stopPress(); };
    const onContextMenu = (event) => event.preventDefault();
    const goPrevious = () => showPage(pageIndex - 1);
    const goNext = () => showPage(pageIndex + 1);

    image.addEventListener("pointerdown", onPointerDown);
    image.addEventListener("pointermove", onPointerMove);
    image.addEventListener("pointerup", onPointerUp);
    image.addEventListener("pointercancel", onPointerCancel);
    image.addEventListener("keydown", onImageKey);
    image.addEventListener("contextmenu", onContextMenu);
    previous.addEventListener("click", goPrevious);
    next.addEventListener("click", goNext);
    close.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);
    coverImageCleanup = () => {
      stopPress();
      press = null;
      document.removeEventListener("keydown", onKey);
      image.removeEventListener("pointerdown", onPointerDown);
      image.removeEventListener("pointermove", onPointerMove);
      image.removeEventListener("pointerup", onPointerUp);
      image.removeEventListener("pointercancel", onPointerCancel);
      image.removeEventListener("keydown", onImageKey);
      image.removeEventListener("contextmenu", onContextMenu);
      previous.removeEventListener("click", goPrevious);
      next.removeEventListener("click", goNext);
      close.removeEventListener("click", dismiss);
    };

    overlayRoot.replaceChildren(backdrop, dialog);
    overlayRoot.dataset.variant = "cover-image";
    overlayRoot.hidden = false;
    flow.inert = true;
    if (gateHome instanceof HTMLElement) gateHome.inert = true;
    showPage(0);
    close.focus({ preventScroll: true });
    return true;
  }

  // Prime the image in the background while its prose is being read.
  // No render boundary ever waits on an uncached network request for seconds.
  function prefetchNarrativeImage(src) {
    if (narrativeImageCache.has(src)) return narrativeImageCache.get(src);
    const image = new Image();
    image.decoding = "async";
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const entry = { image, ready, status: "loading" };
    narrativeImageCache.set(src, entry);
    const settle = (state) => {
      if (entry.status !== "loading") return;
      entry.status = state;
      image.onload = null;
      image.onerror = null;
      resolveReady(state === "ready" ? image : null);
    };
    image.onerror = () => settle("failed");
    image.onload = () => {
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        settle("failed");
        return;
      }
      if (typeof image.decode === "function") {
        void image.decode().then(
          () => settle("ready"),
          () => settle(image.naturalWidth > 0 && image.naturalHeight > 0 ? "ready" : "failed"),
        );
      } else {
        settle("ready");
      }
    };
    image.src = src;
    return entry;
  }

  // At the causal boundary, never wait for a full image download.
  // If a fast reader outruns the prefetch, skip only the optional image.
  async function readyNarrativeImage(src) {
    const entry = prefetchNarrativeImage(src);
    if (entry.status === "loading") {
      await Promise.race([
        entry.ready,
        new Promise((resolve) => window.setTimeout(resolve, NARRATIVE_IMAGE_READY_GRACE_MS)),
      ]);
    }
    return entry.status === "ready" ? entry.image : null;
  }

  async function presentNarrativeImage(cue, signal = renderAbort.signal, onVisible = null) {
    if (!cue?.src || destroyed || signal?.aborted || !overlayRoot.hidden) return false;
    let image;
    let dialog = null;
    try {
      image = await readyNarrativeImage(cue.src);
      if (!image) {
        const status = narrativeImageCache.get(cue.src)?.status;
        console.warn(status === "loading" ? "MEDIA_IMAGE_NOT_READY" : "MEDIA_IMAGE_UNAVAILABLE", cue.src);
        return false;
      }
      if (destroyed || signal?.aborted || !overlayRoot.hidden) return false;
      const backdrop = el("div", "reader-overlay__backdrop");
      backdrop.setAttribute("aria-hidden", "true");
      dialog = el("section", "reader-overlay__dialog reader-overlay__dialog--narrative-image");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "Narrative image");
      dialog.append(image);
      image.className = "reader-overlay__narrative-image";
      image.alt = "";
      if (cue.rotate180) image.dataset.rotate180 = "true";
      overlayRoot.replaceChildren(backdrop, dialog);
      overlayRoot.dataset.variant = "narrative-image";
      overlayRoot.dataset.imageCue = cue.variant;
      const holdMs = Number.isFinite(cue.holdMs) && cue.holdMs > 0 ? cue.holdMs : NARRATIVE_IMAGE_HOLD_MS;
      overlayRoot.style.setProperty("--narrative-image-duration", `${holdMs}ms`);
      overlayRoot.hidden = false;
      if (NARRATIVE_GALLERY_ITEMS.some((item) => item.id === cue.id)) galleryUnlocked.add(cue.id);
      invokePresentationSideEffect(onVisible);
      flow.inert = true;
      if (gateHome instanceof HTMLElement) gateHome.inert = true;
      await waitVisiblePeriod(holdMs, signal);
      return true;
    } catch (error) {
      if (!signal?.aborted && error?.name !== "AbortError") console.warn("MEDIA_PRESENTATION_EFFECT_FAILED", error);
      return false;
    } finally {
      if (dialog?.isConnected && overlayRoot.dataset.variant === "narrative-image") closeOverlay();
    }
  }

  function clearFlow() {
    if (destroyed) return;
    renderAbort.abort();
    renderAbort = new AbortController();
    galleryUnlocked.clear();
    restoreGateHost();
    closeOverlay();
    flow.replaceChildren();
    if (consumeFrame) cancelAnimationFrame(consumeFrame);
    consumeFrame = 0;
  }

  function createSystemScene({ bridge = false, label = "SYSTEM", frontier = false } = {}) {
    const scene = el("section", `system-scene${bridge ? " system-scene--bridge" : ""}${frontier ? " system-scene--insert system-scene--frontier" : ""}`);
    scene.dataset.readerLayer = "system";
    if (frontier) {
      scene.dataset.systemFrontier = "";
      scene.dataset.frontierState = "armed";
      scene.setAttribute("aria-busy", "true");
    }
    const panel = el("div", `system-panel${frontier ? " system-panel--insert" : ""}`);
    panel.append(el("div", "system-panel__label", label));
    scene.append(panel);
    return { scene, panel };
  }

  function systemLineDescriptor(panel, item) {
    const line = typeof item === "string" ? { text: item, tone: "info" } : item;
    const node = el("div", `system-line system-line--${systemTone(line?.tone)}`, "");
    markContentIdentity(node, line);
    panel.append(node);
    return { node, text: requireText(line?.text, "system line"), nameRewrite: line?.nameRewrite ?? null };
  }

  // The fixed service rail must never cover newly revealed content.
  function visibleReaderBottom() {
    const strip = root.querySelector(".reader-service-strip");
    const stripTop = strip instanceof HTMLElement && strip.getClientRects().length
      ? strip.getBoundingClientRect().top : window.innerHeight;
    return Math.min(window.innerHeight - 24, stripTop - 12);
  }

  // Presentation-only follow; it cannot authorize or activate a frontier.
  function followStreamingSystem(scene, run = null, signal = null) {
    const scrolling = document.scrollingElement;
    if (!scrolling || typeof MutationObserver !== "function") return () => {};
    let frame = 0;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", cleanup);
    };
    const tick = () => {
      frame = 0;
      if (closed) return;
      if (!scene.isConnected || signal?.aborted) { cleanup(); return; }
      const bottom = scene.getBoundingClientRect().bottom;
      const safeBottom = visibleReaderBottom();
      if (bottom > safeBottom) {
        const distance = bottom - safeBottom;
        const maxScroll = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
        scrolling.scrollTop = Math.min(maxScroll, scrolling.scrollTop + distance);
      }
    };
    const schedule = () => {
      if (!closed && !frame) frame = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(scene, { subtree: true, childList: true, characterData: true });
    signal?.addEventListener("abort", cleanup, { once: true });
    schedule();
    if (run) void run.finally(() => {
      schedule();
      requestAnimationFrame(() => { tick(); cleanup(); });
    }).catch(() => {});
    return cleanup;
  }

  function revealBootstrapAction(button) {
    requestAnimationFrame(() => {
      if (destroyed || !button.isConnected) return;
      const scrolling = document.scrollingElement;
      if (!scrolling) return;
      const remaining = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight - scrolling.scrollTop);
      const distance = actionRevealScrollDelta(button.getBoundingClientRect().bottom, visibleReaderBottom(), remaining);
      if (distance > 0) scrolling.scrollTop += distance;
    });
  }

  function renderSystem({ lines, bridge = false, label = "SYSTEM", settled = false, autoFollow = false }) {
    if (destroyed) throw new Error("READER_SURFACE_DESTROYED");
    if (!Array.isArray(lines) || lines.length === 0) throw new TypeError("system scene requires lines");
    const signal = renderAbort.signal;
    const { scene, panel } = createSystemScene({ bridge, label });
    flow.append(scene);
    const run = Promise.resolve().then(async () => {
      for (const item of lines) {
        const line = systemLineDescriptor(panel, item);
        await typeSystemLine(line.node, line.text, signal, settled, {
          nameRewrite: line.nameRewrite,
        });
      }
    }).catch((error) => {
      if (signal.aborted || error?.name === "AbortError") return;
      throw error;
    });
    systemSettlements.set(scene, run);
    if (autoFollow && !settled) followStreamingSystem(scene, run);
    return scene;
  }

  function whenSystemSettled(scene) {
    return systemSettlements.get(scene) || Promise.resolve();
  }

  function ordinaryBlock(block) {
    const role = block?.role ?? block?.kind ?? "prose";
    const kind = BLOCK_KINDS.has(role) ? role : "prose";
    const node = el("p", `reader-block reader-block--${kind}`);
    const text = requireString(block?.text, "reader block text");
    const textNode = el("span", "reader-block__text");
    if (block?.content_id === "ch04.heaven.002") {
      // Preserve the complete canonical text and lineation while anchoring
      // the image to the first line (Мир выключился. / translated equivalent).
      const lineEnd = text.indexOf("\n");
      if (lineEnd <= 0) throw new Error("CH04_CHEST_IMAGE_LINE_BOUNDARY_MISSING");
      const firstLine = el("span", "reader-block__image-boundary", text.slice(0, lineEnd));
      firstLine.dataset.narrativeImageBoundary = "";
      textNode.append(firstLine, document.createTextNode(text.slice(lineEnd)));
    } else {
      textNode.textContent = text;
    }
    node.append(textNode);
    markContentIdentity(node, block);
    const speaker = block?.speaker ?? block?.speaker_id;
    if (speaker) {
      node.dataset.speaker = requireString(speaker, "speaker");
      if (block.accent?.dark) node.style.setProperty("--speaker-accent-dark", requireString(block.accent.dark, "speaker dark accent"));
      if (block.accent?.light) node.style.setProperty("--speaker-accent-light", requireString(block.accent.light, "speaker light accent"));
    }
    return node;
  }

  // A separate first-line onset cue: do NOT wait for this long prose block's end.
  function armNarrativeImageAtStart(node, cue, signal) {
    void waitForLiteraryBoundaryActivation(node, flow, signal, "start").then(() => {
      if (!signal.aborted) void presentNarrativeImage(cue, signal);
    }).catch((error) => {
      if (signal.aborted || error?.name === "AbortError") return;
      console.warn("MEDIA_PRESENTATION_EFFECT_FAILED", error);
    });
  }

  // Media cues observe the prose boundary without controlling DOM publication.
  function armNarrativeImageAfter(node, cue, signal, beforeShow = null, afterCue = null, onImageVisible = null) {
    const reached = waitForLiteraryBoundaryActivation(node, flow, signal, "after").then(() => {
      if (signal.aborted) return null;
      invokePresentationSideEffect(beforeShow);
      if (cue) void presentNarrativeImage(cue, signal, onImageVisible);
      return afterCue?.() ?? null;
    });
    // A detached cue stays fail-open; callers that also carry a causal
    // language boundary can separately await "reached" before streaming.
    void reached.catch((error) => {
      if (signal.aborted || error?.name === "AbortError") return;
      console.warn("MEDIA_PRESENTATION_EFFECT_FAILED", error);
    });
    return reached;
  }

  function appendLiteraryPrimitive(sectionFlow, blocks, { settled = false, signal = null } = {}) {
    const scene = el("div", "chapter-scene");
    for (const block of blocks) {
      const node = ordinaryBlock(block);
      scene.append(node);
      if (!settled) {
        const imageCue = narrativeProseImageAfter(block?.content_id);
        if (imageCue) armNarrativeImageAfter(node, imageCue, signal);
        const onsetCue = narrativeProseImageAtStart(block?.content_id);
        if (onsetCue) {
          const anchor = node.querySelector("[data-narrative-image-boundary]");
          if (!(anchor instanceof HTMLElement)) throw new Error("CH04_CHEST_IMAGE_ANCHOR_MISSING");
          armNarrativeImageAtStart(anchor, onsetCue, signal);
        }
      }
    }
    sectionFlow.append(scene);
    scheduleConsumption();
    return scene;
  }

  function appendFrontier(sectionFlow, blocks) {
    const { scene, panel } = createSystemScene({ frontier: true, label: "SYSTEM" });
    const boundaryIdentity = systemPrimitiveIdentity(blocks[0]);
    if (boundaryIdentity) scene.dataset.frontierBoundaryId = boundaryIdentity;
    sectionFlow.append(scene);
    scheduleConsumption();
    return { wrapper: scene, panel, blocks, boundaryContentId: blocks.at(-1)?.content_id ?? null };
  }

  async function presentSupreme(blocks, signal, secretChain = null) {
    throwIfAborted(signal);
    overlayRoot.replaceChildren();
    overlayRoot.dataset.variant = "secret-channel";
    const backdrop = el("div", "reader-overlay__backdrop");
    backdrop.setAttribute("aria-hidden", "true");
    const dialog = el("section", "reader-overlay__dialog reader-overlay__dialog--secret-channel");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Supreme paratext");
    dialog.tabIndex = -1;
    const topbar = el("div", "reader-overlay__topbar reader-overlay__topbar--secret");
    let secretAttempted = false;
    const secretSlot = el("div", "reader-overlay__secret-slot");
    const secretTitle = el(SECRET_CHAIN_ENABLED === 1 ? "button" : "span", "reader-overlay__secret-title", "SECRET CHAIN");
    if (SECRET_CHAIN_ENABLED === 1) secretTitle.type = "button";
    secretSlot.append(secretTitle);
    topbar.append(secretSlot);
    const close = el("button", "reader-overlay__icon-close", "×");
    close.type = "button";
    close.dataset.overlayAcknowledge = "";
    close.setAttribute("aria-label", "Close Supreme paratext");
    close.title = "Close";
    topbar.append(close);
    const body = el("div", "reader-overlay__body reader-overlay__body--secret");
    for (const block of blocks) {
      const node = ordinaryBlock(block);
      node.classList.add("reader-block--secret");
      body.append(node);
    }

    if (SECRET_CHAIN_ENABLED === 1) {
      secretTitle.addEventListener("click", () => {
        if (secretAttempted) return;
        secretAttempted = true;
        const input = el("input", "reader-overlay__secret-input");
        input.type = "text";
        input.maxLength = SECRET_CHAIN_LENGTH;
        input.placeholder = "SECRET CHAIN";
        input.autocomplete = "off";
        input.setAttribute("autocapitalize", "none");
        input.spellcheck = false;
        input.setAttribute("aria-label", "Secret Chain code");

        const restoreInertTitle = () => {
          const inertTitle = el("span", "reader-overlay__secret-title", "SECRET CHAIN");
          input.replaceWith(inertTitle);
        };

        input.addEventListener("input", () => {
          if (input.value.length < SECRET_CHAIN_LENGTH) return;
          const unlocked = input.value.trim().toLowerCase() === SECRET_CHAIN_CODE;
          restoreInertTitle();
          if (!unlocked) return;
          const textNode = body.querySelector(".reader-block__text");
          if (!(textNode instanceof HTMLElement)) throw new Error("SECRET_CHAIN_TEXT_SURFACE_MISSING");
          textNode.textContent = secretChain?.text ?? SECRET_CHAIN_TEMP_TEXT;
        });

        secretTitle.replaceWith(input);
        input.focus({ preventScroll: true });
      }, { once: true });
    }

    dialog.append(topbar, body);
    overlayRoot.append(backdrop, dialog);
    overlayRoot.hidden = false;
    flow.inert = true;
    if (gateHome instanceof HTMLElement) gateHome.inert = true;
    requestAnimationFrame(() => {
      if (dialog.isConnected && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    });

    await new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        close.removeEventListener("click", onClose);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        closeOverlay();
        resolve();
      };
      const onClose = () => finish();
      const onAbort = () => {
        if (done) return;
        done = true;
        cleanup();
        closeOverlay();
        reject(abortError());
      };
      close.addEventListener("click", onClose, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  function renderLiterary({ layer, eyebrow, title, blocks, secretChain = null, preloadImage = null, settled = false, onCausalBoundary = null }) {
    if (destroyed) throw new Error("READER_SURFACE_DESTROYED");
    if (layer !== "earth" && layer !== "heaven") throw new TypeError("literary layer must be earth or heaven");
    if (!Array.isArray(blocks) || blocks.length === 0) throw new TypeError("literary scene requires blocks");
    const signal = renderAbort.signal;
    const section = el("section", `chapter-section chapter-section--${layer}`);
    section.dataset.readerLayer = layer;
    const header = el("header", "chapter-section__header");
    if (eyebrow) header.append(el("div", "chapter-section__eyebrow", eyebrow));
    if (title) header.append(el("h1", "chapter-section__title", title));
    const sectionFlow = el("div", "chapter-section__flow");
    section.append(header, sectionFlow);
    flow.append(section);
    // The CH08 transition image starts loading during its preceding scene.
    // Normal prose cues remain scene-local. No render or gate waits on this fetch.
    if (preloadImage?.src) prefetchNarrativeImage(preloadImage.src);
    if (!settled) {
      for (const block of blocks) {
        const cue = narrativeProseImageAfter(block?.content_id)
          ?? narrativeHiddenSystemImage(block?.content_id);
        if (cue) prefetchNarrativeImage(cue.src);
        const onsetCue = narrativeProseImageAtStart(block?.content_id);
        if (onsetCue) prefetchNarrativeImage(onsetCue.src);
      }
    }

    const run = (async () => {
      let remainingBlocks = [...blocks];
      let frontierIndex = 0;
      let pendingHiddenBoundary = null;
      while (remainingBlocks.length > 0) {
        throwIfAborted(signal);
        const primitives = compilePresentationPrimitives(remainingBlocks);
        const primitive = primitives[0];
        if (!primitive) break;

        if (primitive.kind === "literary") {
          // Publish all prose now; image effects cannot truncate or hold the next block.
          appendLiteraryPrimitive(sectionFlow, primitive.blocks, { settled, signal });
          remainingBlocks = remainingBlocks.slice(primitive.blocks.length);
          continue;
        }

        if (primitive.kind === "supreme") {
          await presentSupreme(primitive.blocks, signal, secretChain);
          remainingBlocks = remainingBlocks.slice(primitive.blocks.length);
          continue;
        }

        const hiddenAudio = hiddenSystemAudioPlan(primitive.blocks[0]?.content_id);
        const hiddenImage = narrativeHiddenSystemImage(primitive.blocks[0]?.content_id);
        if (hiddenAudio) {
          const boundaryContentId = primitive.blocks.at(-1)?.content_id ?? null;
          const boundary = Object.freeze({ frontier_index: frontierIndex, after_content_id: boundaryContentId });
          if (!settled) {
            const anchor = findContentNode(hiddenAudio.afterContentId);
            if (!(anchor instanceof HTMLElement)) throw new Error(`MEDIA_AUDIO_BOUNDARY_TOPOLOGY_MISMATCH:${hiddenAudio.afterContentId}`);
            // Publish the next frontier DOM now, but apply a requested language
            // change at the actual P3 edge before that frontier starts typing.
            pendingHiddenBoundary = {
              afterContentId: boundaryContentId,
              reached: armNarrativeImageAfter(anchor, hiddenImage, signal,
                null,
                typeof onCausalBoundary === "function" ? () => onCausalBoundary(boundary) : null,
                () => audioSession.playPathWhenReady(hiddenAudio.src, hiddenAudio.cueId, signal)),
            };
          }

          remainingBlocks = remainingBlocks.slice(primitive.blocks.length);
          if (settled && typeof onCausalBoundary === "function") {
            const replacement = await onCausalBoundary(boundary);
            if (replacement?.blocks) {
              if (!Array.isArray(replacement.blocks)) throw new TypeError("boundary replacement blocks must be an array");
              remainingBlocks = sliceAfterContentId(replacement.blocks, boundaryContentId);
            }
          }
          frontierIndex += 1;
          scheduleConsumption();
          continue;
        }

        const frontier = appendFrontier(sectionFlow, primitive.blocks);
        if (!settled) {
          await waitForFrontierActivation(frontier.wrapper, flow, signal, { chained: frontierIndex > 0 });
          throwIfAborted(signal);
          if (pendingHiddenBoundary) {
            const pending = pendingHiddenBoundary;
            pendingHiddenBoundary = null;
            const replacement = await pending.reached;
            throwIfAborted(signal);
            if (replacement?.blocks) {
              if (!Array.isArray(replacement.blocks)) throw new TypeError("boundary replacement blocks must be an array");
              const localized = sliceAfterContentId(replacement.blocks, pending.afterContentId);
              const first = compilePresentationPrimitives(localized)[0];
              if (first?.kind !== "system" ||
                  systemPrimitiveIdentity(first.blocks[0]) !== systemPrimitiveIdentity(frontier.blocks[0])) {
                throw new Error("LANGUAGE_BOUNDARY_FRONTIER_MISMATCH");
              }
              // Unstreamed frontier already occupies its canonical DOM slot.
              // Switch only its data source; never tear down the Reader.
              remainingBlocks = localized;
              frontier.blocks = first.blocks;
              frontier.boundaryContentId = first.blocks.at(-1)?.content_id ?? null;
            }
          }
          frontier.wrapper.dataset.frontierState = "streaming";
        }

        // CH12 Heaven ends with one consecutive L3 audit primitive (.a + .b).
        // Follow its first streamed line onward; never advance its frontier.
        const stopFinalAuditFollow = !settled && layer === "heaven"
          && frontier.blocks[0]?.content_id === "l3.L3V-CH12-002.a"
          ? followStreamingSystem(frontier.wrapper, null, signal) : null;

        const pilotAudio = settled ? null : pilotAudioPlan(frontier.blocks[0]?.content_id);
        if (pilotAudio?.oneShot) playOneShot(pilotAudio.oneShot.src, pilotAudio.oneShot.cueId, signal);

        // One SOUND 0 per canonical frontier, not per blank-line paragraph.
        const onBlockStart = pilotAudio?.sound0 ? oncePerL3Block(() => playL3Key(signal)) : null;
        for (const block of frontier.blocks) {
          const line = systemLineDescriptor(frontier.panel, block);
          await typeSystemLine(line.node, line.text, signal, settled, {
            onParagraphStart: onBlockStart,
            forceCausalStreaming: true,
          });
        }
        stopFinalAuditFollow?.();
        frontier.wrapper.dataset.frontierState = "complete";
        frontier.wrapper.setAttribute("aria-busy", "false");
        remainingBlocks = remainingBlocks.slice(frontier.blocks.length);

        if (typeof onCausalBoundary === "function") {
          const replacement = await onCausalBoundary(Object.freeze({
            frontier_index: frontierIndex,
            after_content_id: frontier.boundaryContentId,
          }));
          if (replacement?.blocks) {
            if (!Array.isArray(replacement.blocks)) throw new TypeError("boundary replacement blocks must be an array");
            remainingBlocks = sliceAfterContentId(replacement.blocks, frontier.boundaryContentId);
          }
        }
        frontierIndex += 1;
        scheduleConsumption();
      }
      scheduleConsumption();
    })().catch((error) => {
      if (signal.aborted || error?.name === "AbortError") return;
      throw error;
    });

    settlements.set(section, run);
    return section;
  }

  function whenFrontiersSettled(section) {
    return settlements.get(section) || Promise.resolve();
  }

  function renderScene(scene) {
    if (!scene || !LAYERS.has(scene.layer)) throw new TypeError("unsupported presentation layer");
    if (scene.layer === "system") return renderSystem(scene);
    return renderLiterary(scene);
  }

  function setAction(action) {
    if (destroyed) return;
    actionHost.replaceChildren();
    if (!action) return;
    const button = el("button", "reader-action", requireString(action.label, "action label"));
    button.type = "button";
    button.dataset.actionId = requireString(action.id, "action id");
    button.disabled = Boolean(action.disabled);
    if (typeof action.onSelect === "function") button.addEventListener("click", action.onSelect);
    actionHost.append(button);
    if (action.id === "CH01_BOOTSTRAP.APPLY") revealBootstrapAction(button);
  }

  function setGate(gate) {
    if (destroyed) return;
    restoreGateHost();
    gateHost.replaceChildren();
    gateHost.hidden = !gate;
    if (!gate) return;
    const actions = el("div", "reader-gate__actions");
    for (const item of gate.actions || []) {
      const button = el("button", "reader-gate__action", requireString(item.label, "gate action label"));
      button.type = "button";
      button.dataset.actionId = requireString(item.id, "action id");
      button.disabled = Boolean(item.disabled);
      if (typeof item.onSelect === "function") button.addEventListener("click", item.onSelect);
      actions.append(button);
    }
    gateHost.append(actions);

    const frontiers = [...flow.querySelectorAll('[data-system-frontier][data-frontier-state="complete"]')];
    const last = frontiers.at(-1);
    const panel = last?.querySelector?.(".system-panel");
    if (panel instanceof HTMLElement && last.nextElementSibling === null) panel.append(gateHost);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderAbort.abort();
    if (consumeFrame) cancelAnimationFrame(consumeFrame);
    consumeFrame = 0;
    window.removeEventListener("scroll", scheduleConsumption);
    window.removeEventListener("resize", scheduleConsumption);
    closeOverlay();
    restoreGateHost();
    actionHost.replaceChildren();
    gateHost.replaceChildren();
    gateHost.hidden = true;
    flow.replaceChildren();
  }

  return Object.freeze({
    clearFlow,
    renderScene,
    renderSystem,
    renderLiterary,
    whenSystemSettled,
    whenFrontiersSettled,
    setAction,
    setGate,
    presentNarrativeImage,
    presentCoverImage,
    setGalleryBaseline,
    destroy,
  });
}
