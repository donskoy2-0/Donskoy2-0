import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createKernelAuthority } from "../../src/kernel/authority.mjs";
import { reduce, TERMINAL_PHASE } from "../../src/kernel/reducer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = async (path) => JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
const authority = createKernelAuthority({
  sceneGraph: await load("canon/canonical-scenes.v1.json"),
  rewindPoints: await load("canon/canonical-points.v1.json"),
  gateActions: await load("canon/gate-actions.v1.json"),
  languageAuthority: await load("canon/language-authority.v1.json"),
});

function base(overrides = {}) {
  return {
    run_id: "run-1",
    content_release_id: 114009,
    cursor_scene_id: "ch04.earth.packet.001",
    language: "en",
    revision: 3,
    current_run_action_trace: [],
    terminal_phase: TERMINAL_PHASE.ACTIVE,
    ...overrides,
  };
}

function observe(state) {
  return reduce(state, { type: "RELOAD" }, authority);
}

test("persisted trace rejects continuation/nonsemantic facts", () => {
  const state = base({
    cursor_scene_id: "ch05.earth.packet.001",
    current_run_action_trace: [{
      ordinal_within_current_run_projection: 1,
      canonical_gate_id: "CH01_HEAVEN",
      canonical_action_id: "CH01_HEAVEN.CONTINUE",
    }],
  });
  const result = observe(state);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NONSEMANTIC_ACTION_TRACE_FACT");
  assert.equal(result.nextState, state);
});

test("persisted trace rejects future semantic facts", () => {
  const state = base({
    cursor_scene_id: "ch04.heaven.packet.001",
    current_run_action_trace: [{
      ordinal_within_current_run_projection: 1,
      canonical_gate_id: "CH05_ROUTE",
      canonical_action_id: "CH05_ROUTE.OPEN_ROUTE_SEGMENT_MODEL",
    }],
  });
  const result = observe(state);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FUTURE_ACTION_TRACE_FACT");
});

test("persisted trace rejects duplicate gate facts and broken ordinals", () => {
  const duplicate = base({
    cursor_scene_id: "ch05.heaven.packet.001",
    current_run_action_trace: [
      {
        ordinal_within_current_run_projection: 1,
        canonical_gate_id: "CH04_PROCEDURE",
        canonical_action_id: "CH04_PROCEDURE.OPEN_SEPARATION_MODEL",
      },
      {
        ordinal_within_current_run_projection: 2,
        canonical_gate_id: "CH04_PROCEDURE",
        canonical_action_id: "CH04_PROCEDURE.OPEN_SEPARATION_MODEL",
      },
    ],
  });
  assert.equal(observe(duplicate).error.code, "DUPLICATE_ACTION_TRACE_GATE");

  const badOrdinal = base({
    current_run_action_trace: [{
      ordinal_within_current_run_projection: 9,
      canonical_gate_id: "CH01_BOOTSTRAP",
      canonical_action_id: "CH01_BOOTSTRAP.APPLY",
    }],
  });
  assert.equal(observe(badOrdinal).error.code, "INVALID_ACTION_TRACE_ORDINAL");
});

test("terminal phases require final cursor plus accepted FINAL_ACK semantic fact", () => {
  const terminalAction = {
    ordinal_within_current_run_projection: 1,
    canonical_gate_id: "FINAL_ACK_CH12",
    canonical_action_id: "FINAL_ACK_CH12.WITNESS_COMPLETION",
  };

  const wrongCursor = base({
    terminal_phase: TERMINAL_PHASE.FINAL_ACK_ACCEPTED,
  });
  assert.equal(observe(wrongCursor).error.code, "TERMINAL_PHASE_REQUIRES_FINAL_CURSOR");

  const missingAck = base({
    cursor_scene_id: authority.terminalSceneId,
    terminal_phase: TERMINAL_PHASE.COMPLETE,
  });
  assert.equal(observe(missingAck).error.code, "TERMINAL_PHASE_REQUIRES_FINAL_ACK");

  const activeWithAck = base({
    cursor_scene_id: authority.terminalSceneId,
    terminal_phase: TERMINAL_PHASE.ACTIVE,
    current_run_action_trace: [terminalAction],
  });
  assert.equal(observe(activeWithAck).error.code, "TERMINAL_TRACE_PHASE_MISMATCH");
});
