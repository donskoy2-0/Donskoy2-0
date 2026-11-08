// Presentation-only image cues.
// No Story cursor, gate, persisted state, media registry, or second overlay.
export const NARRATIVE_IMAGE_PATHS = Object.freeze({
  DREAM_01: "/media/images/dream-01.webp",
  DREAM_02: "/media/images/dream-02.webp",
  FIELD_OVERLAP: "/media/images/field-overlap.webp",
  CHEST_BPP: "/media/images/chest-bpp.webp",
});

const DREAM_01 = Object.freeze({
  id: "IMAGE_1", src: NARRATIVE_IMAGE_PATHS.DREAM_01, variant: "dream-01", holdMs: 2000,
});
const DREAM_02 = Object.freeze({
  id: "IMAGE_2", src: NARRATIVE_IMAGE_PATHS.DREAM_02, variant: "dream-02", holdMs: 2000,
});
const FIELD = Object.freeze({
  id: "IMAGE_3", src: NARRATIVE_IMAGE_PATHS.FIELD_OVERLAP,
  variant: "field-overlap", holdMs: 3000, rotate180: true,
});

const CHEST_BPP = Object.freeze({
  id: "IMAGE_4", src: NARRATIVE_IMAGE_PATHS.CHEST_BPP,
  variant: "chest-bpp", holdMs: 2000,
});

// Existing cover plus the four canonical story cues, ordered by first appearance.
// This is a presentation-only gallery, not a second narrative media scheduler.
export const NARRATIVE_GALLERY_ITEMS = Object.freeze([
  Object.freeze({ id: "COVER", src: "/media/outer/cover-00.webp", label: "COVER" }),
  Object.freeze({ id: DREAM_01.id, src: DREAM_01.src, label: "DREAM 01" }),
  Object.freeze({ id: CHEST_BPP.id, src: CHEST_BPP.src, label: "CHEST" }),
  Object.freeze({ id: DREAM_02.id, src: DREAM_02.src, label: "DREAM 02" }),
  Object.freeze({ id: FIELD.id, src: FIELD.src, label: "FIELD OVERLAP" }),
]);

// On a new/reloaded scene, recover only earlier story milestones from the
// existing canonical scene coordinate. Cues in the active scene unlock at
// their actual on-screen appearance (or when that scene is rendered settled).
// REWIND/RESTART therefore recompute the prefix without separate storage.
export function narrativeGalleryBaseline(sceneId, { settled = false } = {}) {
  const match = /^ch(\d{2})\.(earth|heaven)\.packet\.(\d{3})$/u.exec(sceneId ?? "");
  if (!match) return [];
  const chapter = Number(match[1]);
  const layer = match[2];
  const packet = Number(match[3]);
  const shown = new Set();
  if (chapter > 1 || layer === "heaven" || packet > 1 || settled) shown.add(DREAM_01.id);
  if (chapter > 4 || (chapter === 4 && layer === "heaven" && (packet > 1 || settled))) shown.add(CHEST_BPP.id);
  if (chapter > 5 || (chapter === 5 && (layer === "heaven" || packet > 1 || settled))) shown.add(DREAM_02.id);
  if (chapter > 8 || (chapter === 8 && (layer === "heaven" || (layer === "earth" && packet > 1)))) shown.add(FIELD.id);
  return NARRATIVE_GALLERY_ITEMS.filter((item) => shown.has(item.id)).map((item) => item.id);
}

// Fires as the first CH04 line enters the reading frontier (not after the
// complete prose block). All three languages share this content identity.
export function narrativeProseImageAtStart(contentId) {
  return contentId === "ch04.heaven.002" ? CHEST_BPP : null;
}

export function narrativeProseImageAfter(contentId) {
  return contentId === "ch01.earth.001" ? DREAM_01 : null;
}

export function narrativeHiddenSystemImage(contentId) {
  return typeof contentId === "string" && /^l3\.L3V-CH05-004(?:\.|$)/u.test(contentId) ? DREAM_02 : null;
}

// Warm the optional picture while CH08 Earth part 1 is being read.
// This does not alter the story or depend on any reader decision.
export function narrativeScenePreloadImage(sceneId) {
  return sceneId === "ch08.earth.packet.001" ? FIELD : null;
}

// IMAGE 3 is a presentation beat of entering Earth part 2, regardless of
// OPEN_FIELD_OBSERVATION versus CONTINUE. Never replay it for same-scene
// semantic acceptance, snapshots, language changes or rejected commands.
export function narrativeSceneTransitionImage(previousSceneId, nextSceneId) {
  return previousSceneId === "ch08.earth.packet.001" &&
    nextSceneId === "ch08.earth.packet.002" ? FIELD : null;
}
