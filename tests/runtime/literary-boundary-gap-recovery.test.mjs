import test from "node:test";
import assert from "node:assert/strict";
import { installLiteraryBoundaryProjection } from "../../src/reader/literary-boundary.mjs";

function withObserverHarness(run) {
  const original = {
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    console: globalThis.console,
  };
  const callbacks = [];
  const warnings = [];
  const nodes = new Map();
  const observers = [];
  const listeners = new Map();
  class Element {
    constructor(id, { top = 950, bottom = 1000 } = {}) {
      this.dataset = { contentId: id };
      this.rect = { top, bottom };
      this.isConnected = true;
      this.classList = { contains: () => false };
    }
    getBoundingClientRect() { return this.rect; }
    querySelector(selector) {
      if (selector === ".reader-statusbar") return { getBoundingClientRect: () => ({ bottom: 20 }) };
      return null;
    }
    querySelectorAll() { return [...nodes.values()]; }
  }
  class Observer {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() { this.closed = true; }
    fire() { this.cb([]); }
  }
  globalThis.HTMLElement = Element;
  globalThis.MutationObserver = Observer;
  globalThis.window = {
    innerHeight: 1000,
    addEventListener(name, callback) {
      const list = listeners.get(name) ?? new Set();
      list.add(callback);
      listeners.set(name, list);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  globalThis.document = { scrollingElement: { scrollHeight: 3000, clientHeight: 1000, scrollTop: 0 } };
  globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.console = { ...original.console, warn(...args) { warnings.push(args); } };
  const section = new Element("section");
  const root = new Element("root");
  const flush = () => {
    let left = 20;
    while (callbacks.length) {
      assert.ok(left-- > 0, "observer must not spin indefinitely");
      callbacks.shift()();
    }
  };
  const notify = () => observers.forEach(item => { if (!item.closed) item.fire(); });
  try { return run({ section, root, nodes, Element, flush, notify, observers, listeners, warnings }); }
  finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

const edge = (id, contentId = id) => ({ id, kind: "content", contentId, edge: "after" });

test("an unresolvable earlier anchor cannot block an already-entered later cue", () =>
  withObserverHarness(({ section, root, nodes, Element, flush, warnings, observers, listeners }) => {
    nodes.set("second", new Element("second", { top: 610, bottom: 680 }));
    const fired = [];
    installLiteraryBoundaryProjection(section, root, {
      events: [edge("first"), edge("second")],
      onEvent: e => fired.push(e.id),
    });
    flush();
    assert.deepEqual(fired, ["second"]);
    assert.deepEqual(warnings, [["LITERARY_BOUNDARY_ANCHOR_SKIPPED", "first"]]);
    assert.equal(observers[0].closed, true);
    assert.equal(listeners.get("scroll").size, 0);
  }));

test("an existing pending early anchor is NEVER skipped even if a later cue appears reached", () =>
  withObserverHarness(({ section, root, nodes, Element, flush, notify, warnings }) => {
    const first = new Element("first", { top: 900, bottom: 950 });
    nodes.set("first", first);
    nodes.set("second", new Element("second", { top: 610, bottom: 680 }));
    const fired = [];
    installLiteraryBoundaryProjection(section, root, {
      events: [edge("first"), edge("second")],
      onEvent: e => fired.push(e.id),
    });
    flush();
    assert.deepEqual(fired, [], "cannot reorder a known but not-yet-reached cue");
    assert.deepEqual(warnings, []);
    first.rect.bottom = 670;
    notify();
    flush();
    assert.deepEqual(fired, ["first", "second"]);
  }));

test("an absent early cue is retained while the later cue is not reached", () =>
  withObserverHarness(({ section, root, nodes, Element, flush, notify }) => {
    const later = new Element("second", { top: 1050, bottom: 1100 });
    nodes.set("second", later);
    const fired = [];
    installLiteraryBoundaryProjection(section, root, {
      events: [edge("first"), edge("second")],
      onEvent: e => fired.push(e.id),
    });
    flush();
    assert.deepEqual(fired, []);
    nodes.set("first", new Element("first", { top: 640, bottom: 700 }));
    later.rect.bottom = 720;
    notify();
    flush();
    assert.deepEqual(fired, ["first", "second"]);
  }));

test("a missing line text node fails open only after a later independent boundary enters", () =>
  withObserverHarness(({ section, root, nodes, Element, flush, warnings }) => {
    nodes.set("early", new Element("early", { top: 550, bottom: 600 }));
    nodes.set("later", new Element("later", { top: 620, bottom: 700 }));
    const fired = [];
    installLiteraryBoundaryProjection(section, root, {
      events: [{ id: "line", kind: "line", contentId: "early", afterLineIndex: 3 }, edge("later")],
      onEvent: e => fired.push(e.id),
    });
    flush();
    assert.deepEqual(fired, ["later"]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1], "line");
  }));
