import test from "node:test";
import assert from "node:assert/strict";
import { createAudioSession, AUDIO_ASSETS } from "../../src/reader/audio-session.mjs";

function makeHarness({ initialState = "running" } = {}) {
  const listeners = new Map();
  const body = {};
  const documentElement = {};
  const reader = {};
  let mounted = true;
  let contexts = 0;
  let played = 0;
  let resumes = 0;
  const warnings = [];
  const gains = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  const fakeContext = {
    state: initialState, destination: {}, sampleRate: 44100,
    createGain: gains,
    createBuffer: () => ({ silent: true }),
    createBufferSource() {
      let buffer;
      return {
        connect() {}, disconnect() {},
        set buffer(value) { buffer = value; },
        start() { if (buffer?.decoded) played++; },
      };
    },
    async decodeAudioData() { return { decoded: true }; },
    resume() {
      resumes++;
      fakeContext.state = "running";
      return Promise.resolve();
    },
  };
  const doc = {
    body, documentElement, visibilityState: "visible",
    querySelector(selector) { return selector === ".reader-shell" && mounted ? reader : null; },
    addEventListener(type, callback) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(callback);
      listeners.set(type, handlers);
    },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) ?? []) callback({ type, ...event });
    },
  };
  const outer = { closest() { return null; } };
  const inside = { closest(selector) { return selector === ".reader-shell" ? reader : null; } };
  const session = createAudioSession({
    getAudioContextCtor: () => function MockAudioContext() { contexts++; return fakeContext; },
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(24) }),
    documentObject: doc, windowObject: { addEventListener() {} },
    logger: { warn(...args) { warnings.push(args); } },
  });
  return {
    doc, reader, inside, outer, body,
    session, warnings,
    unmount: () => { mounted = false; },
    get contexts() { return contexts; },
    get played() { return played; },
    get resumes() { return resumes; },
  };
}

test("cold RELOAD stays silent until a genuine Reader pointer gesture, then clock plays", async () => {
  const h = makeHarness();
  h.session.activate();
  assert.equal(h.contexts, 0, "activate() must not bypass autoplay");
  assert.equal(h.session.playPathWhenReady(AUDIO_ASSETS.CLOCK, "CH05_CLOCK"), false);
  assert.equal(h.played, 0, "missed events must not replay retroactively");

  h.doc.dispatch("pointerdown", { isTrusted: false, target: h.inside });
  h.doc.dispatch("pointerdown", { isTrusted: true, target: h.outer });
  h.doc.dispatch("scroll", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 0, "synthetic or non-Reader gestures cannot unlock audio");

  h.doc.dispatch("pointerdown", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 1);
  await new Promise(setImmediate);
  assert.equal(h.session.playPathWhenReady(AUDIO_ASSETS.CLOCK, "CH05_CLOCK"), true);
  assert.equal(h.played, 1);
});

test("mobile touchstart primes audio; duplicate touch/pointer/click does not create another context", () => {
  const h = makeHarness({ initialState: "suspended" });
  h.session.activate();
  h.doc.dispatch("touchstart", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 1);
  assert.equal(h.resumes, 1);
  h.doc.dispatch("pointerdown", { isTrusted: true, target: h.inside });
  h.doc.dispatch("click", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 1);
  assert.equal(h.resumes, 1);
});

test("keyboard PageDown on BODY unlocks audio only with active Reader and no modifier", () => {
  const h = makeHarness();
  h.session.activate();
  h.doc.dispatch("keydown", { isTrusted: true, key: "i", ctrlKey: true, shiftKey: true, target: h.body });
  h.doc.dispatch("keydown", { isTrusted: true, key: "PageDown", ctrlKey: true, target: h.body });
  h.doc.dispatch("keydown", { isTrusted: false, key: "PageDown", target: h.body });
  assert.equal(h.contexts, 0);
  h.unmount();
  h.doc.dispatch("keydown", { isTrusted: true, key: "PageDown", target: h.body });
  assert.equal(h.contexts, 0);
  // The same trusted scroll gesture with a mounted Reader can unlock it.
  const live = makeHarness();
  live.session.activate();
  live.doc.dispatch("keydown", { isTrusted: true, key: "PageDown", target: live.body });
  assert.equal(live.contexts, 1);
});

test("activation and recovery listener setup are idempotent and never preload without context", () => {
  const h = makeHarness();
  h.session.activate();
  h.session.activate();
  assert.equal(h.contexts, 0);
  h.doc.dispatch("click", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 1);
  h.doc.dispatch("click", { isTrusted: true, target: h.inside });
  assert.equal(h.contexts, 1);
});
