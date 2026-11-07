import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NARRATIVE_IMAGE_PATHS,
  NARRATIVE_GALLERY_ITEMS,
  narrativeGalleryBaseline,
  narrativeProseImageAfter,
  narrativeProseImageAtStart,
  narrativeHiddenSystemImage,
  narrativeScenePreloadImage,
  narrativeSceneTransitionImage,
} from "../../src/reader/media-image-plan.mjs";

const source = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const reader = source("src/reader/presentation.mjs").replaceAll("\r\n", "\n");
const runtime = source("src/runtime/reader-runtime.mjs");

test("four presentation-only image slots and canonical trigger identities", () => {
  assert.deepEqual(Object.keys(NARRATIVE_IMAGE_PATHS), ["DREAM_01", "DREAM_02", "FIELD_OVERLAP", "CHEST_BPP"]);
  assert.equal(NARRATIVE_IMAGE_PATHS.CHEST_BPP, "/media/images/chest-bpp.webp");
  assert.deepEqual(narrativeProseImageAtStart("ch04.heaven.002"), {
    id: "IMAGE_4", src: NARRATIVE_IMAGE_PATHS.CHEST_BPP, variant: "chest-bpp", holdMs: 2000,
  });
  assert.equal(narrativeProseImageAtStart("ch04.heaven.001"), null);
  assert.equal(narrativeProseImageAtStart("ch05.heaven.002"), null);
  assert.equal(NARRATIVE_IMAGE_PATHS.DREAM_01, "/media/images/dream-01.webp");
  assert.equal(NARRATIVE_IMAGE_PATHS.DREAM_02, "/media/images/dream-02.webp");
  assert.equal(NARRATIVE_IMAGE_PATHS.FIELD_OVERLAP, "/media/images/field-overlap.webp");
  assert.deepEqual(narrativeProseImageAfter("ch01.earth.001"), {
    id: "IMAGE_1", src: NARRATIVE_IMAGE_PATHS.DREAM_01, variant: "dream-01", holdMs: 2000,
  });
  assert.equal(narrativeProseImageAfter("ch01.earth.002"), null);
  assert.deepEqual(narrativeHiddenSystemImage("l3.L3V-CH05-004"), {
    id: "IMAGE_2", src: NARRATIVE_IMAGE_PATHS.DREAM_02, variant: "dream-02", holdMs: 2000,
  });
  assert.equal(narrativeHiddenSystemImage("l3.L3V-CH05-004.a")?.id, "IMAGE_2");
  assert.equal(narrativeHiddenSystemImage("l3.L3V-CH05-003"), null);
  const field = {
    id: "IMAGE_3", src: NARRATIVE_IMAGE_PATHS.FIELD_OVERLAP,
    variant: "field-overlap", holdMs: 3000, rotate180: true,
  };
  assert.deepEqual(narrativeScenePreloadImage("ch08.earth.packet.001"), field);
  assert.deepEqual(narrativeSceneTransitionImage("ch08.earth.packet.001", "ch08.earth.packet.002"), field);
  for (const scene of ["ch07.heaven.packet.001", "ch08.earth.packet.002", "ch08.heaven.packet.001"]) {
    assert.equal(narrativeScenePreloadImage(scene), null);
  }
  for (const [from, to] of [
    ["ch08.earth.packet.001", "ch08.earth.packet.001"],
    ["ch08.earth.packet.002", "ch08.earth.packet.002"],
    ["ch07.heaven.packet.001", "ch08.earth.packet.001"],
    ["ch08.earth.packet.002", "ch08.heaven.packet.001"],
  ]) assert.equal(narrativeSceneTransitionImage(from, to), null);
});

test("Images reuses five canonical assets and restores only reached story milestones", () => {
  assert.deepEqual(NARRATIVE_GALLERY_ITEMS.map((item) => item.id),
    ["COVER", "IMAGE_1", "IMAGE_4", "IMAGE_2", "IMAGE_3"]);
  assert.deepEqual(NARRATIVE_GALLERY_ITEMS.map((item) => item.src), [
    "/media/outer/cover-00.webp", NARRATIVE_IMAGE_PATHS.DREAM_01,
    NARRATIVE_IMAGE_PATHS.CHEST_BPP, NARRATIVE_IMAGE_PATHS.DREAM_02,
    NARRATIVE_IMAGE_PATHS.FIELD_OVERLAP,
  ]);
  assert.deepEqual(narrativeGalleryBaseline("ch01.earth.packet.001"), []);
  assert.deepEqual(narrativeGalleryBaseline("ch01.earth.packet.001", { settled: true }), ["IMAGE_1"]);
  assert.deepEqual(narrativeGalleryBaseline("ch01.heaven.packet.001"), ["IMAGE_1"]);
  assert.deepEqual(narrativeGalleryBaseline("ch04.heaven.packet.001"), ["IMAGE_1"]);
  assert.deepEqual(narrativeGalleryBaseline("ch04.heaven.packet.001", { settled: true }), ["IMAGE_1", "IMAGE_4"]);
  assert.deepEqual(narrativeGalleryBaseline("ch05.earth.packet.001"), ["IMAGE_1", "IMAGE_4"]);
  assert.deepEqual(narrativeGalleryBaseline("ch05.earth.packet.001", { settled: true }), ["IMAGE_1", "IMAGE_4", "IMAGE_2"]);
  assert.deepEqual(narrativeGalleryBaseline("ch05.earth.packet.002"), ["IMAGE_1", "IMAGE_4", "IMAGE_2"]);
  assert.deepEqual(narrativeGalleryBaseline("ch05.heaven.packet.001"), ["IMAGE_1", "IMAGE_4", "IMAGE_2"]);
  assert.deepEqual(narrativeGalleryBaseline("ch08.earth.packet.001"), ["IMAGE_1", "IMAGE_4", "IMAGE_2"]);
  assert.deepEqual(narrativeGalleryBaseline("ch08.earth.packet.002"), ["IMAGE_1", "IMAGE_4", "IMAGE_2", "IMAGE_3"]);
  assert.deepEqual(narrativeGalleryBaseline("ch12.heaven.packet.001"), ["IMAGE_1", "IMAGE_4", "IMAGE_2", "IMAGE_3"]);
  assert.deepEqual(narrativeGalleryBaseline("BOOTSTRAP"), []);
  assert.match(runtime, /surface\.setGalleryBaseline\(narrativeGalleryBaseline\(scene\.id, \{ settled \}\)\)/u);
  assert.match(reader, /galleryUnlocked\.add\(cue\.id\)/u);
  assert.match(reader, /galleryUnlocked\.clear\(\)/u);
});

test("Dream 01 publishes continuous prose DOM; image is a boundary side effect", () => {
  const start = reader.indexOf("const run = (async () =>");
  const end = reader.indexOf("settlements.set(section, run)", start);
  const run = reader.slice(start, end);
  const a = run.indexOf('if (primitive.kind === "literary")');
  const b = run.indexOf('if (primitive.kind === "supreme")', a);
  const literary = run.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(literary, /appendLiteraryPrimitive\(sectionFlow, primitive\.blocks, \{ settled, signal \}\)/);
  assert.match(literary, /remainingBlocks = remainingBlocks\.slice\(primitive\.blocks\.length\)/);
  assert.doesNotMatch(literary, /imageIndex|visibleBlocks|await.*[Ii]mage|waitForLiteraryBoundaryActivation/);

  const appendAt = reader.indexOf("function appendLiteraryPrimitive(");
  const appendEnd = reader.indexOf("function appendFrontier(", appendAt);
  const append = reader.slice(appendAt, appendEnd);
  assert.match(append, /const imageCue = narrativeProseImageAfter\(block\?\.content_id\)/);
  assert.match(append, /if \(imageCue\) armNarrativeImageAfter\(node, imageCue, signal\)/);
  assert.match(append, /sectionFlow\.append\(scene\)/);
  assert.match(reader, /function armNarrativeImageAfter\(node, cue, signal, beforeShow = null, afterCue = null, onImageVisible = null\)/);
  assert.match(reader, /const reached = waitForLiteraryBoundaryActivation\(node, flow, signal, "after"\)\.then/);
  assert.match(reader, /if \(cue\) void presentNarrativeImage\(cue, signal, onImageVisible\)/);
  assert.doesNotMatch(run, /await presentNarrativeImage|await waitForLiteraryBoundaryActivation/);
});

test("Dream 02 audio and image do not block subsequent L3 publication", () => {
  const a = reader.indexOf("const hiddenAudio = hiddenSystemAudioPlan(");
  const b = reader.indexOf("const frontier = appendFrontier(", a);
  const hidden = reader.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.match(hidden, /hiddenAudio\.afterContentId/);
  assert.match(hidden, /reached: armNarrativeImageAfter\(anchor, hiddenImage, signal,/);
  assert.match(hidden, /audioSession\.playPathWhenReady\(hiddenAudio\.src, hiddenAudio\.cueId, signal\)/);
  assert.match(hidden, /remainingBlocks = remainingBlocks\.slice\(primitive\.blocks\.length\)/);
  assert.match(hidden, /pendingHiddenBoundary = \{/);
  assert.match(hidden, /typeof onCausalBoundary === "function" \? \(\) => onCausalBoundary\(boundary\) : null/);
  assert.match(hidden, /if \(settled && typeof onCausalBoundary === "function"\)/);
  const frontierAt = reader.indexOf("const frontier = appendFrontier(sectionFlow, primitive.blocks)");
  const boundaryAt = reader.indexOf("const replacement = await pending.reached", frontierAt);
  const typingAt = reader.indexOf('frontier.wrapper.dataset.frontierState = "streaming"', frontierAt);
  assert.ok(frontierAt >= 0 && boundaryAt > frontierAt && typingAt > boundaryAt,
    "the next L3 frontier occupies DOM before semantic boundary completes, but never types in a stale language");
  assert.match(reader, /const localized = sliceAfterContentId\(replacement.blocks, pending.afterContentId\)/);
  assert.match(reader, /frontier.blocks = first.blocks/);
  assert.match(reader, /remainingBlocks = remainingBlocks.slice\(frontier.blocks.length\)/);
  assert.doesNotMatch(hidden, /await presentNarrativeImage|await waitForLiteraryBoundaryActivation/);
});

test("Field Overlap follows the CH08 scene boundary, independent of OPEN versus CONTINUE", () => {
  const start = runtime.indexOf("async function mutateThenLoad(command)");
  const end = runtime.indexOf("async function renderBootstrap(", start);
  const body = runtime.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const acceptedAt = body.indexOf("if (!result) return false;");
  const cueAt = body.indexOf("const transitionImage = narrativeSceneTransitionImage(previousSceneId, currentState.cursor_scene_id)");
  const loadAt = body.indexOf("await loadCurrentScene({ narrativeImage: transitionImage })");
  assert.ok(acceptedAt >= 0 && cueAt > acceptedAt && loadAt > cueAt);
  assert.doesNotMatch(body, /narrativeAcceptedGateImage|gateImage/);
  assert.doesNotMatch(body, /await surface\.presentNarrativeImage|setBusy\(true\)/);
  const snapshotAt = runtime.indexOf("async function renderSnapshot(");
  const sceneMountAt = runtime.indexOf("const section = surface.renderLiterary(", snapshotAt);
  const presentAt = runtime.indexOf("if (narrativeImage && !settled) void surface.presentNarrativeImage(narrativeImage)", snapshotAt);
  assert.ok(sceneMountAt > snapshotAt && presentAt > sceneMountAt);
  assert.match(runtime, /async function loadCurrentScene\(\{ settled = false, narrativeImage = null \} = \{\}\)/);
  assert.match(runtime, /preloadImage: narrativeScenePreloadImage\(scene\.id\)/);
  assert.match(reader, /if \(preloadImage\?\.src\) prefetchNarrativeImage\(preloadImage\.src\)/);
  assert.match(reader, /readyNarrativeImage\(cue\.src\)/);
  assert.match(reader, /await waitVisiblePeriod\(holdMs, signal\)/);
  assert.doesNotMatch(source("src/reader/media-image-plan.mjs"), /narrativeAcceptedGateImage/);
});

test("no optional image is a build dependency or new Story authority", () => {
  const build = source("scripts/build-pages-shell.mjs");
  assert.match(build, /copyOptionalMedia/);
  assert.doesNotMatch(reader, /\/api\/media|localStorage|sessionStorage/);
  assert.doesNotMatch(source("src/reader/media-image-plan.mjs"), /fetch\(|localStorage|sessionStorage|revision|cursor_scene_id/);
});

test("image effects preserve four visual beats across desktop/mobile and FIELD makes two measured half-turns", () => {
  const css = source("src/reader/causal.css");
  assert.match(reader, /overlayRoot\.dataset\.imageCue = cue\.variant/);
  assert.match(reader, /if \(dialog\?\.isConnected && overlayRoot\.dataset\.variant === "narrative-image"\) closeOverlay\(\)/);
  assert.match(reader, /delete overlayRoot\.dataset\.imageCue/);
  assert.match(reader, /if \(cue\.rotate180\) image\.dataset\.rotate180 = "true"/);
  assert.match(reader, /await waitVisiblePeriod\(holdMs, signal\)/);
  assert.match(reader, /if \(cue\) void presentNarrativeImage\(cue, signal, onImageVisible\)/);
  for (const name of ["narrative-memory-flash", "narrative-forced-memory", "narrative-reality-tear"]) {
    assert.ok(css.includes("@keyframes " + name), name);
  }
  for (const key of ["dream-01", "dream-02", "field-overlap", "chest-bpp"]) {
    assert.ok(css.includes('data-image-cue="' + key + '"'), key);
  }
  assert.match(css, /rotate\(180deg\)/);
  assert.doesNotMatch(css, /scaleX\(-1\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-rotate180="true"/);
  assert.match(css, /animation: [^;]+var\(--narrative-image-duration, 2000ms\)/);
  const field = css.slice(css.indexOf("/* FIELD makes exactly two readable 180-degree turns"), css.indexOf("/* Preserve the same intentional four cinematic beats"));
  assert.match(field, /0%[^}]+rotate\(0deg\)/);
  assert.match(field, /16\.667%[^}]+rotate\(0deg\)/);
  assert.match(field, /41\.667%[^}]+rotate\(180deg\)/);
  assert.match(field, /58\.333%[^}]+rotate\(180deg\)/);
  assert.match(field, /83\.333%[^}]+rotate\(360deg\)/);
  assert.match(field, /100%[^}]+rotate\(360deg\)/);
  assert.match(field, /animation: narrative-reality-tear var\(--narrative-image-duration, 3000ms\)/);
  assert.match(css, /data-image-cue="field-overlap"[^}]+::before \{[^}]+animation-duration: var\(--narrative-image-duration, 3000ms\)/s);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transform: rotate\(180deg\)/);
  assert.doesNotMatch(field, /scaleX\(-1\)/);
});

test("Dream 02 fires audio only as the image becomes visible, without extending its hold", () => {
  assert.match(reader, /reached: armNarrativeImageAfter\(anchor, hiddenImage, signal,/);
  assert.match(reader, /audioSession\.playPathWhenReady\(hiddenAudio\.src, hiddenAudio\.cueId, signal\)/);
  assert.match(reader, /cueId: "CH05_DREAM_HORROR"/);
  assert.match(reader, /afterContentId: "ch05\.earth\.003"/);
  assert.doesNotMatch(reader, /\.pause\(\)|audioSession\.stop|audioSession\.mute/);
});

test("narrative images begin preload before the prose boundary and cannot block reading for 8 seconds", () => {
  assert.match(reader, /const narrativeImageCache = new Map\(\)/);
  assert.match(reader, /function prefetchNarrativeImage\(src\)/);
  assert.match(reader, /const NARRATIVE_IMAGE_READY_GRACE_MS = 150/);
  assert.match(reader, /Promise\.race\(\[\s*entry\.ready,/);
  assert.match(reader, /image\.decode\(\)\.then/);
  assert.match(reader, /const cue = narrativeProseImageAfter\(block\?\.content_id\)\s*\?\? narrativeHiddenSystemImage\(block\?\.content_id\)/);
  assert.match(reader, /if \(cue\) prefetchNarrativeImage\(cue\.src\)/);
  assert.match(reader, /await readyNarrativeImage\(cue\.src\)/);
  assert.match(reader, /MEDIA_IMAGE_NOT_READY/);
  assert.doesNotMatch(reader, /NARRATIVE_IMAGE_LOAD_TIMEOUT_MS|await loadNarrativeImage/);
  const prefetchAt = reader.indexOf("if (!settled) {\n      for (const block of blocks)");
  const startAt = reader.indexOf("const run = (async () =>", prefetchAt);
  assert.ok(prefetchAt >= 0 && startAt > prefetchAt, "image prefetch starts before narrative flow");
  assert.doesNotMatch(reader.slice(startAt), /await readyNarrativeImage|await presentNarrativeImage/);
});


test("desktop portrait composition preserves original frames on all three cues without changing mobile", () => {
  const css = source("src/reader/causal.css");
  const desktopStart = css.indexOf("@media (min-width: 900px) and (min-aspect-ratio: 4/3) {");
  const ambientEnd = css.indexOf("@keyframes narrative-desktop-ambient", desktopStart);
  assert.ok(desktopStart > 0 && ambientEnd > desktopStart, "wide-screen override exists");
  const desktop = css.slice(desktopStart, ambientEnd);
  for (const [cue, image] of [
    ["dream-01", "/media/images/dream-01.webp"],
    ["dream-02", "/media/images/dream-02.webp"],
    ["field-overlap", "/media/images/field-overlap.webp"],
    ["chest-bpp", "/media/images/chest-bpp.webp"],
  ]) {
    assert.ok(desktop.includes('data-image-cue="' + cue + '"'), cue + " has its own ambient source");
    assert.ok(desktop.includes('url("' + image + '")'), cue + " reuses its canonical asset");
  }
  const originalSizing = css.slice(
    css.indexOf(".reader-overlay__narrative-image {"),
    css.indexOf("/* Cinematic image intrusions", css.indexOf(".reader-overlay__narrative-image {")),
  );
  assert.match(originalSizing, /width: 100%;/u);
  assert.match(originalSizing, /height: 100%;/u);
  assert.match(originalSizing, /object-fit: contain;/u);
  assert.doesNotMatch(css, /object-fit: cover;/u, "foreground artwork must never be cropped");

  assert.match(desktop, /background-size: cover;/u);
  assert.match(desktop, /filter: blur\(clamp\(/u);
  assert.match(desktop, /animation: narrative-desktop-ambient var\(--narrative-image-duration, 2000ms\)/u);
  assert.match(desktop, /\.reader-overlay__narrative-image \{\s*position: relative;\s*z-index: 1;/u);
  assert.match(desktop, /field-overlap[^}]+::before \{\s*transform: rotate\(180deg\);/su);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /@keyframes narrative-desktop-ambient/u);

  const reader = source("src/reader/presentation.mjs").replaceAll("\r\n", "\n");
  assert.match(reader, /await waitVisiblePeriod\(holdMs, signal\)/u);
  assert.doesNotMatch(reader, /narrative-desktop-ambient|desktop-backdrop|imageDesktop/u);
});

test("CH04 image appears with first line, not when the entire block ends", () => {
  const source = reader;
  assert.match(source, /block\?\.content_id === "ch04\.heaven\.002"/);
  assert.match(source, /const lineEnd = text\.indexOf\("\\n"\)/);
  assert.match(source, /text\.slice\(0, lineEnd\)/);
  assert.match(source, /document\.createTextNode\(text\.slice\(lineEnd\)\)/);
  assert.match(source, /waitForLiteraryBoundaryActivation\(node, flow, signal, "start"\)/);
  assert.match(source, /armNarrativeImageAtStart\(anchor, onsetCue, signal\)/);
  assert.match(source, /if \(onsetCue\) prefetchNarrativeImage\(onsetCue\.src\)/);
  assert.doesNotMatch(source, /armNarrativeImageAfter\(node, onsetCue/);
  const styles = readFileSync(new URL("../../src/reader/causal.css", import.meta.url), "utf8");
  assert.match(styles, /data-image-cue="chest-bpp"[^}]+narrative-memory-flash var\(--narrative-image-duration, 2000ms\)/s);
});

test("FIELD readiness is at most 150ms, with a distinct 3000ms visible hold", () => {
  const plan = source("src/reader/media-image-plan.mjs");
  assert.match(reader, /const NARRATIVE_IMAGE_READY_GRACE_MS = 150;/);
  assert.match(reader, /async function readyNarrativeImage\(src\)/);
  assert.match(reader, /window.setTimeout\(resolve, NARRATIVE_IMAGE_READY_GRACE_MS\)/);
  assert.match(reader, /readyNarrativeImage\(cue.src\)/);
  assert.match(plan, /variant: "field-overlap", holdMs: 3000, rotate180: true/);
  assert.doesNotMatch(plan, /readyGraceMs/);
  assert.match(reader, /await waitVisiblePeriod\(holdMs, signal\)/);
  assert.doesNotMatch(plan, /gate_id|canonical_action_id|RESOLVE_GATE/);
});


test("desktop reduced-motion preference does not shorten cinematic image animations", () => {
  const css = source("src/reader/causal.css");
  const global = source("src/reader/reader.css");
  assert.match(global, /animation-duration: \.001ms !important/);
  const motion = css.slice(css.indexOf("/* Preserve the same intentional four cinematic beats"),
    css.indexOf("/* Image tool uses the existing Reader media overlay"));
  assert.ok(motion.startsWith("/* Preserve"), "specific reduced-motion exception must exist");
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motion, /\.reader-overlay\[data-variant="narrative-image"\] \.reader-overlay__narrative-image/);
  assert.match(motion, /\.reader-overlay\[data-variant="narrative-image"\] \.reader-overlay__dialog--narrative-image::before/);
  assert.match(motion, /animation-duration: var\(--narrative-image-duration, 2000ms\) !important/);
  assert.doesNotMatch(motion, /animation: none|display: none|filter: none/);
  assert.match(reader, /overlayRoot\.style\.setProperty\("--narrative-image-duration"/);
  assert.match(reader, /overlayRoot\.style\.removeProperty\("--narrative-image-duration"\)/);
  assert.match(reader, /await waitVisiblePeriod\(holdMs, signal\)/);
  const field = css.slice(css.indexOf("@keyframes narrative-reality-tear"),
    css.indexOf('.reader-overlay[data-image-cue="field-overlap"] .reader-overlay__narrative-image'));
  for (const angle of [0, 180, 360]) {
    assert.ok(field.includes("rotate(" + angle + "deg)"), "missing field angle " + angle);
  }
});
