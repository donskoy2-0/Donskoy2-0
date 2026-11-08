import { createLiveReader } from "../reader/live.mjs";
import { speakerAccent } from "../reader/speaker-palette.mjs";
import { narrativeScenePreloadImage, narrativeSceneTransitionImage, narrativeGalleryBaseline } from "../reader/media-image-plan.mjs";

const LANGUAGES = new Set(["ru", "en", "ua"]);
const ACTIVE = "ACTIVE";
const FINAL_ACK_ACCEPTED = "FINAL_ACK_ACCEPTED";
const COMPLETE = "COMPLETE";
const TERMINAL_SCENE = "ch12.heaven.packet.001";
const FINAL_TRACE_AFTER = "l3.L3V-CH12-002.a";
const FINAL_TRACE_BEFORE = "l3.L3V-CH12-002.b";
const FINAL_TRACE_CONTENT_ID = "runtime.current-run-action-trace";
const READER_COPY_URL = "/assets/reader/reader-ui-copy.v1.json";
const PRE_AUTHORITY_MACHINE_LINES = 2;
const PREPARED_RUNTIME = Symbol("prepared-reader-runtime");

function opaque(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
}

async function apiJson(url, { method = "GET", body = null } = {}) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body === null ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function staticJson(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function loadReaderCopy() {
  const { response, payload } = await staticJson(READER_COPY_URL);
  if (!response.ok || payload?.schema !== "donskoy.reader-ui-copy.v1") throw new Error("READER_COPY_INVALID");
  return payload;
}

function localized(copyAuthority, kind, language) {
  const value = copyAuthority.copy?.[kind]?.[language];
  if (typeof value !== "string" || !value) throw new Error(`MISSING_READER_COPY:${kind}:${language}`);
  return value;
}

function actionLabel(copyAuthority, action, language) {
  if (action.role === "CONTINUATION") return localized(copyAuthority, "continue", language);
  return localized(copyAuthority, action.id, language);
}

function bootstrapCharacterLines(character, language, { rewriteName = true } = {}) {
  const traits = Object.values(character.traits || {});
  const prefix = `${character.name_label} ............ `;
  // TECH-004 is strictly a presentation beat; canonical final copy is unchanged.
  const previousGiven = { ru: "АКАКИЙ", en: "AKAKIY", ua: "АКАКІЙ" }[language];
  if (!previousGiven) throw new Error("TECH004_LANGUAGE_UNAVAILABLE");
  return [
    {
      text: prefix + character.name,
      ...(rewriteName ? { nameRewrite: { prefix, previousGiven, finalName: character.name } } : {}),
    },
    `${character.class_label} ........... ${character.class}`,
    `${character.discipline_label} ...... ${character.discipline}`,
    `${character.status_label} .......... ${character.status}`,
    " ",
    ...traits.map((trait) => `${trait.label.padEnd(18, ".")} ${trait.value}`),
    " ",
    character.bio_label,
    ...(character.bio || []),
    " ",
    character.prompt,
  ];
}

function preparedBlocks(blocks) {
  return blocks.map((block) => {
    const accent = block.speaker_id ? speakerAccent(block.speaker_id) : null;
    return { ...block, ...(accent ? { accent } : {}) };
  });
}

function preparedSceneBlocks(snapshot) {
  const blocks = preparedBlocks(snapshot.scene.blocks);
  if (snapshot.scene.id !== TERMINAL_SCENE) return blocks;
  if (!Array.isArray(snapshot.final_action_trace) || !Array.isArray(snapshot.final_action_projection)) {
    throw new Error("FINAL_ACTION_TRACE_REQUIRED");
  }

  const afterIndex = blocks.findIndex((block) => block?.content_id === FINAL_TRACE_AFTER);
  const beforeIndex = blocks.findIndex((block) => block?.content_id === FINAL_TRACE_BEFORE);
  if (afterIndex < 0 || beforeIndex !== afterIndex + 1) throw new Error("FINAL_ACTION_TRACE_SLOT_TOPOLOGY_MISMATCH");

  const rows = snapshot.final_action_projection.map(
    (fact) => `${String(fact.ordinal).padStart(2, "0")}. ${fact.canonical_gate_id} :: ${fact.canonical_action_id ?? "EMPTY"}`,
  );
  if (rows.length === 0) return blocks;
  const traceBlock = {
    role: "system",
    content_id: FINAL_TRACE_CONTENT_ID,
    text: rows.join("\n"),
  };
  return [...blocks.slice(0, beforeIndex), traceBlock, ...blocks.slice(beforeIndex)];
}

function sceneChapter(sceneId) {
  const match = /^ch(\d{2})\./u.exec(sceneId || "");
  return match ? Number(match[1]) : null;
}

function terminalizingState(state) {
  return state?.terminal_phase === FINAL_ACK_ACCEPTED || state?.terminal_phase === COMPLETE;
}

function assertRuntimeModel(model) {
  if (model?.schema !== "donskoy.pages-entry-runtime.v1") throw new Error("READER_MODEL_INVALID");
  const machine = model.bootstrap?.machine?.lines;
  if (!Array.isArray(machine) || machine[0] !== "OPENID 2.0" || machine[1] !== "runtime.mount(BOOTSTRAP)") {
    throw new Error("BOOTSTRAP_MACHINE_INVALID");
  }
  return machine;
}

export async function prepareReaderRuntime({ model, language }) {
  const machine = assertRuntimeModel(model);
  if (!LANGUAGES.has(language)) throw new Error("READER_LANGUAGE_INVALID");

  const requestBridge = { handler: null };
  const copyAuthorityPromise = loadReaderCopy();
  void copyAuthorityPromise.catch(() => {});
  const live = await createLiveReader({
    language,
    onLanguageRequest: (nextLanguage) => requestBridge.handler?.(nextLanguage),
  });
  const shellApi = live.reader;
  const surface = shellApi.surface;
  surface.clearFlow();
  surface.setGate(null);
  surface.setAction(null);
  shellApi.setLanguageEnabled(false);
  shellApi.setCoordinate("BOOTSTRAP");
  shellApi.setNavigation({ canRewind: false, canRestart: false });
  const prelude = surface.renderSystem({ label: "SYSTEM", lines: machine.slice(0, PRE_AUTHORITY_MACHINE_LINES), autoFollow: true });

  return {
    [PREPARED_RUNTIME]: true,
    language,
    live,
    requestBridge,
    copyAuthorityPromise,
    preludeSettled: surface.whenSystemSettled(prelude),
    consumed: false,
  };
}

export async function startReaderRuntime({ model, state, settledInitial = false, prepared = null }) {
  assertRuntimeModel(model);
  if (!state || !LANGUAGES.has(state.language) || !Number.isInteger(state.revision)) throw new Error("READER_STATE_INVALID");
  if (state.content_release_id !== model.first_story?.release_id) throw new Error("READER_RELEASE_INVALID");
  document.documentElement.dataset.storyReleaseId = String(state.content_release_id);
  if (typeof settledInitial !== "boolean") throw new TypeError("settledInitial must be boolean");
  if (prepared !== null) {
    if (prepared[PREPARED_RUNTIME] !== true || prepared.consumed || prepared.language !== state.language) {
      throw new Error("PREPARED_READER_INVALID");
    }
    if (state.bootstrap_applied) throw new Error("PREPARED_READER_STATE_INVALID");
    prepared.consumed = true;
  }

  let copyAuthorityPromise = null;
  let copyAuthority = null;
  let currentState = state;
  let currentSnapshot = null;
  let pendingLanguage = null;
  let networkBusy = false;
  let presentationEpoch = 0;
  let terminalStarted = false;
  const temporarilyDisabled = new Set();

  function trackCopyAuthorityLoad(promise) {
    copyAuthorityPromise = promise;
    void promise.catch(() => {
      if (copyAuthorityPromise === promise) copyAuthorityPromise = null;
    });
    return promise;
  }

  trackCopyAuthorityLoad(prepared?.copyAuthorityPromise ?? loadReaderCopy());

  async function requireCopyAuthority() {
    if (copyAuthority) return copyAuthority;
    const initial = copyAuthorityPromise ?? trackCopyAuthorityLoad(loadReaderCopy());
    try {
      copyAuthority = await initial;
    } catch {
      copyAuthority = await trackCopyAuthorityLoad(loadReaderCopy());
    }
    return copyAuthority;
  }

  const live = prepared?.live ?? await createLiveReader({ language: currentState.language, onLanguageRequest: requestLanguage });
  const shellApi = live.reader;
  const { root } = live;
  const surface = shellApi.surface;
  if (prepared) prepared.requestBridge.handler = requestLanguage;

  function clearPendingLanguage() {
    pendingLanguage = null;
    shellApi.setProjectedLanguage(null);
  }

  async function requestLanguage(nextLanguage) {
    if (terminalizingState(currentState)) return false;
    if (!currentState.first_story_mounted || networkBusy || !LANGUAGES.has(nextLanguage)) return false;
    if (nextLanguage === pendingLanguage) return false;
    if (nextLanguage === currentState.language) {
      clearPendingLanguage();
      return { pending: false };
    }
    pendingLanguage = nextLanguage;
    shellApi.setProjectedLanguage(nextLanguage);
    return { pending: true };
  }

  function setBusy(value) {
    networkBusy = Boolean(value);
    const controls = root.querySelectorAll(
      "[data-reader-actions] button, [data-reader-gate] button, [data-reader-rewind], [data-reader-restart], [data-history-rail] button",
    );
    if (networkBusy) {
      temporarilyDisabled.clear();
      for (const control of controls) {
        if (!control.disabled) {
          temporarilyDisabled.add(control);
          control.disabled = true;
        }
      }
      shellApi.setLanguageEnabled(false);
      return;
    }
    for (const control of temporarilyDisabled) {
      if (control.isConnected) control.disabled = false;
    }
    temporarilyDisabled.clear();
    shellApi.setLanguageEnabled(currentState.first_story_mounted === true && !terminalizingState(currentState));
  }

  async function fetchCurrentScene() {
    const { response, payload } = await apiJson("/api/story/current");
    if (!response.ok || !payload?.state || !payload?.scene) throw new Error(payload?.error || "STORY_LOAD_FAILED");
    if (payload.scene.id !== payload.state.cursor_scene_id) throw new Error("SCENE_AUTHORITY_MISMATCH");
    return payload;
  }

  async function reconcile() {
    clearPendingLanguage();
    const { response, payload } = await apiJson("/api/entry/resume", { method: "POST", body: {} });
    if (!response.ok || !payload?.state) throw new Error("READER_RECONCILIATION_FAILED");
    currentState = payload.state;
    shellApi.setLanguage(currentState.language);
    if (terminalizingState(currentState)) {
      const snapshot = await fetchCurrentScene();
      await renderSnapshot(snapshot, { settled: true });
      await runTerminalSequence();
    } else if (!currentState.bootstrap_applied) {
      await renderBootstrap({ rewriteName: false });
    } else {
      await loadCurrentScene({ settled: true });
    }
  }

  async function mutate(command) {
    if (networkBusy) return null;
    setBusy(true);
    try {
      const { response, payload } = await apiJson("/api/story/command", {
        method: "POST",
        body: {
          ...command,
          expected_revision: currentState.revision,
          idempotency_key: opaque("cmd"),
        },
      });
      if (!response.ok) {
        if (response.status === 409 && ["STALE_REVISION", "STALE_SESSION"].includes(payload?.error)) {
          await reconcile();
          return null;
        }
        throw new Error(payload?.error || "STORY_COMMAND_REJECTED");
      }
      currentState = payload.state;
      shellApi.setLanguage(currentState.language);
      return payload;
    } finally {
      setBusy(false);
    }
  }

  async function applyPendingLanguageAtP3Boundary() {
    if (!pendingLanguage || pendingLanguage === currentState.language) return null;
    const target = pendingLanguage;
    try {
      const result = await mutate({ type: "SET_LANGUAGE", language: target });
      if (!result) return null;
      clearPendingLanguage();
      const targetSnapshot = await fetchCurrentScene();
      currentSnapshot = targetSnapshot;
      currentState = targetSnapshot.state;
      shellApi.setLanguage(currentState.language);
      return { blocks: preparedSceneBlocks(targetSnapshot) };
    } catch (error) {
      // Language is optional presentation; an unavailable request cannot abort L3
      // settlement or suppress the canonical end-of-scene controls.
      console.error("Reader language projection unavailable at L3 boundary", error);
      return null;
    }
  }

  async function applyPendingLanguageAtChapterBoundary(previousSceneId) {
    if (!pendingLanguage || pendingLanguage === currentState.language) return;
    const before = sceneChapter(previousSceneId);
    const after = sceneChapter(currentState.cursor_scene_id);
    if (before === null || after === null || before === after) return;
    const target = pendingLanguage;
    try {
      const result = await mutate({ type: "SET_LANGUAGE", language: target });
      if (result) clearPendingLanguage();
    } catch (error) {
      // ADVANCE has already committed. Never strand the Reader on the old scene
      // just because its optional language change failed.
      console.error("Reader language projection unavailable at chapter boundary", error);
    }
  }

  async function refreshSameSceneAfterMutation(sceneId) {
    const snapshot = await fetchCurrentScene();
    if (snapshot.scene.id !== sceneId || snapshot.state.cursor_scene_id !== sceneId) {
      throw new Error("SAME_SCENE_REFRESH_IDENTITY_MISMATCH");
    }
    currentSnapshot = snapshot;
    currentState = snapshot.state;
    shellApi.setLanguage(currentState.language);
    shellApi.setProjectedLanguage(pendingLanguage);
    renderNavigation(snapshot);
    await renderControls(snapshot);
  }

  async function mutateThenLoad(command) {
    const previousSceneId = currentState.cursor_scene_id;
    const result = await mutate(command);
    if (!result) return false;
    // IMAGE 3 is tied to the actual CH08 scene transition, not gate action choice.
    // A rejected/stale command never reaches this seam.
    const transitionImage = narrativeSceneTransitionImage(previousSceneId, currentState.cursor_scene_id);
    if (terminalizingState(currentState)) {
      clearPendingLanguage();
      await runTerminalSequence();
      return true;
    }
    await applyPendingLanguageAtChapterBoundary(previousSceneId);
    if (currentState.cursor_scene_id === previousSceneId) {
      await refreshSameSceneAfterMutation(previousSceneId);
      return true;
    }
    await loadCurrentScene({ narrativeImage: transitionImage });
    return true;
  }

  // Reconciliation is settled by default; fresh bootstrap and explicit RESTART opt into the transient name beat.
  async function renderBootstrap({ preludeSettled = null, rewriteName = false } = {}) {
    const epoch = ++presentationEpoch;
    currentSnapshot = null;
    clearPendingLanguage();
    if (!preludeSettled) surface.clearFlow();
    surface.setGate(null);
    surface.setAction(null);
    shellApi.setLanguageEnabled(false);
    shellApi.setCoordinate("BOOTSTRAP");
    shellApi.setNavigation({ canRewind: false, canRestart: false });

    const machine = model.bootstrap.machine.lines;
    const generateIndex = machine.indexOf("character.generate()");
    if (generateIndex < PRE_AUTHORITY_MACHINE_LINES) throw new Error("BOOTSTRAP_MACHINE_INVALID");
    if (preludeSettled) await preludeSettled;
    if (epoch !== presentationEpoch) return;
    const first = surface.renderSystem({
      label: "SYSTEM",
      autoFollow: true,
      lines: machine.slice(preludeSettled ? PRE_AUTHORITY_MACHINE_LINES : 0, generateIndex + 1).map((text) => ({
        text,
        tone: text.includes("TRUE") || text.includes("ACTIVE") ? "success" : "info",
      })),
    });
    await surface.whenSystemSettled(first);
    if (epoch !== presentationEpoch) return;

    const character = model.bootstrap.character[currentState.language];
    if (!character) throw new Error("BOOTSTRAP_CHARACTER_COPY_MISSING");
    const card = surface.renderSystem({
      label: "CHARACTER",
      bridge: true,
      autoFollow: true,
      lines: bootstrapCharacterLines(character, currentState.language, { rewriteName }),
    });
    await surface.whenSystemSettled(card);
    if (epoch !== presentationEpoch) return;

    surface.setAction({
      id: model.bootstrap.character.semantic_action_id,
      label: character.action_label,
      onSelect: async () => {
        surface.setAction(null);
        const mutationPromise = mutate({
          type: "RESOLVE_GATE",
          gate_id: "CH01_BOOTSTRAP",
          canonical_action_id: model.bootstrap.character.semantic_action_id,
        });
        const finalSystem = surface.renderSystem({
          label: "SYSTEM",
          autoFollow: true,
          lines: machine.slice(generateIndex + 1).map((text) => ({
            text,
            tone: text.startsWith("status") ? "success" : "info",
          })),
        });

        let result;
        try {
          result = await mutationPromise;
        } catch (error) {
          console.error("Bootstrap action failed", error);
          try {
            await reconcile();
          } catch (reconcileError) {
            console.error("Bootstrap reconciliation failed", reconcileError);
            if (epoch === presentationEpoch) await renderBootstrap({ rewriteName: false });
          }
          return;
        }
        if (!result || epoch !== presentationEpoch) return;
        const firstScenePromise = fetchCurrentScene();
        const [snapshot] = await Promise.all([
          firstScenePromise,
          surface.whenSystemSettled(finalSystem),
        ]);
        if (epoch === presentationEpoch) await renderSnapshot(snapshot);
      },
    });
  }

  async function acknowledgeFirstStoryMount(sceneId) {
    if (currentState.first_story_mounted) return;
    if (sceneId !== model.first_story.cursor_scene_id) throw new Error("FIRST_STORY_MOUNT_IDENTITY_MISMATCH");
    const { response, payload } = await apiJson("/api/bootstrap/mounted", { method: "POST", body: {} });
    if (!response.ok || !payload?.state?.first_story_mounted) throw new Error(payload?.error || "FIRST_STORY_MOUNT_ACK_FAILED");
    currentState = payload.state;
    shellApi.setLanguageEnabled(true);
  }

  function railProjection(snapshot) {
    const prior = Array.isArray(snapshot.prior_rewind_points) ? snapshot.prior_rewind_points : [];
    const points = Array.isArray(snapshot.rewind_points) ? snapshot.rewind_points : [];
    const pointIds = new Set(points.map((point) => point.id));
    const currentPointId = pointIds.has(currentState.cursor_scene_id)
      ? currentState.cursor_scene_id
      : (prior.at(-1) ?? null);
    const reached = new Set(prior);
    if (currentPointId) reached.add(currentPointId);
    return points.map((point) => ({
      id: point.id,
      reached: reached.has(point.id),
      current: point.id === currentPointId,
      label: `CH ${point.chapter} · ${String(point.layer).toUpperCase()}`,
    }));
  }

  async function retireAndOpenOuter() {
    let retired = false;
    try {
      const { response } = await apiJson("/api/story/retire", { method: "POST", body: {} });
      retired = response.ok;
    } catch (error) {
      console.error("Reader retirement request failed", error);
    }

    // A previous retire may have succeeded and set the new grant cookie even
    // when its response was lost. The old story cookie is already destroyed.
    // In that case authorize recovery using the protected epilogue GET.
    if (!retired) {
      try {
        const { response } = await apiJson("/api/epilogue");
        if (!response.ok) return false;
      } catch {
        return false;
      }
    }

    try {
      history.replaceState(null, "", "/epilogue/");
      const { mountPostOuter } = await import("/assets/outer/post-outer.mjs");
      await mountPostOuter();
      return true;
    } catch (error) {
      console.error("Post-protocol epilogue mount failed", error);
      return false;
    }
  }

  function showRetireRetry() {
    const finalizer = document.createElement("main");
    finalizer.className = "terminal-finalizing";
    const text = document.createElement("div");
    text.textContent = "FINALIZING...";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "RETRY";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      if (await retireAndOpenOuter()) return;
      retry.disabled = false;
    });
    finalizer.append(text, retry);
    document.body.replaceChildren(finalizer);
  }

  function showCompletionRetry() {
    const pending = surface.renderSystem({ label: "SYSTEM", lines: ["FINALIZING..."] });
    void surface.whenSystemSettled(pending);
    surface.setAction({
      id: "TERMINAL_RETRY",
      label: "RETRY",
      onSelect: async () => {
        terminalStarted = false;
        await runTerminalSequence();
      },
    });
  }

  async function runTerminalSequence() {
    if (terminalStarted) return;
    terminalStarted = true;
    clearPendingLanguage();
    setBusy(true);
    surface.setAction(null);
    surface.setGate(null);

    const commit = surface.renderSystem({ label: "SYSTEM", lines: ['commit("novel.protocol.complete")'], autoFollow: true });
    await surface.whenSystemSettled(commit);

    let completion;
    try {
      completion = await apiJson("/api/story/complete", { method: "POST", body: {} });
    } catch (error) {
      console.error("Protocol completion request failed", error);
      showCompletionRetry();
      return;
    }
    if (!completion.response.ok) {
      showCompletionRetry();
      return;
    }
    currentState = { ...currentState, terminal_phase: COMPLETE };

    const frozen = surface.renderSystem({ label: "SYSTEM", lines: [
      "protocol.status ........ COMPLETE",
      "trace.seal()",
      "telemetry .............. SEALED",
      "story.freeze()",
      "state .................. FROZEN",
    ], autoFollow: true });
    await surface.whenSystemSettled(frozen);

    const releaseCommand = surface.renderSystem({ label: "SYSTEM", lines: ["reader.release()"], autoFollow: true });
    await surface.whenSystemSettled(releaseCommand);
    live.release();

    const released = surface.renderSystem({ label: "SYSTEM", lines: ["capabilities ........... RELEASED"], autoFollow: true });
    await surface.whenSystemSettled(released);

    const destroyCommand = surface.renderSystem({ label: "SYSTEM", lines: ["runtime.destroy()"], autoFollow: true });
    await surface.whenSystemSettled(destroyCommand);
    live.destroy();

    if (!await retireAndOpenOuter()) showRetireRetry();
  }

  function renderNavigation(snapshot) {
    const canMutate = currentState.terminal_phase === ACTIVE;
    const prior = Array.isArray(snapshot.prior_rewind_points) ? snapshot.prior_rewind_points : [];
    const points = railProjection(snapshot);

    async function rewindTo(pointId) {
      if (!pointId) return;
      clearPendingLanguage();
      const result = await mutate({ type: "REWIND", point_id: pointId });
      if (result) await loadCurrentScene();
    }

    shellApi.setNavigation({
      canRewind: canMutate && prior.length > 0,
      canRestart: canMutate,
      points,
      rewindLabel: points.find((point) => point.id === prior.at(-1))?.label ?? "",
      onRewindPoint: canMutate ? rewindTo : null,
      onRewind: async () => rewindTo(prior.at(-1)),
      onRestart: async () => {
        clearPendingLanguage();
        const result = await mutate({ type: "RESTART" });
        if (result) await renderBootstrap({ rewriteName: true });
      },
    });
  }

  async function renderControls(snapshot, expectedEpoch = presentationEpoch) {
    surface.setAction(null);
    surface.setGate(null);

    if (currentState.terminal_phase === FINAL_ACK_ACCEPTED) return;

    const gate = snapshot.gate;
    if (gate?.id === "FINAL_ACK_CH12" && gate.semantic_accepted) return;
    if (!gate && !snapshot.scene.next) return;

    // Resolve every visible label before publishing any Story action. If the
    // optional static copy is temporarily unavailable, offer a local retry
    // without mutating Story, issuing a command, or replaying the scene.
    let labels;
    try {
      const authority = await requireCopyAuthority();
      labels = gate
        ? gate.actions
          .filter((action) => !(action.role === "SEMANTIC_ACTION" && gate.semantic_accepted))
          .filter((action) => !(gate.id === "FINAL_ACK_CH12" && action.role === "CONTINUATION"))
          .map((action) => ({ action, label: actionLabel(authority, action, currentState.language) }))
        : localized(authority, "continue", currentState.language);
    } catch (error) {
      // A malformed but fetchable copy must also be re-fetched on user retry.
      copyAuthority = null;
      copyAuthorityPromise = null;
      if (expectedEpoch !== presentationEpoch || snapshot !== currentSnapshot) return;
      console.error("Reader control labels unavailable", error);
      surface.setAction({
        id: "READER_COPY_RETRY",
        label: "RETRY",
        onSelect: async () => {
          if (expectedEpoch !== presentationEpoch || snapshot !== currentSnapshot) return;
          await renderControls(snapshot, expectedEpoch);
        },
      });
      return;
    }

    if (expectedEpoch !== presentationEpoch || snapshot !== currentSnapshot) return;
    if (gate) {
      surface.setGate({
        actions: labels.map(({ action, label }) => ({
          id: action.id,
          label,
          onSelect: async () => {
            await mutateThenLoad({
              type: "RESOLVE_GATE",
              gate_id: gate.id,
              canonical_action_id: action.id,
            });
          },
        })),
      });
      return;
    }

    surface.setAction({
      id: "ADVANCE",
      label: labels,
      onSelect: async () => {
        await mutateThenLoad({ type: "ADVANCE" });
      },
    });
  }

  async function renderSnapshot(snapshot, { settled = false, narrativeImage = null } = {}) {
    const epoch = ++presentationEpoch;
    currentSnapshot = snapshot;
    currentState = snapshot.state;
    shellApi.setLanguage(currentState.language);
    shellApi.setProjectedLanguage(pendingLanguage);
    surface.clearFlow();
    surface.setAction(null);
    surface.setGate(null);

    const scene = snapshot.scene;
    if (!scene || scene.id !== currentState.cursor_scene_id) throw new Error("SCENE_AUTHORITY_MISMATCH");
    surface.setGalleryBaseline(narrativeGalleryBaseline(scene.id, { settled }));
    const blocks = preparedSceneBlocks(snapshot);
    const section = surface.renderLiterary({
      layer: scene.layer,
      eyebrow: `CHAPTER ${scene.chapter} · ${scene.layer.toUpperCase()}`,
      blocks,
      secretChain: scene.secret_chain ?? null,
      preloadImage: narrativeScenePreloadImage(scene.id),
      settled,
      onCausalBoundary: async () => {
        if (epoch !== presentationEpoch || terminalizingState(currentState)) return null;
        return applyPendingLanguageAtP3Boundary();
      },
    });
    // The new scene DOM exists before optional gate media starts.
    if (narrativeImage && !settled) void surface.presentNarrativeImage(narrativeImage);
    shellApi.setCoordinate(`${scene.chapter}·${scene.layer === "earth" ? "E" : "H"}`);

    // The First Story mount ACK is a server-side, idempotent acknowledgement.
    // A lost response must not strand the already-rendered literary scene
    // without controls or replay its text merely to retry the acknowledgement.
    // SET_LANGUAGE replaces the Story snapshot, not the mounted scene. Keep controls alive for that scene.
    const stillCurrent = () => epoch === presentationEpoch && section.isConnected
      && currentState.cursor_scene_id === scene.id && currentSnapshot?.scene?.id === scene.id;

    async function finishMountedScene() {
      if (!stillCurrent()) return;
      const terminalizing = terminalizingState(currentState);
      if (!terminalizing) renderNavigation(currentSnapshot || snapshot);
      shellApi.setLanguageEnabled(currentState.first_story_mounted === true && !terminalizing);
      await surface.whenFrontiersSettled(section);
      if (stillCurrent() && !terminalizing) {
        await renderControls(currentSnapshot || snapshot, epoch);
      }
    }

    function offerMountRetry(error) {
      if (!stillCurrent()) return;
      console.error("First Story mount ACK unavailable", error);
      surface.setAction({
        id: "FIRST_STORY_MOUNT_RETRY",
        label: "RETRY",
        onSelect: async () => {
          if (!stillCurrent()) return;
          surface.setAction(null); // consume this local retry before network I/O
          try {
            await acknowledgeFirstStoryMount(scene.id);
          } catch (retryError) {
            offerMountRetry(retryError);
            return;
          }
          await finishMountedScene();
        },
      });
    }

    try {
      await acknowledgeFirstStoryMount(scene.id);
    } catch (error) {
      // Do not swallow invariant violations or offer a retry on a different
      // scene. Only the pending First Story acknowledgement is recoverable.
      if (scene.id !== model.first_story.cursor_scene_id || currentState.first_story_mounted) throw error;
      offerMountRetry(error);
      return;
    }
    await finishMountedScene();
  }

  async function loadCurrentScene({ settled = false, narrativeImage = null } = {}) {
    const payload = await fetchCurrentScene();
    await renderSnapshot(payload, { settled, narrativeImage });
  }

  shellApi.setLanguageEnabled(currentState.first_story_mounted === true && !terminalizingState(currentState));
  if (terminalizingState(currentState)) {
    const snapshot = await fetchCurrentScene();
    await renderSnapshot(snapshot, { settled: true });
    await runTerminalSequence();
  } else if (!currentState.bootstrap_applied) {
    await renderBootstrap(prepared
      ? { preludeSettled: prepared.preludeSettled, rewriteName: !settledInitial }
      : { rewriteName: !settledInitial });
  } else {
    await loadCurrentScene({ settled: settledInitial });
  }

  return Object.freeze({
    get state() { return currentState; },
    get busy() { return networkBusy; },
    get snapshot() { return currentSnapshot; },
    get projectedLanguage() { return pendingLanguage; },
    reconcile,
  });
}
