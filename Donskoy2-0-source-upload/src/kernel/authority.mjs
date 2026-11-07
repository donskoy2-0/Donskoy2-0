const EXPECTED_LANGUAGES = ["ru", "en", "ua"];
const ALLOWED_RELEASE_IDS = new Set([114009]);
const EXPECTED_SCENE_COUNT = 29;
const EXPECTED_REWIND_POINT_COUNT = 24;
const EXPECTED_GATE_COUNT = 20;
const EXPECTED_ACTION_COUNT = 39;
const EXPECTED_SEMANTIC_ACTION_COUNT = 20;
const EXPECTED_CONTINUATION_COUNT = 19;

function invariant(condition, message) {
  if (!condition) throw new Error(`KERNEL_AUTHORITY_INVALID: ${message}`);
}

function readonlyMap(entries) {
  const map = new Map(entries);
  return Object.freeze({
    get(key) {
      return map.get(key);
    },
    has(key) {
      return map.has(key);
    },
    get size() {
      return map.size;
    },
  });
}

function readonlySet(values) {
  const set = new Set(values);
  return Object.freeze({
    has(value) {
      return set.has(value);
    },
    get size() {
      return set.size;
    },
  });
}

/**
 * Compile transferred machine authority into the minimal immutable lookup shape
 * consumed by the pure semantic reducer. No I/O and no runtime/presentation law.
 */
export function createKernelAuthority({ sceneGraph, rewindPoints, gateActions, languageAuthority }) {
  invariant(sceneGraph && typeof sceneGraph === "object", "sceneGraph missing");
  invariant(rewindPoints && typeof rewindPoints === "object", "rewindPoints missing");
  invariant(gateActions && typeof gateActions === "object", "gateActions missing");
  invariant(languageAuthority && typeof languageAuthority === "object", "languageAuthority missing");

  invariant(ALLOWED_RELEASE_IDS.has(sceneGraph.release?.id), "unsupported release identity");
  invariant(sceneGraph.counts?.scenes === EXPECTED_SCENE_COUNT, "scene count authority must be 29");
  invariant(sceneGraph.counts?.rewind_points === EXPECTED_REWIND_POINT_COUNT, "scene graph rewind count must be 24");
  invariant(sceneGraph.counts?.earth_continuation_nonpoints === 5, "scene graph continuation non-point count must be 5");
  invariant(sceneGraph.coordinates?.story === "cursor_scene_id", "cursor_scene_id must be the Story coordinate");
  invariant(sceneGraph.coordinates?.cas === "revision", "revision must be the CAS coordinate");
  invariant(sceneGraph.coordinates?.other_mutable_story_coordinates === 0, "second Story coordinate is forbidden");
  invariant(Array.isArray(sceneGraph.scenes) && sceneGraph.scenes.length === EXPECTED_SCENE_COUNT, "scene graph must contain 29 rows");
  invariant(Array.isArray(sceneGraph.scene_fields), "scene_fields missing");
  invariant(sceneGraph.initial === "ch01.earth.packet.001", "unexpected initial scene");
  invariant(sceneGraph.terminal === "ch12.heaven.packet.001", "unexpected terminal scene");
  invariant(sceneGraph.pre_scene_gate === "CH01_BOOTSTRAP", "unexpected pre-scene gate");
  invariant(sceneGraph.terminal_gate === "FINAL_ACK_CH12", "unexpected terminal gate");

  const sceneFields = sceneGraph.scene_fields;
  const scenes = sceneGraph.scenes.map((row) => {
    invariant(Array.isArray(row) && row.length === sceneFields.length, "malformed scene row");
    return Object.freeze(Object.fromEntries(sceneFields.map((field, index) => [field, row[index]])));
  });

  const sceneEntries = [];
  const mutableSceneById = new Map();
  const ordinals = new Set();
  for (const scene of scenes) {
    invariant(typeof scene.id === "string" && scene.id.length > 0, "scene id missing");
    invariant(!mutableSceneById.has(scene.id), `duplicate scene ${scene.id}`);
    invariant(Number.isInteger(scene.ordinal) && scene.ordinal >= 0 && scene.ordinal < EXPECTED_SCENE_COUNT, `invalid ordinal for ${scene.id}`);
    invariant(!ordinals.has(scene.ordinal), `duplicate scene ordinal ${scene.ordinal}`);
    ordinals.add(scene.ordinal);
    mutableSceneById.set(scene.id, scene);
    sceneEntries.push([scene.id, scene]);
  }
  invariant([...ordinals].sort((a, b) => a - b).every((value, index) => value === index), "scene ordinals must be contiguous 0..28");

  for (const scene of scenes) {
    if (scene.next !== null) {
      invariant(mutableSceneById.has(scene.next), `scene ${scene.id} has unknown successor ${scene.next}`);
      invariant(mutableSceneById.get(scene.next).ordinal === scene.ordinal + 1, `scene ${scene.id} successor must be the next canonical ordinal`);
    } else {
      invariant(scene.id === sceneGraph.terminal, `only terminal scene may have no successor: ${scene.id}`);
    }
  }
  const sceneById = readonlyMap(sceneEntries);

  invariant(rewindPoints.count === EXPECTED_REWIND_POINT_COUNT, "rewind point authority must be 24");
  invariant(rewindPoints.scene_universe_count === EXPECTED_SCENE_COUNT, "rewind authority scene universe must be 29");
  invariant(Array.isArray(rewindPoints.points) && rewindPoints.points.length === EXPECTED_REWIND_POINT_COUNT, "rewind points must contain 24 rows");
  const rewindIds = [];
  const mutableRewindIds = new Set();
  for (const point of rewindPoints.points) {
    invariant(point.id === point.scene_id, `rewind point identity mismatch ${point.id}`);
    invariant(sceneById.has(point.scene_id), `rewind point references unknown scene ${point.scene_id}`);
    invariant(sceneById.get(point.scene_id).rewind_point === true, `rewind point flag mismatch ${point.scene_id}`);
    invariant(!mutableRewindIds.has(point.id), `duplicate rewind point ${point.id}`);
    mutableRewindIds.add(point.id);
    rewindIds.push(point.id);
  }
  const flaggedRewindIds = scenes.filter((scene) => scene.rewind_point === true).map((scene) => scene.id);
  invariant(flaggedRewindIds.length === EXPECTED_REWIND_POINT_COUNT, "scene flags must expose exactly 24 rewind points");
  invariant(flaggedRewindIds.every((id) => mutableRewindIds.has(id)), "rewind point file must exactly match scene flags");
  invariant(scenes.filter((scene) => scene.rewind_point === false).length === 5, "exactly five scenes must be non-points");
  const rewindPointIds = readonlySet(rewindIds);

  invariant(gateActions.counts?.gates === EXPECTED_GATE_COUNT, "gate authority must contain 20 gates");
  invariant(gateActions.counts?.actions === EXPECTED_ACTION_COUNT, "gate authority must contain 39 actions");
  invariant(gateActions.counts?.semantic_actions === EXPECTED_SEMANTIC_ACTION_COUNT, "gate authority must contain 20 semantic actions");
  invariant(gateActions.counts?.continuations === EXPECTED_CONTINUATION_COUNT, "gate authority must contain 19 continuations");
  invariant(Array.isArray(gateActions.gates) && gateActions.gates.length === EXPECTED_GATE_COUNT, "gate list must contain 20 gates");

  const gateEntries = [];
  const mutableGateById = new Map();
  let actionCount = 0;
  let semanticCount = 0;
  let continuationCount = 0;
  for (const gate of gateActions.gates) {
    invariant(typeof gate.id === "string" && gate.id.length > 0, "gate id missing");
    invariant(!mutableGateById.has(gate.id), `duplicate gate ${gate.id}`);
    const actionEntries = [];
    const actionIds = new Set();
    for (const action of gate.actions ?? []) {
      invariant(typeof action.id === "string" && action.id.startsWith(`${gate.id}.`), `invalid action identity ${action.id}`);
      invariant(action.role === "SEMANTIC_ACTION" || action.role === "CONTINUATION", `invalid role for ${action.id}`);
      invariant(!actionIds.has(action.id), `duplicate action ${action.id}`);
      actionIds.add(action.id);
      actionCount += 1;
      if (action.role === "SEMANTIC_ACTION") semanticCount += 1;
      if (action.role === "CONTINUATION") continuationCount += 1;
      actionEntries.push([action.id, Object.freeze({ ...action })]);
    }
    const frozenGate = Object.freeze({ ...gate, actions: Object.freeze((gate.actions ?? []).map((action) => Object.freeze({ ...action }))), actionById: readonlyMap(actionEntries) });
    mutableGateById.set(gate.id, frozenGate);
    gateEntries.push([gate.id, frozenGate]);
  }
  invariant(actionCount === EXPECTED_ACTION_COUNT, "actual gate action count must be 39");
  invariant(semanticCount === EXPECTED_SEMANTIC_ACTION_COUNT, "actual semantic action count must be 20");
  invariant(continuationCount === EXPECTED_CONTINUATION_COUNT, "actual continuation count must be 19");
  const gateById = readonlyMap(gateEntries);

  invariant(gateById.has(sceneGraph.pre_scene_gate), "pre-scene gate missing from gate authority");
  invariant(gateById.has(sceneGraph.terminal_gate), "terminal gate missing from gate authority");
  const gateLocations = new Map();
  for (const scene of scenes) {
    if (scene.gate_after !== null) {
      invariant(gateById.has(scene.gate_after), `scene ${scene.id} references unknown gate ${scene.gate_after}`);
      invariant(!gateLocations.has(scene.gate_after), `gate ${scene.gate_after} appears after multiple scenes`);
      gateLocations.set(scene.gate_after, scene.ordinal);
    }
  }
  invariant(!gateLocations.has(sceneGraph.pre_scene_gate), "pre-scene gate must not also be a scene gate");
  invariant(gateLocations.get(sceneGraph.terminal_gate) === sceneById.get(sceneGraph.terminal).ordinal, "terminal gate must belong to terminal scene");

  const gateOrdinalEntries = [[sceneGraph.pre_scene_gate, -1], ...gateLocations.entries()];
  const gateSceneOrdinal = readonlyMap(gateOrdinalEntries);

  invariant(JSON.stringify(languageAuthority.languages) === JSON.stringify(EXPECTED_LANGUAGES), "language authority must be exactly ru/en/ua");
  invariant(languageAuthority.default_language === "en", "default language must be en");
  const languages = readonlySet(EXPECTED_LANGUAGES);

  return Object.freeze({
    releaseId: sceneGraph.release.id,
    initialSceneId: sceneGraph.initial,
    terminalSceneId: sceneGraph.terminal,
    preSceneGateId: sceneGraph.pre_scene_gate,
    terminalGateId: sceneGraph.terminal_gate,
    scenes: Object.freeze(scenes),
    sceneById,
    rewindPointIds,
    gateById,
    gateSceneOrdinal,
    languages,
  });
}
