import { createDisplayController } from "./display.mjs";
import { audioSession } from "./audio-session.mjs";
import { installLiteraryBoundaryProjection } from "./literary-boundary.mjs";
import { mediaAudioEventsForBlocks } from "./media-audio-plan.mjs";
import {
  createNotebookViewer,
  installNotebookBoundaryProjection,
  loadNotebookPresentation,
  notebookEventsForBlocks,
  notebookPossessionEventsForBlocks,
  notebookIconVisible,
  notebookProjectionForBlocks,
} from "./notebook.mjs";
import { createReaderSurface } from "./presentation.mjs";
import { installNavigationConfirmation } from "./navigation-confirm.mjs";

const LANGUAGES = new Set(["ru", "en", "ua"]);
const L3_PARAGRAPH_BREAKS = Object.freeze({
  "l3.L3V-CH02-004": Object.freeze([
    "commit(\"dmitry_donskoy.auth.0001\")",
  ]),
  "l3.L3V-CH03-002": Object.freeze([
    "commit(\"levshin.log.0002\")",
    "pattern.observe(\"09:17\")",
  ]),
  "l3.L3V-CH03-006": Object.freeze([
    "institutional_policy.evaluate(CONTINUATION_BEHAVIOR)",
  ]),
  "l3.L3V-CH03-007": Object.freeze([
    "commit(\"levshin.preparation.0001\")",
  ]),
  "l3.L3V-CH04-002": Object.freeze([
    "identity.compare(DMITRY_IVANOVICH_SAFONOV, DMITRY_DONSKOY)",
  ]),
  "l3.L3V-CH04-005": Object.freeze([
    "subject.status.set(ARKADY_LEVSHIN, TEMPORARY_SERVICE_MEMBER)",
    "commit(\"chapter04.contract.bound\")",
  ]),
  "l3.L3V-CH04-009": Object.freeze([
    "commit(\"chapter04.d2.spawned\")",
  ]),
  "l3.L3V-CH04-010": Object.freeze([
    "transport_unit.bind(CAPSULE_1380_DI_02_17_VK, TRANSPORT_UNIT_1380_DI_02_17)",
    "seal.bind(\"047821\", TRANSPORT_UNIT_1380_DI_02_17)",
    "commit(\"chapter04.container.bound\")",
  ]),
  "l3.L3V-CH04-012": Object.freeze([
    "subject_will.set(ARKADY_LEVSHIN, ESCORT_ROLE, CONFIRMED)",
    "input.trace.register(\"SIGNATURE_0003\")",
    "commit(\"chapter04.escort.accepted\")",
  ]),
  "l3.L3V-CH04-013": Object.freeze([
    "dependency_graph.open(DMITRY_DONSKOY)",
  ]),
  "l3.L3V-CH05-002": Object.freeze([
    "transport_chain.checkpoint(\"LEVSHIN_HOME\")",
    "commit(\"chapter05.home.checkpoint\")",
  ]),
  "l3.L3V-CH05-008": Object.freeze([
    "transport_chain.link.replace(WRIST_CHAIN, WAIST_TETHER)",
    "subject.role.bind(ARKADY_LEVSHIN, ESCORT_47_OPERATIONAL_ALIAS)",
  ]),
  "l3.L3V-CH05-013": Object.freeze([
    "route.update(RECEIVING_UNIT)",
    "commit(\"chapter05.route.unblocked\")",
  ]),
  "l3.L3V-CH05-017": Object.freeze([
    "candidate.propose(MAMAI, WESTERN_SIDE)",
  ]),
  "l3.L3V-CH05-018": Object.freeze([
    "relation.activate(HORDE)",
  ]),
  "l3.L3V-CH06-009": Object.freeze([
    "boundary.test(MOSCOW)",
  ]),
  "l3.L3V-CH06-010": Object.freeze([
    "node.register(RURIK)",
    "RUS.kind = SHARED_HISTORICAL_GRAPH",
  ]),
  "l3.L3V-CH06-013": Object.freeze([
    "boundary.test(ORTHODOX_CHURCH)",
  ]),
});

// Presentation-only opening line breaks; immutable releases remain untouched.
const CH01_OPENING_BREAKS = Object.freeze([
  "Там взял левой рукой гранёный стакан",
  "Потом уселся на табурет",
  "С икон на него смотрели",
  "There he picked up a faceted tumbler",
  "Then he sat down on a stool",
  "Nicholas the Wonderworker",
  "Там лівою рукою взяв гранчасту склянку",
  "Потім усівся на табурет",
  "З ікон на нього дивилися",
]);

export function formatPresentationBlock(block) {
  if (typeof block?.text !== "string") return block;
  if (block.content_id === "ch01.earth.001") {
    let text = block.text;
    for (const phrase of CH01_OPENING_BREAKS) {
      if (text.includes(`\n${phrase}`)) continue;
      text = text.replace(` ${phrase}`, `\n${phrase}`);
    }
    return text === block.text ? block : { ...block, text };
  }
  const breakBefore = L3_PARAGRAPH_BREAKS[block.content_id];
  if (!breakBefore) return block;

  let text = block.text;
  for (const line of breakBefore) {
    if (text.includes(`\n\n${line}`)) continue;
    text = text.replace(`\n${line}`, `\n\n${line}`);
  }
  return text === block.text ? block : { ...block, text };
}

export function mountReaderShell(root, { language = "en", onLanguageRequest = null } = {}) {
  if (!(root instanceof HTMLElement)) throw new TypeError("reader shell root must be HTMLElement");

  const decrease = root.querySelector("[data-font-decrease]");
  const increase = root.querySelector("[data-font-increase]");
  const theme = root.querySelector("[data-theme-toggle]");
  const languageHost = root.querySelector("[data-language-host]");
  const coordinate = root.querySelector("[data-reader-coordinate]");
  const rewind = root.querySelector("[data-reader-rewind]");
  const restart = root.querySelector("[data-reader-restart]");
  const notebook = root.querySelector("[data-reader-notebook]");
  const rail = root.querySelector("[data-history-rail]");
  let languageEnabled = false;
  let languageBusy = false;
  let appliedLanguage = language;
  let projectedLanguage = null;
  let released = false;
  let notebookProjection = Object.freeze({ available: false, state: null });
  let notebookLayer = null;
  let notebookPossessed = true;

  const navigationConfirm = installNavigationConfirmation(root, { getLanguage: () => appliedLanguage });
  let navigationEpoch = 0;
  const display = createDisplayController({ root: document.documentElement, controls: { decrease, increase, theme } });
  const surfaceBase = createReaderSurface(root);
  const notebookViewer = createNotebookViewer(root);
  const notebookWatchers = new Set();
  const mediaAudioWatchers = new Set();

  function clearNotebookWatchers() {
    for (const disconnect of notebookWatchers) disconnect();
    notebookWatchers.clear();
  }

  function clearMediaAudioWatchers() {
    for (const disconnect of mediaAudioWatchers) disconnect();
    mediaAudioWatchers.clear();
  }

  async function openNotebook(expectedState) {
    const { pages, focusIndex } = await loadNotebookPresentation(expectedState);
    if (released || !notebookIconVisible(notebookLayer, notebookProjection.available, notebookPossessed) ||
      notebookProjection.state !== expectedState || pages.length === 0) return;
    notebookViewer.present({ pages, focusIndex });
  }

  async function refreshNotebook(expectedState, revision) {
    const { pages } = await loadNotebookPresentation(expectedState);
    if (released || !notebookViewer.isOpen() || notebookViewer.revision !== revision ||
      !notebookIconVisible(notebookLayer, notebookProjection.available, notebookPossessed) ||
      notebookProjection.state !== expectedState || pages.length === 0) return;
    notebookViewer.refresh({ pages, revision });
  }

  function syncNotebookButton() {
    const visible = notebookIconVisible(notebookLayer, notebookProjection.available, notebookPossessed);
    if (!visible) notebookViewer.close();
    setNotebook({
      available: visible,
      state: notebookProjection.state,
      onOpen: visible && notebookProjection.state
        ? () => void openNotebook(notebookProjection.state)
        : null,
    });
  }

  function applyNotebookProjection(next) {
    const previousState = notebookProjection.state;
    notebookProjection = Object.freeze({
      available: Boolean(next?.available),
      state: typeof next?.state === "string" ? next.state : null,
    });
    syncNotebookButton();
    // Progression normally pauses while the dialog is open (flow is inert),
    // but an already-scheduled milestone can resolve after opening it.
    if (notebookViewer.isOpen() && notebookProjection.state !== previousState) {
      void refreshNotebook(notebookProjection.state, notebookViewer.revision)
        .catch((error) => console.warn("MEDIA_NOTEBOOK_REFRESH_UNAVAILABLE", error));
    }
  }

  function applyNotebookPossession(event) {
    notebookPossessed = event.available;
    syncNotebookButton();
  }

  const surface = Object.freeze({
    ...surfaceBase,
    clearFlow: () => {
      clearNotebookWatchers();
      clearMediaAudioWatchers();
      notebookViewer.close();
      notebookLayer = null;
      notebookPossessed = true;
      applyNotebookProjection({ available: false, state: null });
      surfaceBase.clearFlow();
    },
    renderLiterary: (input) => {
      const onCausalBoundary = input?.onCausalBoundary;
      const blocks = Array.isArray(input?.blocks) ? input.blocks.map(formatPresentationBlock) : input?.blocks;
      notebookLayer = input?.layer;
      applyNotebookProjection(notebookProjectionForBlocks(blocks, { settled: Boolean(input?.settled) }));
      const section = surfaceBase.renderLiterary({
        ...input,
        blocks,
        onCausalBoundary: typeof onCausalBoundary === "function"
          ? async (...args) => {
              const replacement = await onCausalBoundary(...args);
              if (!Array.isArray(replacement?.blocks)) return replacement;
              return { ...replacement, blocks: replacement.blocks.map(formatPresentationBlock) };
            }
          : onCausalBoundary,
      });
      if (!input?.settled) {
        const mediaEvents = mediaAudioEventsForBlocks(blocks);
        if (mediaEvents.length > 0) {
          const controller = new AbortController();
          const disconnect = installLiteraryBoundaryProjection(section, root, {
            events: mediaEvents,
            onEvent: (event) => audioSession.playPathWhenReady(event.src, event.id, controller.signal),
          });
          mediaAudioWatchers.add(() => {
            controller.abort();
            disconnect();
          });
        }

        const events = notebookEventsForBlocks(blocks);
        if (events.length > 0) {
          const disconnect = installNotebookBoundaryProjection(section, root, {
            events,
            onEvent: applyNotebookProjection,
          });
          notebookWatchers.add(disconnect);
        }
        const possessionEvents = notebookPossessionEventsForBlocks(blocks);
        if (possessionEvents.length > 0) {
          const disconnect = installNotebookBoundaryProjection(section, root, {
            events: possessionEvents,
            onEvent: applyNotebookPossession,
          });
          notebookWatchers.add(disconnect);
        }
      }
      return section;
    },
    closeNotebookViewer: () => notebookViewer.close(),
    destroy: () => {
      clearNotebookWatchers();
      clearMediaAudioWatchers();
      notebookViewer.close();
      surfaceBase.destroy();
    },
  });

  function languageButtons() {
    return [...(languageHost?.querySelectorAll("button[data-language]") || [])];
  }

  function syncLanguageButtons() {
    for (const button of languageButtons()) {
      const applied = button.dataset.language === appliedLanguage;
      const projected = button.dataset.language === projectedLanguage && !applied;
      button.setAttribute("aria-pressed", String(applied));
      button.toggleAttribute("data-applied", applied);
      button.toggleAttribute("data-projected", projected);
      button.disabled = !languageEnabled || languageBusy || projected;
    }
  }

  function setLanguage(next) {
    if (!LANGUAGES.has(next)) throw new TypeError(`unsupported language: ${next}`);
    appliedLanguage = next;
    if (projectedLanguage === next) projectedLanguage = null;
    document.documentElement.lang = next;
    root.dataset.language = next;
    syncLanguageButtons();
  }

  function setProjectedLanguage(next) {
    if (next !== null && !LANGUAGES.has(next)) throw new TypeError(`unsupported projected language: ${next}`);
    projectedLanguage = next === appliedLanguage ? null : next;
    if (projectedLanguage) root.dataset.projectedLanguage = projectedLanguage;
    else delete root.dataset.projectedLanguage;
    syncLanguageButtons();
  }

  async function requestLanguage(next) {
    if (!languageEnabled || languageBusy || next === projectedLanguage) return;
    if (typeof onLanguageRequest !== "function") return;
    languageBusy = true;
    syncLanguageButtons();
    try {
      const result = await onLanguageRequest(next);
      if (result === true || result?.applied === true) setLanguage(next);
    } finally {
      languageBusy = false;
      syncLanguageButtons();
    }
  }

  if (languageHost) {
    const group = document.createElement("div");
    group.className = "reader-language";
    group.replaceChildren(...["ru", "en", "ua"].map((id) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reader-language__button reader-display__button";
      button.dataset.language = id;
      button.textContent = id.toUpperCase();
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => void requestLanguage(id));
      return button;
    }));
    languageHost.replaceChildren(group);
  }

  function setLanguageEnabled(enabled) {
    languageEnabled = Boolean(enabled);
    syncLanguageButtons();
  }

  function setCoordinate(value) {
    if (!coordinate) return;
    coordinate.textContent = value || "";
    coordinate.hidden = !value;
  }

  function setNotebook({ available = false, state = null, onOpen = null } = {}) {
    if (!(notebook instanceof HTMLButtonElement)) return;
    const enabled = Boolean(available && typeof state === "string" && state && typeof onOpen === "function");
    notebook.hidden = !available;
    notebook.disabled = !enabled;
    notebook.onclick = enabled ? onOpen : null;
    if (typeof state === "string" && state) notebook.dataset.notebookState = state;
    else delete notebook.dataset.notebookState;
  }

  function confirmNavigation(kind, label, source, epoch, action) {
    return navigationConfirm.request({
      kind, label, action,
      valid: () => !released && epoch === navigationEpoch && source.isConnected && !source.disabled,
    });
  }

  function renderRail(points, onRewindPoint, epoch) {
    if (!(rail instanceof HTMLElement)) return;
    const normalized = Array.isArray(points) ? points : [];
    rail.hidden = normalized.length === 0;
    rail.replaceChildren(...normalized.map((point) => {
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = "history-rail__mark";
      mark.dataset.pointId = point.id;
      mark.dataset.reached = String(Boolean(point.reached));
      mark.dataset.current = String(Boolean(point.current));
      mark.disabled = !point.reached || point.current || typeof onRewindPoint !== "function";
      mark.setAttribute("aria-label", point.label || point.id);
      mark.title = point.label || point.id;
      if (!mark.disabled) mark.addEventListener("click", () => confirmNavigation("point", point.label, mark, epoch, () => onRewindPoint(point.id)));
      return mark;
    }));
  }

  function setNavigation({ canRewind = false, canRestart = false, rewindLabel = "", onRewind, onRestart, points = [], onRewindPoint } = {}) {
    navigationEpoch += 1;
    navigationConfirm.cancel(); // invalidate pending consent if the authoritative Story snapshot changes
    const epoch = navigationEpoch;
    if (rewind) {
      rewind.hidden = !canRewind;
      rewind.disabled = !canRewind;
      rewind.onclick = canRewind && typeof onRewind === "function"
        ? () => confirmNavigation("rewind", rewindLabel, rewind, epoch, onRewind)
        : null;
    }
    if (restart) {
      restart.hidden = !canRestart;
      restart.disabled = !canRestart;
      restart.onclick = canRestart && typeof onRestart === "function"
        ? () => confirmNavigation("restart", "", restart, epoch, onRestart)
        : null;
    }
    renderRail(points, onRewindPoint, epoch);
  }

  function confirmSessionReset(action) {
    return navigationConfirm.request({
      kind: "reset",
      action,
      valid: () => !released,
    });
  }

  function release() {
    if (released) return;
    released = true;
    clearNotebookWatchers();
    clearMediaAudioWatchers();
    notebookViewer.close();
    setLanguageEnabled(false);
    setNotebook();
    setNavigation();
    navigationConfirm.dispose();
    display.dispose();
  }

  setLanguage(language);
  setLanguageEnabled(false);
  setNotebook();
  setNavigation();
  return Object.freeze({
    display,
    surface,
    setLanguage,
    setProjectedLanguage,
    setLanguageEnabled,
    setCoordinate,
    setNotebook,
    setNavigation,
    confirmSessionReset,
    release,
  });
}
