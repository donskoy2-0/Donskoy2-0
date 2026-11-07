import { AUDIO_ASSETS } from "./audio-session.mjs";

const EMPTY_EVENTS = Object.freeze([]);
// Literary audio is keyed by the stable content and its start, line, or end.
// Layer 3 streaming/frontier and image-visible cues retain their own triggers.
const MEDIA_AUDIO_EVENTS = Object.freeze([
  Object.freeze({ id: "CH03_NINTH_CHIME_CLOCK", kind: "line", contentId: "ch03.earth.002", afterLineIndex: 4, src: AUDIO_ASSETS.CLOCK }),
  Object.freeze({ id: "CH05_CLOCK", kind: "line", contentId: "ch05.earth.004", afterLineIndex: 10, src: AUDIO_ASSETS.CLOCK }),
  Object.freeze({ id: "CH06_BOMB_1_DISTANT", kind: "content", contentId: "ch06.earth.003", edge: "after", src: AUDIO_ASSETS.BOMB_1_DISTANT }),
  Object.freeze({ id: "CH08_FIELD_HORSE_TACK", kind: "line", contentId: "ch08.earth.002", afterLineIndex: 43, src: AUDIO_ASSETS.HORSE_NEIGH }),
  Object.freeze({ id: "CH08_FIELD_BOMB_1_DISTANT", kind: "line", contentId: "ch08.earth.002", afterLineIndex: 44, src: AUDIO_ASSETS.BOMB_1_DISTANT }),
  Object.freeze({ id: "CH08_BOMB_2_CLOSE", kind: "content", contentId: "ch08.earth.004", edge: "after", src: AUDIO_ASSETS.BOMB_2_CLOSE }),
  Object.freeze({ id: "CH08_GUN_DRY", kind: "content", contentId: "ch08.earth.010", edge: "after", src: AUDIO_ASSETS.GUN_DRY }),
  Object.freeze({ id: "CH08_BOMB_2_CLOSE_HEAVEN", kind: "content", contentId: "ch08.heaven.001", edge: "start", src: AUDIO_ASSETS.BOMB_2_CLOSE }),
  Object.freeze({ id: "CH08_HORSE_NEIGH", kind: "content", contentId: "ch08.heaven.001", edge: "start", src: AUDIO_ASSETS.HORSE_NEIGH }),
  Object.freeze({ id: "CH08_GUN_BURST", kind: "content", contentId: "ch08.heaven.002", edge: "start", src: AUDIO_ASSETS.GUN_BURST }),
  Object.freeze({ id: "CH09_FAILED_FIRE_GUN_DRY", kind: "content", contentId: "ch09.earth.002", edge: "after", src: AUDIO_ASSETS.GUN_DRY }),
  Object.freeze({ id: "CH10_LOCK_CHAIN_LATCH", kind: "content", contentId: "ch10.earth.001", edge: "after", src: AUDIO_ASSETS.CHAIN_LATCH }),
  Object.freeze({ id: "CH10_GATES_DRY_CLICK", kind: "line", contentId: "ch10.heaven.001", afterLineIndex: 52, src: AUDIO_ASSETS.DRY_CLICK }),
  Object.freeze({ id: "CH12_STONE_CLOSE_DRY_CLICK", kind: "content", contentId: "ch12.earth.004", edge: "after", src: AUDIO_ASSETS.DRY_CLICK }),
  Object.freeze({ id: "CH12_FINAL_DETACH", kind: "content", contentId: "ch12.earth.005", edge: "after", src: AUDIO_ASSETS.CHAIN_LATCH }),
]);

const position = (cue) => cue.kind === "line" ? cue.afterLineIndex : cue.edge === "start" ? -1 : Number.POSITIVE_INFINITY;

export function mediaAudioEventsForBlocks(blocks) {
  const order = new Map((Array.isArray(blocks) ? blocks : []).map((block, index) => [block?.content_id, index]));
  const events = MEDIA_AUDIO_EVENTS.filter(cue => order.has(cue.contentId))
    .sort((a, b) => order.get(a.contentId) - order.get(b.contentId) || position(a) - position(b));
  return events.length ? Object.freeze(events) : EMPTY_EVENTS;
}
