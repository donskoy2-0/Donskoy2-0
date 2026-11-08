import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createNotebookViewer } from "../../src/reader/notebook.mjs";

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.inert = false;
    this.isConnected = true;
    this.scrollWidth = 100;
    this.clientWidth = 50;
    this.scrollHeight = 100;
    this.clientHeight = 50;
    this.tabIndex = -1;
    this.classList = {
      names: new Set(),
      add: (name) => this.classList.names.add(name),
      remove: (name) => this.classList.names.delete(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, cb) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(cb);
    this.listeners.set(type, callbacks);
  }
  removeEventListener(type, cb) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== cb));
  }
  fire(type, props = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault() {}, isPrimary: true, button: 0, ...props });
    }
  }
  focus() { this.focused = true; }
  find(name) {
    if (this.className.split(" ").includes(name)) return this;
    for (const child of this.children) {
      const match = child.find?.(name);
      if (match) return match;
    }
    return null;
  }
}

function mockBrowser() {
  const previous = {
    HTMLElement: globalThis.HTMLElement,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window,
  };
  const overlay = new FakeElement();
  overlay.hidden = true;
  const flow = new FakeElement();
  const controls = new FakeElement();
  const documentElement = new FakeElement();
  const root = new FakeElement();
  root.querySelector = (selector) => ({
    "[data-reader-overlay]": overlay,
    "[data-reader-flow]": flow,
    ".reader-controls": controls,
  })[selector] ?? null;
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    documentElement,
    createElement(tag) { return new FakeElement(tag); },
  };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  globalThis.window = { clearTimeout() {}, setTimeout() { return 1; } };
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
  return { root, overlay, flow, controls, documentElement, restore };
}

const pages = (...ids) => ids.map(id => ({
  id, src: "/media/notebook/" + id + ".png", alt: id + " original",
}));

test("open Notebook viewer refreshes unlocked folios while preserving selected physical page", () => {
  const env = mockBrowser();
  try {
    const viewer = createNotebookViewer(env.root);
    assert.equal(viewer.present({ pages: pages("P01", "P02"), focusIndex: 1 }), true);
    const revision = viewer.revision;
    const image = env.overlay.find("reader-overlay__notebook-image");
    const counter = env.overlay.find("reader-overlay__notebook-counter");
    const previous = env.overlay.find("reader-overlay__notebook-nav-button");
    const next = env.overlay.children[1].find("reader-overlay__notebook-nav").children[2];
    const stage = env.overlay.find("reader-overlay__cover-stage");

    assert.equal(image.src, "/media/notebook/P02.png");
    assert.equal(counter.textContent, "P02 · 2 / 2");
    assert.equal(env.flow.inert, true);
    assert.equal(env.controls.inert, true);
    assert.equal(next.disabled, true);

    image.fire("keydown", { key: "Enter" });
    assert.equal(stage.dataset.zoomed, "true");
    assert.equal(viewer.refresh({ pages: pages("P01", "P02", "P03"), revision }), true);
    assert.equal(image.src, "/media/notebook/P02.png");
    assert.equal(counter.textContent, "P02 · 2 / 3");
    assert.equal(stage.dataset.zoomed, "true", "unchanged selected image keeps its zoom");
    assert.equal(previous.disabled, false);
    assert.equal(next.disabled, false);
    next.fire("click");
    assert.equal(image.src, "/media/notebook/P03.png");
    assert.equal(counter.textContent, "P03 · 3 / 3");
    assert.equal(stage.dataset.zoomed, "false");
    assert.equal(env.flow.inert, true, "refresh never enables Story navigation");
  } finally {
    env.restore();
  }
});

test("a revised page retains its physical P identity and resets zoom when image changes", () => {
  const env = mockBrowser();
  try {
    const viewer = createNotebookViewer(env.root);
    viewer.present({ pages: pages("P01", "P02"), focusIndex: 0 });
    const image = env.overlay.find("reader-overlay__notebook-image");
    const stage = env.overlay.find("reader-overlay__cover-stage");
    image.fire("keydown", { key: "Enter" });
    const newPages = pages("P01", "P02");
    newPages[0].src = "/media/notebook/P01-v2.png";
    assert.equal(viewer.refresh({ pages: newPages, revision: viewer.revision }), true);
    assert.equal(image.src, "/media/notebook/P01-v2.png");
    assert.equal(stage.dataset.zoomed, "false");
    assert.equal(env.overlay.find("reader-overlay__notebook-counter").textContent, "P01 · 1 / 2");
  } finally { env.restore(); }
});

test("closed or replaced Notebook viewer rejects delayed refresh and restores inert state", () => {
  const env = mockBrowser();
  try {
    const viewer = createNotebookViewer(env.root);
    viewer.present({ pages: pages("P01"), focusIndex: 0 });
    const staleRevision = viewer.revision;
    viewer.close();
    assert.equal(viewer.isOpen(), false);
    assert.equal(env.overlay.hidden, true);
    assert.equal(env.flow.inert, false);
    assert.equal(env.controls.inert, false);
    assert.equal(viewer.refresh({ pages: pages("P01", "P02"), revision: staleRevision }), false);
    viewer.present({ pages: pages("P01"), focusIndex: 0 });
    assert.notEqual(viewer.revision, staleRevision);
    assert.equal(viewer.refresh({ pages: pages("P01", "P02"), revision: staleRevision }), false);
    assert.equal(env.overlay.find("reader-overlay__notebook-counter").textContent, "P01 · 1 / 1");
    assert.equal(viewer.refresh({ pages: [], revision: viewer.revision }), false);
  } finally { env.restore(); }
});

const shell = readFileSync(new URL("../../src/reader/shell.mjs", import.meta.url), "utf8");
const first = shell.indexOf("  async function refreshNotebook(");
const last = shell.indexOf("  function applyNotebookPossession(", first);
assert.ok(first >= 0 && last > first, "actual shell refresh integration must be present");
const shellMethods = shell.slice(first, last);

test("out-of-order manifest responses never overwrite newer Notebook projection", async () => {
  const requests = [];
  const refreshed = [];
  const viewer = {
    open: true, revision: 7,
    isOpen() { return this.open; },
    close() { this.open = false; },
    refresh({ pages: incoming, revision }) {
      refreshed.push({ ids: incoming.map(p => p.id), revision });
      return true;
    },
  };
  const ctx = {
    notebookViewer: viewer,
    released: false,
    notebookLayer: "earth",
    notebookPossessed: true,
    notebookProjection: { state: null, available: false },
    notebookIconVisible: (layer, available, possessed) =>
      layer === "earth" && available && possessed,
    setNotebook() {},
    loadNotebookPresentation: state => new Promise(resolve => requests.push({ state, resolve })),
    console: { warn(message) { throw Error("unexpected warning " + message); } },
  };
  runInNewContext(shellMethods + "\nthis.applyNotebookProjection = applyNotebookProjection;", ctx);
  ctx.applyNotebookProjection({ state: "N01", available: true });
  ctx.applyNotebookProjection({ state: "N02", available: true });
  assert.deepEqual(requests.map(x => x.state), ["N01", "N02"]);

  requests[1].resolve({ pages: pages("P01", "P02") });
  await new Promise(setImmediate);
  requests[0].resolve({ pages: pages("P01") });
  await new Promise(setImmediate);
  assert.deepEqual(refreshed, [{ ids: ["P01", "P02"], revision: 7 }]);

  ctx.applyNotebookProjection({ state: "N03", available: true });
  assert.equal(requests.length, 3);
  viewer.revision = 9;
  requests[2].resolve({ pages: pages("P01", "P02", "P03") });
  await new Promise(setImmediate);
  assert.equal(refreshed.length, 1, "closed and reopened viewer must not accept old manifest");
  ctx.applyNotebookProjection({ state: "N04", available: false });
  assert.equal(viewer.open, false);
  assert.equal(refreshed.length, 1);
});
