// A presentation-only protocol inside Tools. Never changes Reader or Story state.
const RUNS = Object.freeze(["session.resolve()", "storage.attest()", "chunk.verify()"]);
const ALLOWED = new Set(["PASS", "FAIL", "SKIP"]);

export function installReaderDiagnostics(root, { request = (...args) => fetch(...args) } = {}) {
  const panel = root.querySelector("[data-reader-settings-panel]");
  const home = root.querySelector("[data-reader-tools-home]");
  const view = root.querySelector("[data-reader-diagnostics]");
  const openButton = root.querySelector("[data-reader-diagnostics-open]");
  const backButton = root.querySelector("[data-reader-diagnostics-back]");
  const runButton = root.querySelector("[data-reader-diagnostics-run]");
  const position = root.querySelector("[data-reader-diagnostics-position]");
  const output = root.querySelector("[data-reader-diagnostics-output]");
  const resultPanel = root.querySelector("[data-reader-diagnostics-json]");
  const status = root.querySelector("[data-reader-diagnostics-overall]");
  if (!panel || !home || !view || !openButton || !backButton || !runButton ||
      !position || !output || !resultPanel || !status) {
    return Object.freeze({ close() {}, dispose() {} });
  }
  const rows = [...view.querySelectorAll("[data-diagnostic-stage]")];
  if (rows.length !== RUNS.length ||
      rows.some((row, index) => row.dataset.diagnosticStage !== RUNS[index])) {
    throw new Error("READER_DIAGNOSTIC_MARKUP_MISMATCH");
  }

  let controller = null;
  let generation = 0;
  let disposed = false;

  function reset() {
    resultPanel.hidden = true;
    resultPanel.open = false;
    output.textContent = "";
    position.textContent = "POSITION / UNRESOLVED";
    status.textContent = "AWAITING EXECUTION";
    status.dataset.status = "IDLE";
    runButton.disabled = false;
    runButton.textContent = "▶ EXECUTE PROTOCOL";
    for (const row of rows) {
      row.dataset.status = "IDLE";
      row.querySelector("[data-diagnostic-status]").textContent = "—";
    }
  }

  function close() {
    generation += 1;
    controller?.abort();
    controller = null;
    view.hidden = true;
    home.hidden = false;
    panel.classList.remove("reader-settings__panel--protocol");
    reset();
  }

  function open() {
    if (disposed) return;
    reset();
    home.hidden = true;
    view.hidden = false;
    panel.classList.add("reader-settings__panel--protocol");
    runButton.focus();
  }

  function safeReport(candidate) {
    if (!candidate || candidate.protocol !== "DONSKOY_2.0 / DIAGNOSTICS" ||
        !["PASS", "FAIL", "DENIED"].includes(candidate.status) ||
        candidate.read_only !== true ||
        !Array.isArray(candidate.checks) || candidate.checks.length !== RUNS.length ||
        candidate.checks.some((entry, index) =>
          entry?.run !== RUNS[index] || !ALLOWED.has(entry?.status))) {
      throw new Error("DIAGNOSTIC_RESPONSE_INVALID");
    }
    return candidate;
  }

  async function run() {
    if (disposed || view.hidden || controller) return;
    const epoch = ++generation;
    controller = new AbortController();
    runButton.disabled = true;
    resultPanel.hidden = true;
    status.textContent = "PROTOCOL EXECUTING";
    status.dataset.status = "RUNNING";
    position.textContent = "POSITION / RESOLVING";
    for (const row of rows) {
      row.dataset.status = "PENDING";
      row.querySelector("[data-diagnostic-status]").textContent = "···";
    }

    let payload;
    try {
      const response = await request("/api/tools/diagnostics", {
        method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      payload = safeReport(await response.json());
      if (response.ok && payload.status !== "PASS") throw new Error("DIAGNOSTIC_STATUS_MISMATCH");
    } catch (error) {
      if (epoch !== generation || error?.name === "AbortError") return;
      payload = {
        protocol: "DONSKOY_2.0 / DIAGNOSTICS", status: "FAIL", read_only: true,
        checks: RUNS.map((run, index) => ({ run, status: index === 0 ? "FAIL" : "SKIP" })),
      };
    } finally {
      if (epoch === generation) controller = null;
    }
    if (epoch !== generation || disposed || view.hidden) return;

    for (const [index, row] of rows.entries()) {
      if (epoch !== generation || disposed || view.hidden) return;
      const verdict = payload.checks[index].status;
      row.dataset.status = verdict;
      row.querySelector("[data-diagnostic-status]").textContent = verdict;
      await new Promise((resolve) => setTimeout(resolve, 115));
    }
    if (epoch !== generation || disposed || view.hidden) return;

    const place = payload.position;
    if (place && typeof place.chapter === "string" &&
        /^(0[1-9]|1[0-2])$/.test(place.chapter) &&
        ["earth", "heaven"].includes(place.layer) &&
        typeof place.chunk === "string") {
      position.textContent = `CH ${String(place.chapter).padStart(2, "0")} · ${place.layer.toUpperCase()} · ${place.chunk}`;
    } else {
      position.textContent = "POSITION / UNAVAILABLE";
    }
    status.textContent = payload.status === "PASS" ? "PROTOCOL COMPLETE" : "PROTOCOL INCOMPLETE";
    status.dataset.status = payload.status;
    output.textContent = JSON.stringify(payload, null, 2);
    resultPanel.hidden = false;
    runButton.disabled = false;
    runButton.textContent = "RUN AGAIN";
  }

  openButton.addEventListener("click", open);
  backButton.addEventListener("click", close);
  runButton.addEventListener("click", run);
  reset();

  function dispose() {
    if (disposed) return;
    disposed = true;
    close();
    openButton.removeEventListener("click", open);
    backButton.removeEventListener("click", close);
    runButton.removeEventListener("click", run);
  }
  return Object.freeze({ close, dispose });
}
