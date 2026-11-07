const TERMINAL_ACTIVE = "ACTIVE";
const TERMINAL_ACKNOWLEDGED = "FINAL_ACK_ACCEPTED";
const TERMINAL_COMPLETE = "COMPLETE";
const TERMINAL_PHASES = new Set([TERMINAL_ACTIVE, TERMINAL_ACKNOWLEDGED, TERMINAL_COMPLETE]);

function frozenTrace(trace) {
  return Object.freeze(trace.map((fact) => Object.freeze({ ...fact })));
}

function frozenState(state) {
  return Object.freeze({ ...state, current_run_action_trace: frozenTrace(state.current_run_action_trace) });
}

function frozenConsequences(consequences) {
  return Object.freeze(consequences.map((item) => Object.freeze({ ...item })));
}

function accepted(nextState, consequences = []) {
  return Object.freeze({ ok: true, nextState: frozenState(nextState), consequences: frozenConsequences(consequences), error: null });
}

function observed(state, consequences = []) {
  return Object.freeze({ ok: true, nextState: state, consequences: frozenConsequences(consequences), error: null });
}

function rejected(state, code, detail = null) {
  return Object.freeze({ ok: false, nextState: state, consequences: Object.freeze([]), error: Object.freeze({ code, detail }) });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateActionTrace(state, authority) {
  const trace = state.current_run_action_trace;
  const cursorOrdinal = authority.sceneById.get(state.cursor_scene_id).ordinal;
  const seenGates = new Set();

  for (let index = 0; index < trace.length; index += 1) {
    const fact = trace[index];
    if (!fact || typeof fact !== "object") return "INVALID_ACTION_TRACE";
    if (fact.ordinal_within_current_run_projection !== index + 1) return "INVALID_ACTION_TRACE_ORDINAL";
    if (!isNonEmptyString(fact.canonical_gate_id) || !isNonEmptyString(fact.canonical_action_id)) return "INVALID_ACTION_TRACE_IDENTITY";
    if (seenGates.has(fact.canonical_gate_id)) return "DUPLICATE_ACTION_TRACE_GATE";

    const gate = authority.gateById.get(fact.canonical_gate_id);
    if (!gate) return "UNKNOWN_ACTION_TRACE_GATE";
    const action = gate.actionById.get(fact.canonical_action_id);
    if (!action || action.role !== "SEMANTIC_ACTION") return "NONSEMANTIC_ACTION_TRACE_FACT";

    const gateOrdinal = authority.gateSceneOrdinal.get(fact.canonical_gate_id);
    if (!Number.isInteger(gateOrdinal) || gateOrdinal > cursorOrdinal) return "FUTURE_ACTION_TRACE_FACT";
    seenGates.add(fact.canonical_gate_id);
  }

  const terminalFactPresent = seenGates.has(authority.terminalGateId);
  if (state.terminal_phase === TERMINAL_ACTIVE && terminalFactPresent) return "TERMINAL_TRACE_PHASE_MISMATCH";
  if (state.terminal_phase !== TERMINAL_ACTIVE) {
    if (state.cursor_scene_id !== authority.terminalSceneId) return "TERMINAL_PHASE_REQUIRES_FINAL_CURSOR";
    if (!terminalFactPresent) return "TERMINAL_PHASE_REQUIRES_FINAL_ACK";
  }

  return null;
}

function validateState(state, authority) {
  if (!state || typeof state !== "object") return "STATE_REQUIRED";
  if (!isNonEmptyString(state.run_id)) return "INVALID_RUN_ID";
  if (state.content_release_id !== authority.releaseId) return "INVALID_RELEASE";
  if (!authority.sceneById.has(state.cursor_scene_id)) return "INVALID_CURSOR";
  if (!authority.languages.has(state.language)) return "INVALID_LANGUAGE";
  if (!Number.isInteger(state.revision) || state.revision < 0) return "INVALID_REVISION";
  if (!Array.isArray(state.current_run_action_trace)) return "INVALID_ACTION_TRACE";
  if (!TERMINAL_PHASES.has(state.terminal_phase)) return "INVALID_TERMINAL_PHASE";
  return validateActionTrace(state, authority);
}

function validateMutationEnvelope(state, command) {
  if (!Number.isInteger(command.expected_revision)) return "EXPECTED_REVISION_REQUIRED";
  if (command.expected_revision !== state.revision) return "STALE_REVISION";
  if (!isNonEmptyString(command.idempotency_key)) return "IDEMPOTENCY_KEY_REQUIRED";
  return null;
}

function traceContainsGate(trace, gateId) {
  return trace.some((fact) => fact.canonical_gate_id === gateId);
}

function appendSemanticFact(trace, gateId, actionId) {
  return [
    ...trace,
    {
      ordinal_within_current_run_projection: trace.length + 1,
      canonical_gate_id: gateId,
      canonical_action_id: actionId,
    },
  ];
}

function renumberTrace(trace) {
  return trace.map((fact, index) => ({ ...fact, ordinal_within_current_run_projection: index + 1 }));
}

function mutationState(state, patch) {
  return { ...state, ...patch, revision: state.revision + 1 };
}

function resolvePreSceneGate(state, command, authority, action) {
  if (command.gate_id !== authority.preSceneGateId) return null;
  if (state.cursor_scene_id !== authority.initialSceneId) return rejected(state, "PRE_SCENE_GATE_ONLY_AT_ORIGIN");
  if (action.role !== "SEMANTIC_ACTION") return rejected(state, "PRE_SCENE_GATE_REQUIRES_SEMANTIC_ACTION");
  if (traceContainsGate(state.current_run_action_trace, command.gate_id)) return rejected(state, "SEMANTIC_ACTION_ALREADY_ACCEPTED");

  const nextTrace = appendSemanticFact(state.current_run_action_trace, command.gate_id, command.canonical_action_id);
  const nextState = mutationState(state, { current_run_action_trace: nextTrace });
  return accepted(nextState, [
    { type: "SEMANTIC_ACTION_ACCEPTED", gate_id: command.gate_id, canonical_action_id: command.canonical_action_id },
    { type: "FIRST_STORY_AUTHORIZED", cursor_scene_id: authority.initialSceneId, content_release_id: authority.releaseId, language: state.language },
  ]);
}

function resolveTerminalGate(state, command, authority, action) {
  if (command.gate_id !== authority.terminalGateId) return null;
  if (state.cursor_scene_id !== authority.terminalSceneId) return rejected(state, "TERMINAL_GATE_ONLY_AT_FINAL_CURSOR");

  if (action.role === "CONTINUATION") {
    return rejected(state, "TERMINAL_CONTINUATION_NOT_AUTHORITY");
  }

  if (action.role !== "SEMANTIC_ACTION") return rejected(state, "INVALID_GATE_ROLE");
  if (state.terminal_phase !== TERMINAL_ACTIVE) return rejected(state, "TERMINAL_LOCKED");
  if (traceContainsGate(state.current_run_action_trace, command.gate_id)) return rejected(state, "SEMANTIC_ACTION_ALREADY_ACCEPTED");

  const nextTrace = appendSemanticFact(state.current_run_action_trace, command.gate_id, command.canonical_action_id);
  const nextState = mutationState(state, {
    current_run_action_trace: nextTrace,
    terminal_phase: TERMINAL_ACKNOWLEDGED,
  });
  return accepted(nextState, [
    { type: "SEMANTIC_ACTION_ACCEPTED", gate_id: command.gate_id, canonical_action_id: command.canonical_action_id },
    { type: "FINAL_ACK_ACCEPTED" },
    { type: "TERMINAL_LOCKED" },
    { type: "COMPLETION_COMMIT_REQUIRED" },
  ]);
}

/**
 * Pure canonical Reader semantic reducer.
 *
 * Persistence, authentication, D1, Turnstile, idempotency receipt storage,
 * telemetry writes, DOM, History and presentation are deliberately outside.
 */
export function reduce(state, command, authority) {
  if (!command || typeof command !== "object" || !isNonEmptyString(command.type)) {
    return rejected(state ?? null, "COMMAND_REQUIRED");
  }

  if (command.type === "OPEN") {
    if (state !== null && state !== undefined) return rejected(state, "RUN_ALREADY_OPEN");
    if (!isNonEmptyString(command.run_id)) return rejected(null, "RUN_ID_REQUIRED");
    if (!isNonEmptyString(command.idempotency_key)) return rejected(null, "IDEMPOTENCY_KEY_REQUIRED");
    if (!authority.languages.has(command.language)) return rejected(null, "UNSUPPORTED_LANGUAGE", command.language ?? null);
    const nextState = {
      run_id: command.run_id,
      content_release_id: authority.releaseId,
      cursor_scene_id: authority.initialSceneId,
      language: command.language,
      revision: 0,
      current_run_action_trace: [],
      terminal_phase: TERMINAL_ACTIVE,
    };
    return accepted(nextState, [
      { type: "RUN_OPENED", run_id: command.run_id, cursor_scene_id: authority.initialSceneId, content_release_id: authority.releaseId, language: command.language },
      { type: "BOOTSTRAP_REQUIRED", gate_id: authority.preSceneGateId },
    ]);
  }

  const stateError = validateState(state, authority);
  if (stateError) return rejected(state, stateError);

  if (command.type === "RELOAD") {
    return observed(state, [{ type: "STATE_OBSERVED", cursor_scene_id: state.cursor_scene_id, revision: state.revision }]);
  }

  const envelopeError = validateMutationEnvelope(state, command);
  if (envelopeError) return rejected(state, envelopeError);

  if (command.type === "COMPLETE_PROTOCOL") {
    if (state.terminal_phase !== TERMINAL_ACKNOWLEDGED) return rejected(state, "TERMINAL_NOT_READY");
    if (state.cursor_scene_id !== authority.terminalSceneId || !traceContainsGate(state.current_run_action_trace, authority.terminalGateId)) {
      return rejected(state, "TERMINAL_COMPLETION_INVALID");
    }
    const nextState = mutationState(state, { terminal_phase: TERMINAL_COMPLETE });
    return accepted(nextState, [{ type: "PROTOCOL_COMPLETE_COMMITTED" }]);
  }

  if (command.type !== "RESOLVE_GATE" && state.terminal_phase !== TERMINAL_ACTIVE) {
    return rejected(state, "TERMINAL_LOCKED");
  }

  switch (command.type) {
    case "ADVANCE": {
      const scene = authority.sceneById.get(state.cursor_scene_id);
      if (scene.gate_after !== null) return rejected(state, "GATE_REQUIRED", scene.gate_after);
      if (scene.next === null) return rejected(state, "NO_SUCCESSOR");
      const nextState = mutationState(state, { cursor_scene_id: scene.next });
      return accepted(nextState, [{ type: "CURSOR_COMMITTED", from: scene.id, to: scene.next }]);
    }

    case "RESOLVE_GATE": {
      if (!isNonEmptyString(command.gate_id) || !isNonEmptyString(command.canonical_action_id)) return rejected(state, "GATE_IDENTITY_REQUIRED");
      const gate = authority.gateById.get(command.gate_id);
      if (!gate) return rejected(state, "UNKNOWN_GATE", command.gate_id);
      const action = gate.actionById.get(command.canonical_action_id);
      if (!action) return rejected(state, "UNKNOWN_GATE_ACTION", command.canonical_action_id);

      const preSceneResult = resolvePreSceneGate(state, command, authority, action);
      if (preSceneResult) return preSceneResult;

      const terminalResult = resolveTerminalGate(state, command, authority, action);
      if (terminalResult) return terminalResult;

      if (action.role === "SEMANTIC_ACTION" && traceContainsGate(state.current_run_action_trace, command.gate_id)) {
        return rejected(state, "SEMANTIC_ACTION_ALREADY_ACCEPTED");
      }
      if (state.terminal_phase !== TERMINAL_ACTIVE) return rejected(state, "TERMINAL_LOCKED");
      const scene = authority.sceneById.get(state.cursor_scene_id);
      if (scene.gate_after !== command.gate_id) return rejected(state, "GATE_NOT_CURRENT", command.gate_id);

      if (action.role === "SEMANTIC_ACTION") {
        if (scene.next === null) return rejected(state, "NO_SUCCESSOR");
        const nextTrace = appendSemanticFact(state.current_run_action_trace, command.gate_id, command.canonical_action_id);
        const nextState = mutationState(state, {
          current_run_action_trace: nextTrace,
          cursor_scene_id: scene.next,
        });
        return accepted(nextState, [
          { type: "SEMANTIC_ACTION_ACCEPTED", gate_id: command.gate_id, canonical_action_id: command.canonical_action_id },
          { type: "CURSOR_COMMITTED", from: scene.id, to: scene.next },
        ]);
      }

      if (action.role === "CONTINUATION") {
        if (scene.next === null) return rejected(state, "NO_SUCCESSOR");
        const nextState = mutationState(state, { cursor_scene_id: scene.next });
        return accepted(nextState, [
          { type: "GATE_CONTINUED", gate_id: command.gate_id, canonical_action_id: command.canonical_action_id },
          { type: "CURSOR_COMMITTED", from: scene.id, to: scene.next },
        ]);
      }

      return rejected(state, "INVALID_GATE_ROLE");
    }

    case "REWIND": {
      if (!isNonEmptyString(command.point_id) || !authority.rewindPointIds.has(command.point_id)) return rejected(state, "INVALID_REWIND_POINT", command.point_id ?? null);
      const current = authority.sceneById.get(state.cursor_scene_id);
      const target = authority.sceneById.get(command.point_id);
      if (target.ordinal === current.ordinal) return rejected(state, "NO_REAL_MOVEMENT");
      if (target.ordinal > current.ordinal) return rejected(state, "REWIND_NOT_BACKWARD");

      const retained = state.current_run_action_trace.filter((fact) => {
        const gateOrdinal = authority.gateSceneOrdinal.get(fact.canonical_gate_id);
        return Number.isInteger(gateOrdinal) && gateOrdinal < target.ordinal;
      });
      const nextTrace = renumberTrace(retained);
      const nextState = mutationState(state, { cursor_scene_id: target.id, current_run_action_trace: nextTrace });
      return accepted(nextState, [
        { type: "REWIND_COMMITTED", from: current.id, to: target.id },
        { type: "TRACE_TRUNCATED", retained_count: nextTrace.length },
        { type: "CURSOR_COMMITTED", from: current.id, to: target.id },
      ]);
    }

    case "RESTART": {
      if (!isNonEmptyString(command.new_run_id)) return rejected(state, "NEW_RUN_ID_REQUIRED");
      if (command.new_run_id === state.run_id) return rejected(state, "NEW_RUN_ID_MUST_DIFFER");
      const nextState = {
        run_id: command.new_run_id,
        content_release_id: state.content_release_id,
        cursor_scene_id: authority.initialSceneId,
        language: state.language,
        revision: 0,
        current_run_action_trace: [],
        terminal_phase: TERMINAL_ACTIVE,
      };
      return accepted(nextState, [
        { type: "RUN_RESTARTED", previous_run_id: state.run_id, run_id: command.new_run_id },
        { type: "BOOTSTRAP_REQUIRED", gate_id: authority.preSceneGateId },
      ]);
    }

    case "SET_LANGUAGE": {
      if (!authority.languages.has(command.language)) return rejected(state, "UNSUPPORTED_LANGUAGE", command.language ?? null);
      if (command.language === state.language) return rejected(state, "LANGUAGE_UNCHANGED");
      const nextState = mutationState(state, { language: command.language });
      return accepted(nextState, [{ type: "LANGUAGE_APPLIED", from: state.language, to: command.language, cursor_scene_id: state.cursor_scene_id }]);
    }

    default:
      return rejected(state, "UNKNOWN_COMMAND", command.type);
  }
}

export const TERMINAL_PHASE = Object.freeze({
  ACTIVE: TERMINAL_ACTIVE,
  FINAL_ACK_ACCEPTED: TERMINAL_ACKNOWLEDGED,
  COMPLETE: TERMINAL_COMPLETE,
});
