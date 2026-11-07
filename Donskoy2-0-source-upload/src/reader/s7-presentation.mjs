import { speakerAccent } from "./speaker-palette.mjs";

const CUE_URL = "/assets/reader/layer1-earth-dialogue-cues.generated.json";
const CUE_SCHEMA = "donskoy.layer1-earth-dialogue-cues.v1";
const CURRENT_RELEASE_ID = 114009;
const DOCUMENT_TEXT_COORDINATES = new Map([
  ["ch03.earth.004", new Set([5])],
  ["ch12.earth.003", new Set([38])],
  ["ch12.earth.006", new Set([1, 2, 3, 4])],
]);

function fail(message) {
  throw new Error(`S7 presentation rejected: ${message}`);
}

function requireCueDocument(document, releaseId) {
  if (!document || typeof document !== "object") fail("speaker cue document missing");
  if (document.schema !== CUE_SCHEMA) fail("speaker cue schema mismatch");
  if (releaseId !== CURRENT_RELEASE_ID || Number(document.release_id) !== CURRENT_RELEASE_ID) fail("speaker cue release mismatch");
  if (!Array.isArray(document.cues)) fail("speaker cue array missing");
  if (!Number.isInteger(Number(document.source_rows)) || Number(document.source_rows) < document.cues.length) fail("speaker source-row metadata invalid");
  if (!Number.isInteger(Number(document.runtime_cues)) || Number(document.runtime_cues) !== document.cues.length) fail("speaker cue metadata mismatch");
  if (!Number.isInteger(Number(document.runtime_speaker_ids)) || Number(document.runtime_speaker_ids) < 0) fail("speaker identity metadata invalid");
  if (document.runtime_inference !== false) fail("runtime speaker inference must remain disabled");
  return document;
}

async function loadCueAuthority(releaseId) {
  const response = await fetch(CUE_URL, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) fail(`speaker cue authority unavailable (${response.status})`);
  return requireCueDocument(await response.json(), releaseId);
}

function indexCues(document) {
  const byContentId = new Map();
  const coordinates = new Set();
  const speakers = new Set();

  for (const cue of document.cues) {
    if (!cue || typeof cue.contentId !== "string" || !/^ch\d{2}\.earth\./u.test(cue.contentId)) {
      fail("invalid Earth cue content identity");
    }
    if (!Number.isInteger(cue.paragraphIndex) || cue.paragraphIndex < 0) fail(`invalid paragraph coordinate for ${cue.contentId}`);
    if (typeof cue.speakerId !== "string" || !speakerAccent(cue.speakerId)) fail(`unknown speaker identity ${String(cue.speakerId)}`);

    const coordinate = `${cue.contentId}:${cue.paragraphIndex}`;
    if (coordinates.has(coordinate)) fail(`duplicate speaker coordinate ${coordinate}`);
    coordinates.add(coordinate);
    speakers.add(cue.speakerId);

    const bucket = byContentId.get(cue.contentId) ?? new Map();
    bucket.set(cue.paragraphIndex, cue.speakerId);
    byContentId.set(cue.contentId, bucket);
  }

  if (speakers.size !== Number(document.runtime_speaker_ids)) fail("speaker identity metadata disagrees with resolved cues");
  return byContentId;
}

function speakerTurn(text, speakerId) {
  const accent = speakerAccent(speakerId);
  if (!accent) fail(`speaker palette missing ${speakerId}`);
  const turn = document.createElement("span");
  turn.className = "reader-block__speaker-turn";
  turn.dataset.speaker = speakerId;
  turn.style.setProperty("--speaker-accent-dark", accent.dark);
  turn.style.setProperty("--speaker-accent-light", accent.light);
  turn.textContent = text;
  return turn;
}

// CH11 Heaven court: keep canonical speaker identities on DOM labels.
// Only their presentation colors reuse Earth classes as artistic parallels.
const COURT_LABEL_SPEAKERS = Object.freeze({
  "ПИСЕЦ": "speaker.okayanny-scribe",
  "ДИМИТРИЙ": "DMITRY_DONSKOY",
  "СЕРГИЙ": "SERGIUS_RADONEZH",
  "БОРИС": "BORIS",
  "ГЛЕБ": "GLEB",
  "СКАЗИТЕЛЬ": "speaker.okayanny-storyteller",
  "СВЯТОПОЛК": "speaker.okayanny-svyatopolk",
  "ПИСЕЦЬ": "speaker.okayanny-scribe",
  "ДИМИТРІЙ": "DMITRY_DONSKOY",
  "СЕРГІЙ": "SERGIUS_RADONEZH",
  "ГЛІБ": "GLEB",
  "SCRIBE": "speaker.okayanny-scribe",
  "DMITRY": "DMITRY_DONSKOY",
  "SERGIUS": "SERGIUS_RADONEZH",
  "BORIS": "BORIS",
  "GLEB": "GLEB",
  "STORYTELLER": "speaker.okayanny-storyteller",
  "SVYATOPOLK": "speaker.okayanny-svyatopolk",
});

// One CH11 presentation override; no global palette edits or speaker identity merges.
const COURT_COLOR_CLASS_BY_SPEAKER = Object.freeze({
  "speaker.okayanny-scribe": "family.ru-apparatus",
  DMITRY_DONSKOY: "speaker.arkady",
  SERGIUS_RADONEZH: "speaker.father-pavel",
  BORIS: "speaker.high-cossack",
  GLEB: "speaker.shvedov",
  "speaker.okayanny-storyteller": "family.generic-service",
  "speaker.okayanny-svyatopolk": "speaker.rubtsov",
});

function decorateHeavenCourtBlock(block) {
  if (document.documentElement.dataset.storyReleaseId !== String(CURRENT_RELEASE_ID)) return;
  if (!block.matches?.(".reader-block[data-content-id^='ch11.heaven.']") || !block.closest(".chapter-section--heaven")) return;
  const copy = block.querySelector(".reader-block__text");
  if (!(copy instanceof HTMLElement) || copy.dataset.courtLabelsApplied === "true") return;
  const source = copy.textContent ?? "";
  const fragment = document.createDocumentFragment();
  let hits = 0;
  for (const part of source.split(/(\n+)/u)) {
    const found = /^([^:\n]+)(:\s*—\s*)/u.exec(part);
    const speaker = found ? COURT_LABEL_SPEAKERS[found[1]] : null;
    if (!speaker || !found) {
      fragment.append(document.createTextNode(part));
      continue;
    }
    const accent = speakerAccent(COURT_COLOR_CLASS_BY_SPEAKER[speaker] ?? speaker);
    if (!accent) fail(`CH11 court speaker accent missing: ${speaker}`);
    const label = document.createElement("span");
    label.className = "reader-block__court-label";
    label.dataset.speaker = speaker;
    label.style.setProperty("--speaker-accent-dark", accent.dark);
    label.style.setProperty("--speaker-accent-light", accent.light);
    label.textContent = found[1];
    fragment.append(label, document.createTextNode(part.slice(found[1].length)));
    hits += 1;
  }
  if (hits === 0) return;
  copy.replaceChildren(fragment);
  copy.dataset.courtLabelsApplied = "true";
}

function documentText(text) {
  const span = document.createElement("span");
  span.className = "reader-block__document-text";
  span.textContent = text;
  return span;
}

function decorateEarthBlock(block, cueByContentId) {
  if (!(block instanceof HTMLElement)) return;
  if (!block.matches(".reader-block[data-content-id]") || !block.closest(".chapter-section--earth")) return;

  const contentId = block.dataset.contentId;
  const cues = cueByContentId.get(contentId);
  const documentParagraphs = DOCUMENT_TEXT_COORDINATES.get(contentId);
  if ((!cues || cues.size === 0) && (!documentParagraphs || documentParagraphs.size === 0)) return;

  const copy = block.querySelector(".reader-block__text");
  if (!(copy instanceof HTMLElement) || copy.dataset.dialogueAccentsApplied === "true") return;

  const parts = (copy.textContent ?? "").split(/(\n+)/u);
  const fragment = document.createDocumentFragment();
  const applied = new Set();
  let paragraphIndex = 0;

  for (const part of parts) {
    if (/^\n+$/u.test(part)) {
      fragment.append(document.createTextNode(part));
      continue;
    }

    if (documentParagraphs?.has(paragraphIndex)) {
      fragment.append(documentText(part));
    } else {
      const speakerId = cues?.get(paragraphIndex);
      if (speakerId) {
        fragment.append(speakerTurn(part, speakerId));
        applied.add(paragraphIndex);
      } else {
        fragment.append(document.createTextNode(part));
      }
    }
    paragraphIndex += 1;
  }

  if (applied.size !== (cues?.size ?? 0)) fail(`speaker cues no longer match paragraph topology for ${contentId}`);
  copy.replaceChildren(fragment);
  copy.dataset.dialogueAccentsApplied = "true";
}

function decorateAddedNode(node, cueByContentId) {
  if (!(node instanceof HTMLElement)) return;
  decorateEarthBlock(node, cueByContentId);
  decorateHeavenCourtBlock(node);
  for (const block of node.querySelectorAll(".reader-block[data-content-id]")) {
    decorateEarthBlock(block, cueByContentId);
    decorateHeavenCourtBlock(block);
  }
}

function installSpeakerProjection(root, cueByContentId) {
  const flow = root.querySelector("[data-reader-flow]");
  if (!(flow instanceof HTMLElement)) fail("reader flow missing for speaker projection");

  for (const block of flow.querySelectorAll(".reader-block[data-content-id]")) {
    decorateEarthBlock(block, cueByContentId);
    decorateHeavenCourtBlock(block);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) decorateAddedNode(node, cueByContentId);
    }
  });
  observer.observe(flow, { childList: true, subtree: true });
  return observer;
}

function readerTopLine(root) {
  const statusbar = root.querySelector(".reader-statusbar");
  return Math.max(0, statusbar?.getBoundingClientRect().bottom ?? 0) + 10;
}

function landSectionAtReaderTop(root, section) {
  if (!(section instanceof HTMLElement) || !section.matches(".chapter-section")) return;
  const scrolling = document.scrollingElement;
  if (!scrolling) fail("document scrolling element unavailable for navigation landing");
  const delta = section.getBoundingClientRect().top - readerTopLine(root);
  if (!Number.isFinite(delta)) fail("navigation landing geometry is invalid");
  if (Math.abs(delta) >= 0.5) scrolling.scrollTop += delta;
  section.dataset.navigationLanding = "settled";
}

function installNavigationLanding(root) {
  const flow = root.querySelector("[data-reader-flow]");
  if (!(flow instanceof HTMLElement)) fail("reader flow missing for navigation landing");

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.matches(".chapter-section")) {
          landSectionAtReaderTop(root, node);
        }
      }
    }
  });

  // Only a freshly materialized top-level literary section is a navigation landing.
  // Layer-3 frontiers and later causal descendants are intentionally ignored.
  observer.observe(flow, { childList: true, subtree: false });
  return observer;
}

export function installS7Presentation(root) {
  if (!(root instanceof HTMLElement)) throw new TypeError("S7 presentation root must be HTMLElement");
  const landingObserver = installNavigationLanding(root);
  let speakerObserver = null;
  let cueLoad = null;
  let disconnected = false;
  let cueAttempts = 0;
  let cueRetryTimer = null;
  const MAX_CUE_ATTEMPTS = 3;

  function ensureSpeakerProjection() {
    if (disconnected || speakerObserver || cueLoad || cueRetryTimer !== null || cueAttempts >= MAX_CUE_ATTEMPTS) return;
    const releaseId = Number(document.documentElement.dataset.storyReleaseId);
    if (releaseId !== CURRENT_RELEASE_ID) return;
    cueAttempts += 1;
    cueLoad = loadCueAuthority(releaseId)
      .then((cueDocument) => {
        if (disconnected) return;
        speakerObserver = installSpeakerProjection(root, indexCues(cueDocument));
      })
      .catch((error) => {
        console.error("S7 speaker authority unavailable", error);
        // Retry transient sidecar failures without requiring a language toggle.
        // Never block Reader; stop after a bounded number of attempts.
        if (!disconnected && !speakerObserver && cueAttempts < MAX_CUE_ATTEMPTS) {
          cueRetryTimer = window.setTimeout(() => {
            cueRetryTimer = null;
            ensureSpeakerProjection();
          }, 400 * cueAttempts);
        }
      })
      .finally(() => {
        cueLoad = null;
      });
  }

  const languageObserver = new MutationObserver(ensureSpeakerProjection);
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-story-release-id"] });
  ensureSpeakerProjection();

  return Object.freeze({
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      if (cueRetryTimer !== null) window.clearTimeout(cueRetryTimer);
      cueRetryTimer = null;
      languageObserver.disconnect();
      speakerObserver?.disconnect();
      landingObserver.disconnect();
    },
  });
}
