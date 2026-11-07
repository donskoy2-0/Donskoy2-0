const STORAGE_KEY = "donskoy.reader.display.v3";
export const FONT_SCALES = Object.freeze([0.76, 0.83, 0.9, 1, 1.1, 1.2, 1.3]);
export const DEFAULT_FONT_SCALE_INDEX = 3;
export const THEMES = Object.freeze(["dark", "light"]);

function clampIndex(value) {
  return Number.isInteger(value)
    ? Math.min(FONT_SCALES.length - 1, Math.max(0, value))
    : DEFAULT_FONT_SCALE_INDEX;
}

function readStored() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!value || typeof value !== "object") return null;
    return {
      theme: THEMES.includes(value.theme) ? value.theme : "dark",
      fontScaleIndex: clampIndex(value.fontScaleIndex),
    };
  } catch {
    return null;
  }
}

function persist(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
}

export function createDisplayController({ root = document.documentElement, controls = {} } = {}) {
  let state = readStored() || { theme: "dark", fontScaleIndex: DEFAULT_FONT_SCALE_INDEX };
  let disposed = false;

  function scale() { return FONT_SCALES[state.fontScaleIndex] ?? 1; }

  function applyThemeControl() {
    if (!controls.theme) return;
    controls.theme.dataset.theme = state.theme;
    controls.theme.setAttribute("aria-pressed", String(state.theme === "light"));
    const icon = controls.theme.querySelector?.("[data-theme-icon]");
    const label = controls.theme.querySelector?.("[data-theme-label]");
    if (icon) icon.textContent = state.theme === "dark" ? "☾" : "☀";
    if (label) label.textContent = state.theme.toUpperCase();
    if (!icon && !label) controls.theme.textContent = state.theme === "dark" ? "☾" : "☀";
  }

  function apply() {
    root.dataset.theme = state.theme;
    root.style.setProperty("--reader-literary-scale", String(scale()));
    if (controls.decrease) controls.decrease.disabled = state.fontScaleIndex === 0;
    if (controls.increase) controls.increase.disabled = state.fontScaleIndex === FONT_SCALES.length - 1;
    applyThemeControl();
    persist(state);
  }

  function setFontScaleIndex(index) {
    state = { ...state, fontScaleIndex: clampIndex(index) };
    apply();
    return snapshot();
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) throw new TypeError(`unsupported reader theme: ${theme}`);
    state = { ...state, theme };
    apply();
    return snapshot();
  }

  function snapshot() { return Object.freeze({ ...state, fontScale: scale() }); }

  const onDecrease = () => setFontScaleIndex(state.fontScaleIndex - 1);
  const onIncrease = () => setFontScaleIndex(state.fontScaleIndex + 1);
  const onTheme = () => setTheme(state.theme === "dark" ? "light" : "dark");

  controls.decrease?.addEventListener("click", onDecrease);
  controls.increase?.addEventListener("click", onIncrease);
  controls.theme?.addEventListener("click", onTheme);

  function dispose() {
    if (disposed) return;
    disposed = true;
    controls.decrease?.removeEventListener("click", onDecrease);
    controls.increase?.removeEventListener("click", onIncrease);
    controls.theme?.removeEventListener("click", onTheme);
  }

  apply();
  return Object.freeze({ snapshot, setFontScaleIndex, setTheme, dispose });
}
