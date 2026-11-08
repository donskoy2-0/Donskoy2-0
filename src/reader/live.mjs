import { mountReaderShell } from "./shell.mjs";
import { installReaderSettingsMenu } from "./settings-menu.mjs";
import { resetCurrentSiteSession } from "./reset-session.mjs";
import { installS7Presentation } from "./s7-presentation.mjs";
import { installS8Presentation } from "./s8-presentation.mjs";

const READER_STYLE_MARKERS = [
  "data-reader-css",
  "data-reader-causal-css",
  "data-reader-s7-css",
  "data-reader-s8-css",
];

async function ensureStylesheet(href, marker) {
  let css = document.querySelector(`link[${marker}]`);
  if (!(css instanceof HTMLLinkElement)) {
    css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = href;
    css.setAttribute(marker, "");
    document.head.append(css);
  }
  if (css.sheet) return;
  await new Promise((resolve, reject) => {
    const onLoad = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`READER_STYLESHEET_UNAVAILABLE:${href}`)); };
    const cleanup = () => {
      css.removeEventListener("load", onLoad);
      css.removeEventListener("error", onError);
    };
    css.addEventListener("load", onLoad, { once: true });
    css.addEventListener("error", onError, { once: true });
    if (css.sheet) onLoad();
  });
}

async function ensureReaderStyles() {
  const extensionStyles = Promise.all([
    ensureStylesheet("/assets/reader/s7-presentation.css", "data-reader-s7-css"),
    ensureStylesheet("/assets/reader/s8-presentation.css", "data-reader-s8-css"),
  ]);
  void extensionStyles.catch((error) => {
    console.warn("READER_EXTENSION_STYLES_UNAVAILABLE", error);
  });

  await Promise.all([
    ensureStylesheet("/assets/reader/reader.css", "data-reader-css"),
    ensureStylesheet("/assets/reader/causal.css", "data-reader-causal-css"),
  ]);
}

function removeReaderPresentationOwnership() {
  for (const marker of READER_STYLE_MARKERS) document.querySelector(`link[${marker}]`)?.remove();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("--reader-literary-scale");
}

function bindOverlayBackgroundInert(root) {
  const overlay = root.querySelector("[data-reader-overlay]");
  if (!(overlay instanceof HTMLElement)) return null;
  const background = [
    root.querySelector(".reader-statusbar"),
    root.querySelector(".reader-service-strip"),
  ].filter((node) => node instanceof HTMLElement);
  const sync = () => {
    const blocked = !overlay.hidden;
    for (const node of background) node.inert = blocked;
  };
  const observer = new MutationObserver(sync);
  observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  sync();
  return () => observer.disconnect();
}

export async function createLiveReader({ language = "en", onLanguageRequest = null } = {}) {
  await ensureReaderStyles();

  const root = document.createElement("main");
  root.className = "reader-shell";
  root.dataset.readerShell = "";
  root.innerHTML = `
    <header class="reader-statusbar" aria-label="Reader status and display settings">
      <div class="reader-settings" data-reader-settings>
        <button class="reader-header-settings" type="button" data-reader-settings-trigger aria-label="Open Reader tools" aria-haspopup="true" aria-controls="reader-settings-panel" aria-expanded="false" title="Tools">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 2h4l.55 2.3 1.8.75 2.02-1.24 2.83 2.83-1.24 2.02.75 1.8L23 11v4l-2.29.55-.75 1.8 1.24 2.02-2.83 2.83-2.02-1.24-1.8.75L14 23h-4l-.55-2.29-1.8-.75-2.02 1.24-2.83-2.83 1.24-2.02-.75-1.8L1 14v-4l2.29-.55.75-1.8L2.8 5.63 5.63 2.8l2.02 1.24 1.8-.75L10 2Z" transform="translate(0,-.5) scale(.96)"/>
            <circle cx="12" cy="12" r="3.1"/>
          </svg>
        </button>
        <div class="reader-settings__panel" id="reader-settings-panel" data-reader-settings-panel role="group" aria-label="Reader tools" hidden>
          <div data-reader-tools-home>
            <div class="reader-settings__item reader-settings__item--protocol" data-reader-settings-item="protocol">
              <span class="reader-settings__label">Protocol 2.0</span>
              <button class="reader-settings__protocol-trigger" type="button" data-reader-diagnostics-open>DIAGNOSTICS ↗</button>
            </div>
            <div class="reader-settings__item reader-settings__item--reset" data-reader-settings-item="session">
              <span class="reader-settings__label">Session</span>
              <button class="reader-settings__reset" type="button" data-reader-reset aria-label="Clear this site's reading session and restart">RESET</button>
            </div>
            <div class="reader-settings__item" data-reader-settings-item="license">
              <span class="reader-settings__label">License</span>
              <nav class="reader-settings__links" aria-label="Full license languages">
                <a href="/license/ru" target="_blank" rel="noopener noreferrer" aria-label="Russian license">RU</a>
                <a href="/license/en" target="_blank" rel="noopener noreferrer" aria-label="English license">EN</a>
                <a href="/license/ua" target="_blank" rel="noopener noreferrer" aria-label="Ukrainian license">UA</a>
              </nav>
            </div>
            <div class="reader-settings__item reader-settings__item--image" data-reader-settings-item="image">
              <span class="reader-settings__label">Images</span>
              <button class="reader-settings__image-trigger" type="button" data-reader-image aria-label="Open images">OPEN ↗</button>
            </div>
            <p class="reader-settings__error" data-reader-settings-error role="alert" hidden></p>
          </div>
        <section class="reader-diagnostics" data-reader-diagnostics aria-label="Donskoy 2.0 diagnostic protocol" hidden>
          <div class="reader-diagnostics__header">
            <button class="reader-diagnostics__back" type="button" data-reader-diagnostics-back aria-label="Back to Tools">← TOOLS</button>
            <span class="reader-diagnostics__mark">DONSKOY_2.0</span>
          </div>
          <div class="reader-diagnostics__title">DIAGNOSTIC PROTOCOL<span class="reader-diagnostics__cursor" aria-hidden="true">_</span></div>
          <p class="reader-diagnostics__overall" data-reader-diagnostics-overall role="status" aria-live="polite">AWAITING EXECUTION</p>
          <div class="reader-diagnostics__stage" data-diagnostic-stage="session.resolve()">
            <span class="reader-diagnostics__index">01</span><code>session.resolve()</code><span class="reader-diagnostics__verdict" data-diagnostic-status>—</span>
          </div>
          <div class="reader-diagnostics__stage" data-diagnostic-stage="storage.attest()">
            <span class="reader-diagnostics__index">02</span><code>storage.attest()</code><span class="reader-diagnostics__verdict" data-diagnostic-status>—</span>
          </div>
          <div class="reader-diagnostics__stage" data-diagnostic-stage="chunk.verify()">
            <span class="reader-diagnostics__index">03</span><code>chunk.verify()</code><span class="reader-diagnostics__verdict" data-diagnostic-status>—</span>
          </div>
          <output class="reader-diagnostics__position" data-reader-diagnostics-position>POSITION / UNRESOLVED</output>
          <button class="reader-diagnostics__run" type="button" data-reader-diagnostics-run>▶ EXECUTE PROTOCOL</button>
          <details class="reader-diagnostics__json" data-reader-diagnostics-json hidden>
            <summary>VIEW VALIDATED JSON ↗</summary>
            <pre data-reader-diagnostics-output></pre>
          </details>
          <p class="reader-diagnostics__footer">READ ONLY // NO STORY MUTATION</p>
        </section>
        </div>
      </div>
      <div class="reader-display" aria-label="Reader display settings">
        <div class="reader-language-host" data-language-host aria-label="Reader language"></div>
        <div class="reader-display__font" role="group" aria-label="Text size">
          <button class="reader-display__button" type="button" data-font-decrease aria-label="Decrease literary text size">
            <span class="reader-display__a--small" aria-hidden="true">A</span><span aria-hidden="true">−</span>
          </button>
          <button class="reader-display__button" type="button" data-font-increase aria-label="Increase literary text size">
            <span class="reader-display__a--large" aria-hidden="true">A</span><span aria-hidden="true">+</span>
          </button>
        </div>
        <button class="reader-display__button reader-display__theme" type="button" data-theme-toggle aria-label="Toggle reader theme">
          <span class="reader-display__theme-icon" data-theme-icon aria-hidden="true">☾</span>
          <span class="reader-display__theme-label" data-theme-label aria-hidden="true">DARK</span>
        </button>
      </div>
      <button class="reader-header-notebook" type="button" data-reader-notebook hidden aria-label="Open notebook" title="Notebook">▤</button>
    </header>

    <div class="reader-flow" data-reader-flow aria-live="polite" aria-busy="false"></div>
    <div class="reader-system-announcer" role="status" aria-live="polite" aria-atomic="true"></div>

    <div class="reader-controls" aria-label="Story controls">
      <section class="reader-gate" data-reader-gate aria-label="Story decision" hidden></section>
      <div class="reader-action-host" data-reader-actions></div>
    </div>

    <footer class="reader-service-strip" aria-label="Reader history and service controls">
      <button class="reader-service-button" type="button" data-reader-rewind hidden aria-label="Rewind story history" title="Rewind">↶</button>
      <span class="reader-history-coordinate" data-reader-coordinate hidden></span>
      <div class="history-rail" data-history-rail aria-label="Current-run literary history" hidden></div>
      <div class="reader-service-capabilities" aria-hidden="true"></div>
      <button class="reader-service-button" type="button" data-reader-restart hidden aria-label="Restart story" title="Restart">↻</button>
    </footer>
    <div class="reader-overlay" data-reader-overlay hidden></div>`;

  const mounted = mountReaderShell(root, { language, onLanguageRequest });
  const disposeOverlayInert = bindOverlayBackgroundInert(root);
  let resetting = false;
  const disposeSettingsMenu = installReaderSettingsMenu(root, {
    onImage: () => mounted.surface.presentCoverImage(),
    onReset: () => mounted.confirmSessionReset(async () => {
      if (resetting) return;
      resetting = true;
      try {
        await resetCurrentSiteSession();
      } catch (error) {
        console.error("Reader session reset failed", error);
        resetting = false;
        const errorNode = root.querySelector("[data-reader-settings-error]");
        const languageCopy = {
          ru: "Не удалось очистить сессию. Попробуйте снова.",
          en: "Could not clear the session. Please try again.",
          ua: "Не вдалося очистити сесію. Спробуйте ще раз.",
        };
        if (errorNode) {
          errorNode.textContent = languageCopy[document.documentElement.lang] ?? languageCopy.en;
          errorNode.hidden = false;
        }
        root.querySelector("[data-reader-settings-trigger]")?.click();
      }
    }),
  });
  const s7 = installS7Presentation(root);
  const s8 = installS8Presentation(root);
  document.body.replaceChildren(root);

  let released = false;
  let destroyed = false;

  function release() {
    if (released) return;
    released = true;
    disposeSettingsMenu();
    mounted.release();
    mounted.surface.setAction(null);
    mounted.surface.setGate(null);
    disposeOverlayInert?.();
    s7?.disconnect?.();
    s8?.disconnect?.();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    release();
    mounted.surface.destroy();
    root.remove();
    removeReaderPresentationOwnership();
  }

  return Object.freeze({ root, reader: mounted, release, destroy });
}
