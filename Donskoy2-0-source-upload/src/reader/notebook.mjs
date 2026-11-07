export const NOTEBOOK_MANIFEST_PATH = "/media/notebook/manifest.v1.json";

// Presentation-only milestones. A milestone unlocks or updates a physical page;
// it does not create a Story coordinate or persist reader state.
const NOTEBOOK_EVENTS = Object.freeze([
  // P01: dream entry, later completed with the Rubtsov call and circled name.
  { id: "N01", kind: "line", contentId: "ch01.earth.010", afterLineIndex: 41 },
  { id: "N02", kind: "line", contentId: "ch01.earth.010", afterLineIndex: 46 },
  // Two distinct Kremlin folios arise during the examination, before gloves come off.
  { id: "N03", kind: "line", contentId: "ch02.earth.003", afterLineIndex: 24 },
  { id: "N04", kind: "content", contentId: "ch02.earth.004", edge: "after" },
  // One chronology page, existing two graphic revisions preserved.
  { id: "N05", kind: "line", contentId: "ch03.earth.002", afterLineIndex: 42 },
  { id: "N06", kind: "line", contentId: "ch03.earth.002", afterLineIndex: 47 },
  // Retrospective five-folio set: all available from first Earth paragraph of CH05,
  // not during the CH04 events depicted by the drawings.
  { id: "N07", kind: "line", contentId: "ch05.earth.001", afterLineIndex: 0 },
  { id: "N08", kind: "content", contentId: "ch05.earth.001", edge: "after" },
  { id: "N09", kind: "line", contentId: "ch05.earth.009", afterLineIndex: 19 },
  { id: "N10", kind: "line", contentId: "ch05.earth.011", afterLineIndex: 22 },
  { id: "N11", kind: "line", contentId: "ch05.earth.011", afterLineIndex: 42 },
  { id: "N12", kind: "line", contentId: "ch07.earth.004", afterLineIndex: 48 },
  { id: "N13", kind: "line", contentId: "ch08.earth.002", afterLineIndex: 7 },
  { id: "N14", kind: "line", contentId: "ch10.earth.004", afterLineIndex: 42 },
  { id: "N15", kind: "line", contentId: "ch10.earth.005", afterLineIndex: 4 },
  { id: "N16", kind: "line", contentId: "ch12.earth.009", afterLineIndex: 91 },
].map((event) => Object.freeze({ ...event, available: true, state: event.id })));

// Pure presentation cues. Page revisions N01-N16 remain independent.
const NOTEBOOK_POSSESSION_EVENTS = Object.freeze([
  Object.freeze({ id: "NOTEBOOK_TAKEN", kind: "line", contentId: "ch10.earth.002", afterLineIndex: 2, available: false }),
  Object.freeze({ id: "NOTEBOOK_RETURNED", kind: "line", contentId: "ch10.earth.006", afterLineIndex: 5, available: true }),
]);
const EMPTY_EVENTS = Object.freeze([]);
const HIDDEN = Object.freeze({ available: false, state: null });

// For the one already-authorized scene on reload, compute the established
// notebook prefix without relying on browser scroll history.
const CHAPTER_BASELINES = Object.freeze({
  "01:earth": null, "01:heaven": "N02",
  "02:earth": "N02", "02:heaven": "N04",
  "03:earth": "N04", "03:heaven": "N06",
  "04:earth": "N06", "04:heaven": "N06",
  "05:earth": "N06", "05:heaven": "N11",
  "06:earth": "N11", "06:heaven": "N11",
  "07:earth": "N11", "07:heaven": "N12",
  "08:earth": "N12", "08:heaven": "N13",
  "09:earth": "N13", "09:heaven": "N13",
  "10:earth": "N13", "10:heaven": "N15",
  "11:earth": "N15", "11:heaven": "N15",
  "12:earth": "N15", "12:heaven": "N16",
});

function projection(state) {
  return state ? Object.freeze({ available: true, state }) : HIDDEN;
}

export function notebookEventPlan() {
  return NOTEBOOK_EVENTS;
}

export function notebookEventsForContent(contentId, edge = "after") {
  if (typeof contentId !== "string") return EMPTY_EVENTS;
  const events = NOTEBOOK_EVENTS.filter((event) => event.kind === "content" && event.contentId === contentId && event.edge === edge);
  return events.length ? Object.freeze(events) : EMPTY_EVENTS;
}

export function notebookLineBoundaries(contentId) {
  if (typeof contentId !== "string") return EMPTY_EVENTS;
  const events = NOTEBOOK_EVENTS
    .filter((event) => event.kind === "line" && event.contentId === contentId)
    .map(({ id, afterLineIndex }) => Object.freeze({ id, afterLineIndex }));
  return events.length ? Object.freeze(events) : EMPTY_EVENTS;
}

export function notebookEventById(id) {
  return NOTEBOOK_EVENTS.find((event) => event.id === id) ?? null;
}

export function notebookEventsForBlocks(blocks) {
  const ids = new Set((Array.isArray(blocks) ? blocks : []).map((block) => block?.content_id).filter(Boolean));
  const events = NOTEBOOK_EVENTS.filter((event) => ids.has(event.contentId));
  return events.length ? Object.freeze(events) : EMPTY_EVENTS;
}

export function notebookPossessionEventsForBlocks(blocks) {
  const ids = new Set((Array.isArray(blocks) ? blocks : []).map((block) => block?.content_id).filter(Boolean));
  const events = NOTEBOOK_POSSESSION_EVENTS.filter((event) => ids.has(event.contentId));
  return events.length ? Object.freeze(events) : EMPTY_EVENTS;
}

export function notebookIconVisible(layer, available, possessed = true) {
  return layer === "earth" && Boolean(available) && Boolean(possessed);
}

function baselineForBlocks(blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const contentId = typeof block?.content_id === "string" ? block.content_id : "";
    let match = /^ch(\d{2})\.(earth|heaven)(?:\.|$)/u.exec(contentId);
    if (match) return projection(CHAPTER_BASELINES[match[1] + ":" + match[2]]);
    match = /^l3\.L3V-CH(\d{2})-/u.exec(contentId);
    if (match) return projection(CHAPTER_BASELINES[match[1] + ":earth"]);
  }
  return HIDDEN;
}

export function notebookProjectionForBlocks(blocks, { settled = false } = {}) {
  const matching = notebookEventsForBlocks(blocks);
  if (!matching.length) return baselineForBlocks(blocks);
  if (settled) return projection(matching.at(-1).id);
  const first = NOTEBOOK_EVENTS.indexOf(matching[0]);
  return first > 0 ? projection(NOTEBOOK_EVENTS[first - 1].id) : HIDDEN;
}

export { installLiteraryBoundaryProjection as installNotebookBoundaryProjection } from "./literary-boundary.mjs";

const EMPTY_PRESENTATION = Object.freeze({ pages: EMPTY_EVENTS, focusIndex: 0 });

export async function loadNotebookPresentation(state) {
  const reached = /^N(\d{2})$/u.exec(state ?? "");
  if (!reached || Number(reached[1]) > NOTEBOOK_EVENTS.length || Number(reached[1]) < 1) return EMPTY_PRESENTATION;

  let manifest;
  try {
    const response = await fetch(NOTEBOOK_MANIFEST_PATH, { method: "GET", credentials: "same-origin" });
    if (!response.ok) throw new Error("HTTP_" + response.status);
    manifest = await response.json();
  } catch (error) {
    console.warn("MEDIA_NOTEBOOK_MANIFEST_UNAVAILABLE", error);
    return EMPTY_PRESENTATION;
  }

  if (manifest?.schema !== "donskoy.notebook-presentation.v1" || !Array.isArray(manifest.pages)) {
    console.warn("MEDIA_NOTEBOOK_MANIFEST_INVALID", NOTEBOOK_MANIFEST_PATH);
    return EMPTY_PRESENTATION;
  }

  const pages = [];
  let lastChange = -1;
  let focusIndex = 0;
  for (const item of manifest.pages) {
    if (typeof item?.id !== "string" || !Array.isArray(item.revisions)) continue;
    const revision = item.revisions
      .filter((r) => /^N\d{2}$/u.test(r?.at ?? "") && Number(r.at.slice(1)) <= Number(reached[1]))
      .at(-1);
    if (!revision || typeof revision.src !== "string" || !revision.src.startsWith("/media/notebook/")) continue;
    pages.push({ id: item.id, src: revision.src, alt: item.id + " · Levshin notebook" });
    const changedAt = Number(revision.at.slice(1));
    if (changedAt >= lastChange) {
      lastChange = changedAt;
      focusIndex = pages.length - 1;
    }
  }
  return { pages, focusIndex };
}

function createButton(className, label, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = text;
  return button;
}


function installNotebookImageZoom(image, stage, viewport) {
  let pressTimer = 0;
  let press = null;
  let longPressed = false;

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
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
      press = null;
      stopPress();
    }
  };
  const onPointerUp = (event) => {
    if (!press || event.pointerId !== press.id) return;
    press = null;
    stopPress();
    if (!longPressed) setZoom(stage.dataset.zoomed !== "true");
  };
  const onPointerCancel = () => { press = null; stopPress(); };
  const onContextMenu = (event) => event.preventDefault();

  image.addEventListener("pointerdown", onPointerDown);
  image.addEventListener("pointermove", onPointerMove);
  image.addEventListener("pointerup", onPointerUp);
  image.addEventListener("pointercancel", onPointerCancel);
  image.addEventListener("keydown", onImageKey);
  image.addEventListener("contextmenu", onContextMenu);

  return {
    reset() {
      stopPress();
      press = null;
      longPressed = false;
      setZoom(false);
    },
    dispose() {
      stopPress();
      press = null;
      image.removeEventListener("pointerdown", onPointerDown);
      image.removeEventListener("pointermove", onPointerMove);
      image.removeEventListener("pointerup", onPointerUp);
      image.removeEventListener("pointercancel", onPointerCancel);
      image.removeEventListener("keydown", onImageKey);
      image.removeEventListener("contextmenu", onContextMenu);
    },
  };
}

export function createNotebookViewer(root) {
  const overlay = root.querySelector("[data-reader-overlay]");
  const flow = root.querySelector("[data-reader-flow]");
  const controls = root.querySelector(".reader-controls");
  if (!(overlay instanceof HTMLElement) || !(flow instanceof HTMLElement)) {
    return Object.freeze({ present: () => false, close: () => {} });
  }

  let zoomCleanup = null;
  let replacePages = null;
  let viewerRevision = 0;

  function isOpen() {
    return !overlay.hidden && overlay.dataset.variant === "notebook" && replacePages !== null;
  }

  function close() {
    if (overlay.dataset.variant !== "notebook") return;
    zoomCleanup?.();
    zoomCleanup = null;
    replacePages = null;
    viewerRevision += 1;
    overlay.hidden = true;
    overlay.replaceChildren();
    delete overlay.dataset.variant;
    document.documentElement.classList.remove("reader-notebook-open");
    flow.inert = false;
    if (controls instanceof HTMLElement) controls.inert = false;
  }

  function present({ pages, focusIndex = 0 } = {}) {
    if (!overlay.hidden || !Array.isArray(pages) || pages.length === 0) return false;
    let currentPages = pages;
    let displayedSrc = null;
    let pageIndex = Math.max(0, Math.min(currentPages.length - 1, focusIndex));

    const backdrop = document.createElement("div");
    backdrop.className = "reader-overlay__backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("section");
    dialog.className = "reader-overlay__dialog reader-overlay__dialog--notebook";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Notebook");
    dialog.tabIndex = -1;

    const topbar = document.createElement("div");
    topbar.className = "reader-overlay__topbar reader-overlay__topbar--notebook";
    const title = document.createElement("span");
    title.textContent = "NOTEBOOK";
    const closeButton = createButton("reader-overlay__icon-close", "Close notebook", "×");
    closeButton.addEventListener("click", close);
    topbar.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "reader-overlay__notebook-body";
    const viewport = document.createElement("div");
    viewport.className = "reader-overlay__cover-viewport";
    const stage = document.createElement("div");
    stage.className = "reader-overlay__cover-stage";
    const image = document.createElement("img");
    image.className = "reader-overlay__notebook-image reader-overlay__cover-image";
    image.decoding = "async";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Toggle 4x notebook page zoom");
    image.draggable = false;
    stage.append(image);
    viewport.append(stage);
    body.append(viewport);
    const zoom = installNotebookImageZoom(image, stage, viewport);
    zoomCleanup = zoom.dispose;

    const nav = document.createElement("div");
    nav.className = "reader-overlay__notebook-nav";
    const previous = createButton("reader-overlay__notebook-nav-button", "Previous notebook page", "←");
    const counter = document.createElement("span");
    counter.className = "reader-overlay__notebook-counter";
    const next = createButton("reader-overlay__notebook-nav-button", "Next notebook page", "→");
    nav.append(previous, counter, next);

    const renderPage = ({ resetZoom = true } = {}) => {
      const page = currentPages[pageIndex];
      if (resetZoom) zoom.reset();
      if (displayedSrc !== page.src) {
        image.src = page.src;
        displayedSrc = page.src;
      }
      image.alt = page.alt;
      counter.textContent = `${page.id} · ${pageIndex + 1} / ${currentPages.length}`;
      previous.disabled = pageIndex === 0;
      next.disabled = pageIndex === currentPages.length - 1;
    };

    // A projected revision can arrive while the dialog is open. Preserve the
    // selected physical folio rather than switching to the newest page.
    replacePages = (nextPages) => {
      if (!Array.isArray(nextPages) || nextPages.length === 0) return false;
      const selected = currentPages[pageIndex];
      const selectedIndex = nextPages.findIndex((page) => page.id === selected.id);
      const nextIndex = selectedIndex >= 0 ? selectedIndex : Math.min(pageIndex, nextPages.length - 1);
      const nextPage = nextPages[nextIndex];
      const imageChanged = nextPage.id !== selected.id || nextPage.src !== selected.src;
      currentPages = nextPages;
      pageIndex = nextIndex;
      renderPage({ resetZoom: imageChanged });
      return true;
    };
    previous.addEventListener("click", () => {
      if (pageIndex === 0) return;
      pageIndex -= 1;
      renderPage();
    });
    next.addEventListener("click", () => {
      if (pageIndex >= currentPages.length - 1) return;
      pageIndex += 1;
      renderPage();
    });

    dialog.append(topbar, body, nav);
    overlay.replaceChildren(backdrop, dialog);
    overlay.dataset.variant = "notebook";
    overlay.hidden = false;
    document.documentElement.classList.add("reader-notebook-open");
    flow.inert = true;
    if (controls instanceof HTMLElement) controls.inert = true;
    viewerRevision += 1;
    renderPage();
    requestAnimationFrame(() => dialog.focus({ preventScroll: true }));
    return true;
  }

  function refresh({ pages, revision } = {}) {
    if (!isOpen() || revision !== viewerRevision) return false;
    return replacePages(pages);
  }

  return Object.freeze({ present, close, refresh, isOpen,
    get revision() { return viewerRevision; },
  });
}
