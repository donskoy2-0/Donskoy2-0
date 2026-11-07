import { installReaderDiagnostics } from "./diagnostics.mjs";

// Presentation-only Reader tools popover. No Story, session or language authority.
export function installReaderSettingsMenu(root, { onReset = null, onImage = null } = {}) {
  const holder = root.querySelector("[data-reader-settings]");
  const trigger = root.querySelector("[data-reader-settings-trigger]");
  const panel = root.querySelector("[data-reader-settings-panel]");
  const overlay = root.querySelector("[data-reader-overlay]");
  if (!holder || !trigger || !panel || !overlay) throw new Error("READER_SETTINGS_MARKUP_MISSING");
  const diagnostics = installReaderDiagnostics(root);

  function close(restoreFocus = false) {
    if (panel.hidden) return;
    diagnostics.close();
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("focusin", onFocusOutside);
    if (restoreFocus) trigger.focus();
  }
  function open() {
    if (!overlay.hidden) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("focusin", onFocusOutside);
  }
  function onTrigger() {
    if (panel.hidden) open();
    else close();
  }
  function onOutside(event) {
    if (!holder.contains(event.target)) close();
  }
  function onFocusOutside(event) {
    if (!holder.contains(event.target)) close();
  }
  function onKeydown(event) {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    close(true);
  }
  function onPanelClick(event) {
    if (event.target.closest("[data-reader-reset]")) {
      close();
      if (typeof onReset === "function") onReset();
      return;
    }
    if (event.target.closest("[data-reader-image]")) {
      close();
      if (typeof onImage === "function") onImage();
      return;
    }
    if (event.target.closest("a[href]")) close();
  }
  const observer = new MutationObserver(() => {
    if (!overlay.hidden) close();
  });
  observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  trigger.addEventListener("click", onTrigger);
  panel.addEventListener("click", onPanelClick);

  return () => {
    close();
    trigger.removeEventListener("click", onTrigger);
    panel.removeEventListener("click", onPanelClick);
    observer.disconnect();
    diagnostics.dispose();
  };
}
