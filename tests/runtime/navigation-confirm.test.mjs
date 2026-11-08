import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installNavigationConfirmation } from "../../src/reader/navigation-confirm.mjs";

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.open = false;
    this.isConnected = true;
    this.disabled = false;
    this.returnValue = "";
    this.attributes = {};
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event = {}) { for (const cb of this.listeners.get(type) ?? []) cb(event); }
  showModal() { if (this.open) throw Error("already open"); this.open = true; }
  close(value = this.returnValue) {
    this.returnValue = value;
    this.open = false;
    this.fire("close");
  }
  focus() { this.focused = true; }
  remove() { this.isConnected = false; }
}

test("checkpoint, back and restart do nothing before explicit native dialog confirmation", () => {
  const oldDocument = globalThis.document;
  const nodes = [];
  globalThis.document = { createElement: (tag) => {
    const node = new FakeElement(tag);
    nodes.push(node);
    return node;
  }};
  let language = "ru";
  const root = new FakeElement("root");
  let mutations = 0;
  try {
    const confirmation = installNavigationConfirmation(root, { getLanguage: () => language });
    const dialog = root.children[0];
    const form = dialog.children[0];
    const [eyebrow, title, detail, actions] = form.children;
    const [cancelButton, proceedButton] = actions.children;
    assert.equal(dialog.tag, "dialog");
    assert.equal(form.method, "dialog");
    assert.equal(dialog.attributes["aria-labelledby"], title.id);
    assert.equal(dialog.attributes["aria-describedby"], detail.id);
    assert.equal(cancelButton.value, "cancel");
    assert.equal(proceedButton.value, "confirm");

    assert.equal(confirmation.request({
      kind: "point", label: "CH 04 · HEAVEN", action: () => mutations++,
    }), true);
    assert.equal(dialog.open, true);
    assert.match(title.textContent, /Глава\s*04/i);
    assert.match(title.textContent, /Небеса/);
    assert.match(detail.textContent, /заново/);
    assert.equal(cancelButton.textContent, "ОТМЕНА");
    assert.equal(mutations, 0);

    // The browser's dialog cancel path must not trigger a Story mutation.
    dialog.close("cancel");
    assert.equal(mutations, 0);
    assert.equal(dialog.open, false);

    assert.equal(confirmation.request({
      kind: "rewind", label: "CH 03 · EARTH", action: () => mutations++,
    }), true);
    assert.match(title.textContent, /Земля/);
    assert.equal(confirmation.request({ kind: "restart", action: () => mutations++ }), false, "no stacked modal");
    dialog.close("confirm");
    assert.equal(mutations, 1);

    language = "en";
    confirmation.request({ kind: "restart", action: () => mutations++ });
    assert.equal(title.textContent, "Restart the story?");
    assert.match(detail.textContent, /progress will be reset/);
    assert.equal(cancelButton.textContent, "CANCEL");
    assert.equal(proceedButton.textContent, "CONTINUE");
    dialog.fire("click", { target: dialog }); // backdrop cancel
    assert.equal(mutations, 1);

    language = "ua";
    confirmation.request({ kind: "point", label: "CH 12 · HEAVEN", action: () => mutations++ });
    assert.match(title.textContent, /Розділ 12/);
    assert.match(title.textContent, /Небеса/);
    dialog.close("confirm");
    assert.equal(mutations, 2);

    confirmation.request({ kind: "point", label: "CH 01 · EARTH", valid: () => false, action: () => mutations++ });
    dialog.close("confirm");
    assert.equal(mutations, 2, "stale navigation cannot execute");

    confirmation.request({ kind: "restart", action: () => mutations++ });
    confirmation.cancel();
    assert.equal(mutations, 2);
    confirmation.request({ kind: "restart", action: () => mutations++ });
    confirmation.dispose();
    assert.equal(mutations, 2);
    assert.equal(dialog.isConnected, false);
    assert.equal(confirmation.request({ kind: "restart", action: () => mutations++ }), false);
    assert.match(eyebrow.textContent, /SYSTEM/);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

test("every bottom navigation command passes through confirmation; no Story authority or new route", () => {
  const root = new URL("../../", import.meta.url);
  const shell = readFileSync(new URL("src/reader/shell.mjs", root), "utf8");
  const runtime = readFileSync(new URL("src/runtime/reader-runtime.mjs", root), "utf8");
  const css = readFileSync(new URL("src/reader/reader.css", root), "utf8");
  const module = readFileSync(new URL("src/reader/navigation-confirm.mjs", root), "utf8");
  assert.match(shell, /confirmNavigation\("point", point\.label, mark, epoch, \(\) => onRewindPoint\(point\.id\)\)/);
  assert.match(shell, /confirmNavigation\("rewind", rewindLabel, rewind, epoch, onRewind\)/);
  assert.match(shell, /confirmNavigation\("restart", "", restart, epoch, onRestart\)/);
  assert.match(shell, /navigationEpoch \+= 1;/);
  assert.match(shell, /navigationConfirm\.cancel\(\)/);
  assert.match(shell, /navigationConfirm\.dispose\(\)/);
  assert.match(runtime, /rewindLabel: points\.find\(\(point\) => point\.id === prior\.at\(-1\)\)\?\.label/);
  assert.match(runtime, /type: "REWIND"/);
  assert.match(runtime, /type: "RESTART"/);
  assert.match(css, /\.reader-nav-confirm::backdrop/);
  assert.match(css, /data-theme="light"\] \.reader-nav-confirm/);
  assert.match(module, /dialog\.showModal\(\)/);
  assert.match(module, /dialog\.returnValue !== "confirm"/);
  assert.doesNotMatch(module, /fetch\(|localStorage|sessionStorage|\/api\/|mutation\(|REWIND|RESTART/);
});
