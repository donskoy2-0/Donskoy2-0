import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createKernelAuthority } from "../../src/kernel/authority.mjs";
import { reduce, TERMINAL_PHASE } from "../../src/kernel/reducer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

async function json(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

const sceneGraph = await json("canon/canonical-scenes.v1.json");
const rewindPoints = await json("canon/canonical-points.v1.json");
const gateActions = await json("canon/gate-actions.v1.json");
const languageAuthority = await json("canon/language-authority.v1.json");

const authority = createKernelAuthority({ sceneGraph, rewindPoints, gateActions, languageAuthority });
const scenes = authority.scenes;
const sceneByGate = new Map(scenes.filter((scene) => scene.gate_after !== null).map((scene) => [scene.gate_after, scene]));

function stateAt(sceneId, overrides = {}) {
  return {
    run_id: "run-1",
    content_release_id: 114009,
    cursor_scene_id: sceneId,
    language: "en",
    revision: 7,
    current_run_action_trace: [],
    terminal_phase: TERMINAL_PHASE.ACTIVE,
    ...overrides,
  };
}

function mutationEnvelope(type, overrides = {}) {
  return { type, expected_revision: 7, idempotency_key: `key-${type}`, ...overrides };
}

function semanticAction(gate) {
  return gate.actions.find((action) => action.role === "SEMANTIC_ACTION");
}

function continuationAction(gate) {
  return gate.actions.find((action) => action.role === "CONTINUATION");
}

test("authority is exactly the frozen 29-scene / 24-point topology", () => {
  assert.equal(authority.releaseId, 114009);
  assert.equal(scenes.length, 29);
  assert.equal(new Set(scenes.map((scene) => scene.id)).size, 29);
  assert.deepEqual(scenes.map((scene) => scene.ordinal), [...Array(29).keys()]);
  assert.equal(authority.rewindPointIds.size, 24);
  assert.equal(scenes.filter((scene) => scene.rewind_point === false).length, 5);
  assert.equal(authority.initialSceneId, "ch01.earth.packet.001");
  assert.equal(authority.terminalSceneId, "ch12.heaven.packet.001");
  assert.equal(authority.sceneById.set, undefined);
  assert.equal(authority.rewindPointIds.add, undefined);
  assert.equal(authority.gateById.set, undefined);
});

test("OPEN creates canonical origin with release 114009 and canonical languages only", () => {
  for (const language of ["ru", "en", "ua"]) {
    const result = reduce(null, { type: "OPEN", run_id: `run-${language}`, language, idempotency_key: `open-${language}` }, authority);
    assert.equal(result.ok, true);
    assert.equal(result.nextState.cursor_scene_id, authority.initialSceneId);
    assert.equal(result.nextState.content_release_id, 114009);
    assert.equal(result.nextState.language, language);
    assert.equal(result.nextState.revision, 0);
    assert.deepEqual(result.nextState.current_run_action_trace, []);
    assert.equal(result.nextState.terminal_phase, TERMINAL_PHASE.ACTIVE);
  }

  const invalid = reduce(null, { type: "OPEN", run_id: "run-x", language: "de", idempotency_key: "open-x" }, authority);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "UNSUPPORTED_LANGUAGE");
  assert.equal(invalid.nextState, null);
});

test("all ungated ADVANCE edges follow the exact canonical successor", () => {
  for (const scene of scenes) {
    if (scene.gate_after !== null || scene.next === null) continue;
    const state = stateAt(scene.id);
    const result = reduce(state, mutationEnvelope("ADVANCE"), authority);
    assert.equal(result.ok, true, scene.id);
    assert.equal(result.nextState.cursor_scene_id, scene.next, scene.id);
    assert.equal(result.nextState.revision, state.revision + 1, scene.id);
  }
});

test("ADVANCE cannot bypass any unresolved canonical gate", () => {
  for (const scene of scenes.filter((candidate) => candidate.gate_after !== null)) {
    const state = stateAt(scene.id);
    const result = reduce(state, mutationEnvelope("ADVANCE"), authority);
    assert.equal(result.ok, false, scene.id);
    assert.equal(result.error.code, "GATE_REQUIRED", scene.id);
    assert.equal(result.error.detail, scene.gate_after, scene.id);
    assert.equal(result.nextState, state, scene.id);
  }
});

test("canonical gate/action identity and role are enforced", () => {
  for (const gateRecord of gateActions.gates) {
    const gate = authority.gateById.get(gateRecord.id);
    assert.ok(gate);

    for (const actionRecord of gateRecord.actions) {
      let state;
      if (gateRecord.id === authority.preSceneGateId) {
        state = stateAt(authority.initialSceneId);
      } else {
        const scene = sceneByGate.get(gateRecord.id);
        assert.ok(scene, gateRecord.id);
        state = stateAt(scene.id);
      }

      const result = reduce(
        state,
        mutationEnvelope("RESOLVE_GATE", {
          gate_id: gateRecord.id,
          canonical_action_id: actionRecord.id,
        }),
        authority,
      );

      if (gateRecord.id === authority.terminalGateId && actionRecord.role === "CONTINUATION") {
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "TERMINAL_CONTINUATION_NOT_AUTHORITY");
        continue;
      }

      assert.equal(result.ok, true, `${gateRecord.id}/${actionRecord.id}`);
      if (actionRecord.role === "SEMANTIC_ACTION") {
        const last = result.nextState.current_run_action_trace.at(-1);
        assert.equal(last.canonical_gate_id, gateRecord.id);
        assert.equal(last.canonical_action_id, actionRecord.id);
      } else {
        assert.equal(result.nextState.current_run_action_trace.length, 0);
        assert.equal(result.nextState.cursor_scene_id, sceneByGate.get(gateRecord.id).next);
      }
    }
  }
});

test("invalid and mismatched gate/action identities mutate nothing", () => {
  const scene = sceneByGate.get("CH04_PROCEDURE");
  const state = stateAt(scene.id);

  const unknownGate = reduce(state, mutationEnvelope("RESOLVE_GATE", { gate_id: "NOPE", canonical_action_id: "NOPE.ACTION" }), authority);
  assert.equal(unknownGate.ok, false);
  assert.equal(unknownGate.error.code, "UNKNOWN_GATE");
  assert.equal(unknownGate.nextState, state);

  const wrongAction = reduce(state, mutationEnvelope("RESOLVE_GATE", { gate_id: "CH04_PROCEDURE", canonical_action_id: "CH05_ROUTE.OPEN_ROUTE_SEGMENT_MODEL" }), authority);
  assert.equal(wrongAction.ok, false);
  assert.equal(wrongAction.error.code, "UNKNOWN_GATE_ACTION");
  assert.equal(wrongAction.nextState, state);

  const wrongCurrentGate = reduce(state, mutationEnvelope("RESOLVE_GATE", { gate_id: "CH05_ROUTE", canonical_action_id: "CH05_ROUTE.OPEN_ROUTE_SEGMENT_MODEL" }), authority);
  assert.equal(wrongCurrentGate.ok, false);
  assert.equal(wrongCurrentGate.error.code, "GATE_NOT_CURRENT");
  assert.equal(wrongCurrentGate.nextState, state);
});

test("every ordinary paired nonterminal gate converges on scene.next in exactly one mutation", () => {
  const ordinaryScenes = scenes.filter(
    (scene) => scene.gate_after !== null && scene.gate_after !== authority.terminalGateId,
  );
  assert.ok(ordinaryScenes.length > 0);

  for (const scene of ordinaryScenes) {
    const gate = authority.gateById.get(scene.gate_after);
    const semantic = semanticAction(gate);
    const continuation = continuationAction(gate);
    assert.ok(semantic, gate.id);
    assert.ok(continuation, gate.id);
    assert.ok(scene.next, gate.id);

    const state = stateAt(scene.id);
    const decided = reduce(
      state,
      mutationEnvelope("RESOLVE_GATE", { gate_id: gate.id, canonical_action_id: semantic.id }),
      authority,
    );
    const continued = reduce(
      state,
      mutationEnvelope("RESOLVE_GATE", { gate_id: gate.id, canonical_action_id: continuation.id }),
      authority,
    );

    assert.equal(decided.ok, true, `${gate.id}/decision`);
    assert.equal(continued.ok, true, `${gate.id}/continue`);
    assert.equal(decided.nextState.cursor_scene_id, scene.next, `${gate.id}/decision`);
    assert.equal(continued.nextState.cursor_scene_id, scene.next, `${gate.id}/continue`);
    assert.equal(decided.nextState.cursor_scene_id, continued.nextState.cursor_scene_id, gate.id);
    assert.equal(decided.nextState.revision, state.revision + 1, `${gate.id}/decision`);
    assert.equal(continued.nextState.revision, state.revision + 1, `${gate.id}/continue`);

    assert.equal(decided.nextState.current_run_action_trace.length, state.current_run_action_trace.length + 1, gate.id);
    assert.deepEqual(decided.nextState.current_run_action_trace.at(-1), {
      ordinal_within_current_run_projection: state.current_run_action_trace.length + 1,
      canonical_gate_id: gate.id,
      canonical_action_id: semantic.id,
    });
    assert.deepEqual(continued.nextState.current_run_action_trace, state.current_run_action_trace, gate.id);

    assert.deepEqual(decided.consequences.map((item) => item.type), ["SEMANTIC_ACTION_ACCEPTED", "CURSOR_COMMITTED"], gate.id);
    assert.deepEqual(continued.consequences.map((item) => item.type), ["GATE_CONTINUED", "CURSOR_COMMITTED"], gate.id);
    assert.deepEqual(decided.consequences.at(-1), { type: "CURSOR_COMMITTED", from: scene.id, to: scene.next }, gate.id);
    assert.deepEqual(continued.consequences.at(-1), { type: "CURSOR_COMMITTED", from: scene.id, to: scene.next }, gate.id);
  }
});

test("CH01_BOOTSTRAP remains semantic, trace-recording and non-advancing", () => {
  const gate = authority.gateById.get(authority.preSceneGateId);
  const semantic = semanticAction(gate);
  const state = stateAt(authority.initialSceneId);
  const result = reduce(
    state,
    mutationEnvelope("RESOLVE_GATE", { gate_id: gate.id, canonical_action_id: semantic.id }),
    authority,
  );

  assert.equal(result.ok, true);
  assert.equal(result.nextState.cursor_scene_id, authority.initialSceneId);
  assert.equal(result.nextState.revision, state.revision + 1);
  assert.equal(result.nextState.current_run_action_trace.length, 1);
  assert.deepEqual(result.consequences.map((item) => item.type), ["SEMANTIC_ACTION_ACCEPTED", "FIRST_STORY_AUTHORIZED"]);
  assert.equal(result.consequences.some((item) => item.type === "CURSOR_COMMITTED"), false);
});

test("RELOAD preserves every exact committed scene and does not mutate revision", () => {
  for (const scene of scenes) {
    const state = stateAt(scene.id, { revision: scene.ordinal });
    const result = reduce(state, { type: "RELOAD" }, authority);
    assert.equal(result.ok, true, scene.id);
    assert.equal(result.nextState, state, scene.id);
    assert.equal(result.nextState.cursor_scene_id, scene.id, scene.id);
    assert.equal(result.nextState.revision, scene.ordinal, scene.id);
  }
});

test("REWIND accepts only 24 points and rejects all five continuation non-points", () => {
  const end = stateAt(authority.terminalSceneId);
  const nonPoints = scenes.filter((scene) => scene.rewind_point === false);
  assert.equal(nonPoints.length, 5);

  for (const scene of nonPoints) {
    const result = reduce(end, mutationEnvelope("REWIND", { point_id: scene.id }), authority);
    assert.equal(result.ok, false, scene.id);
    assert.equal(result.error.code, "INVALID_REWIND_POINT", scene.id);
  }

  const arbitrary = reduce(end, mutationEnvelope("REWIND", { point_id: "ch99.earth.packet.001" }), authority);
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.error.code, "INVALID_REWIND_POINT");

  const target = "ch08.heaven.packet.001";
  const valid = reduce(end, mutationEnvelope("REWIND", { point_id: target }), authority);
  assert.equal(valid.ok, true);
  assert.equal(valid.nextState.cursor_scene_id, target);
});

test("REWIND truncates downstream semantic facts and renumbers retained projection", () => {
  const trace = [
    { ordinal_within_current_run_projection: 1, canonical_gate_id: "CH01_BOOTSTRAP", canonical_action_id: "CH01_BOOTSTRAP.APPLY" },
    { ordinal_within_current_run_projection: 2, canonical_gate_id: "CH04_PROCEDURE", canonical_action_id: "CH04_PROCEDURE.OPEN_SEPARATION_MODEL" },
    { ordinal_within_current_run_projection: 3, canonical_gate_id: "CH05_ROUTE", canonical_action_id: "CH05_ROUTE.OPEN_ROUTE_SEGMENT_MODEL" },
    { ordinal_within_current_run_projection: 4, canonical_gate_id: "CH06_CLASSIFICATION", canonical_action_id: "CH06_CLASSIFICATION.COMPARE_CLASSIFICATION_CONTEXT" },
  ];
  const state = stateAt("ch07.heaven.packet.001", { current_run_action_trace: trace });
  const result = reduce(state, mutationEnvelope("REWIND", { point_id: "ch05.earth.packet.001" }), authority);
  assert.equal(result.ok, true);
  assert.deepEqual(result.nextState.current_run_action_trace, [
    { ordinal_within_current_run_projection: 1, canonical_gate_id: "CH01_BOOTSTRAP", canonical_action_id: "CH01_BOOTSTRAP.APPLY" },
    { ordinal_within_current_run_projection: 2, canonical_gate_id: "CH04_PROCEDURE", canonical_action_id: "CH04_PROCEDURE.OPEN_SEPARATION_MODEL" },
  ]);
});

test("RESTART creates a clean run at origin while preserving release and language", () => {
  const state = stateAt("ch08.heaven.packet.001", {
    language: "ua",
    current_run_action_trace: [
      { ordinal_within_current_run_projection: 1, canonical_gate_id: "CH01_BOOTSTRAP", canonical_action_id: "CH01_BOOTSTRAP.APPLY" },
    ],
  });
  const result = reduce(state, mutationEnvelope("RESTART", { new_run_id: "run-2" }), authority);
  assert.equal(result.ok, true);
  assert.equal(result.nextState.run_id, "run-2");
  assert.equal(result.nextState.content_release_id, 114009);
  assert.equal(result.nextState.cursor_scene_id, authority.initialSceneId);
  assert.equal(result.nextState.language, "ua");
  assert.equal(result.nextState.revision, 0);
  assert.deepEqual(result.nextState.current_run_action_trace, []);
});

test("SET_LANGUAGE preserves cursor, increments once, and rejects noncanonical identifiers", () => {
  const state = stateAt("ch09.heaven.packet.001", { language: "en" });
  const applied = reduce(state, mutationEnvelope("SET_LANGUAGE", { language: "ru" }), authority);
  assert.equal(applied.ok, true);
  assert.equal(applied.nextState.language, "ru");
  assert.equal(applied.nextState.cursor_scene_id, state.cursor_scene_id);
  assert.equal(applied.nextState.revision, state.revision + 1);

  for (const language of ["de", "fr", "zz"] ) {
    const rejected = reduce(state, mutationEnvelope("SET_LANGUAGE", { language }), authority);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "UNSUPPORTED_LANGUAGE");
    assert.equal(rejected.nextState, state);
  }
});

test("stale expected_revision rejects every mutation family before domain mutation", () => {
  const ungated = scenes.find((scene) => scene.gate_after === null && scene.next !== null);
  const gated = scenes.find((scene) => scene.gate_after !== null && scene.gate_after !== authority.terminalGateId);
  const gate = authority.gateById.get(gated.gate_after);
  const action = semanticAction(gate);
  const cases = [
    [stateAt(ungated.id), { type: "ADVANCE" }],
    [stateAt(gated.id), { type: "RESOLVE_GATE", gate_id: gate.id, canonical_action_id: action.id }],
    [stateAt(authority.terminalSceneId), { type: "REWIND", point_id: authority.initialSceneId }],
    [stateAt(ungated.id), { type: "RESTART", new_run_id: "run-2" }],
    [stateAt(ungated.id), { type: "SET_LANGUAGE", language: "ru" }],
  ];

  for (const [state, command] of cases) {
    const result = reduce(state, { ...command, expected_revision: state.revision - 1, idempotency_key: `stale-${command.type}` }, authority);
    assert.equal(result.ok, false, command.type);
    assert.equal(result.error.code, "STALE_REVISION", command.type);
    assert.equal(result.nextState, state, command.type);
  }
});

test("FINAL_ACK locks terminal authority without creating successor or BURN identity", () => {
  const gate = authority.gateById.get(authority.terminalGateId);
  const action = semanticAction(gate);
  const state = stateAt(authority.terminalSceneId);
  const result = reduce(
    state,
    mutationEnvelope("RESOLVE_GATE", { gate_id: gate.id, canonical_action_id: action.id }),
    authority,
  );

  assert.equal(result.ok, true);
  assert.equal(result.nextState.cursor_scene_id, authority.terminalSceneId);
  assert.equal(result.nextState.terminal_phase, TERMINAL_PHASE.FINAL_ACK_ACCEPTED);
  assert.equal(result.nextState.revision, state.revision + 1);
  assert.ok(result.consequences.some((item) => item.type === "FINAL_ACK_ACCEPTED"));
  assert.ok(result.consequences.some((item) => item.type === "TERMINAL_LOCKED"));
  assert.ok(result.consequences.some((item) => item.type === "COMPLETION_COMMIT_REQUIRED"));
  assert.equal(result.consequences.some((item) => item.type.includes("BURN")), false);
  assert.equal("burn_completion_id" in result.nextState, false);

  const lockedState = result.nextState;
  for (const command of [
    { type: "ADVANCE" },
    { type: "REWIND", point_id: authority.initialSceneId },
    { type: "RESTART", new_run_id: "run-after-terminal" },
    { type: "SET_LANGUAGE", language: "ru" },
  ]) {
    const locked = reduce(lockedState, { ...command, expected_revision: lockedState.revision, idempotency_key: `locked-${command.type}` }, authority);
    assert.equal(locked.ok, false, command.type);
    assert.equal(locked.error.code, "TERMINAL_LOCKED", command.type);
    assert.equal(locked.nextState, lockedState, command.type);
  }
});

test("kernel modules import no infrastructure or presentation dependencies", async () => {
  for (const path of ["src/kernel/authority.mjs", "src/kernel/reducer.mjs"]) {
    const source = await readFile(resolve(ROOT, path), "utf8");
    const staticImports = [...source.matchAll(/(?:import|export)\s+[^;]*?from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const dynamicImports = [...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    assert.deepEqual([...staticImports, ...dynamicImports], [], `${path} must remain dependency-free`);
  }
});

test("COMPLETE_PROTOCOL is internal terminal-only and commits exactly once", () => {
  const gate = authority.gateById.get(authority.terminalGateId);
  const action = semanticAction(gate);
  const active = stateAt(authority.terminalSceneId);
  const early = reduce(active, mutationEnvelope("COMPLETE_PROTOCOL"), authority);
  assert.equal(early.ok, false);
  assert.equal(early.error.code, "TERMINAL_NOT_READY");

  const ack = reduce(active, mutationEnvelope("RESOLVE_GATE", { gate_id: gate.id, canonical_action_id: action.id }), authority);
  assert.equal(ack.ok, true);
  const complete = reduce(ack.nextState, { type: "COMPLETE_PROTOCOL", expected_revision: ack.nextState.revision, idempotency_key: "terminal-complete" }, authority);
  assert.equal(complete.ok, true);
  assert.equal(complete.nextState.terminal_phase, TERMINAL_PHASE.COMPLETE);
  assert.equal(complete.nextState.revision, ack.nextState.revision + 1);
  assert.deepEqual(complete.consequences.map((item) => item.type), ["PROTOCOL_COMPLETE_COMMITTED"]);

  const duplicate = reduce(complete.nextState, { type: "COMPLETE_PROTOCOL", expected_revision: complete.nextState.revision, idempotency_key: "terminal-complete-2" }, authority);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "TERMINAL_NOT_READY");
});
