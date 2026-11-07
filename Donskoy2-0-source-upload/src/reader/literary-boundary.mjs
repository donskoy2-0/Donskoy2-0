// Shared, DOM-replacement-safe prose boundary projection for notebook and audio.
const EMPTY_EVENTS = Object.freeze([]);

function readerTopLine(root) {
  const statusbar = root.querySelector(".reader-statusbar");
  return Math.max(0, statusbar?.getBoundingClientRect().bottom ?? 0) + 10;
}

function readerAtDocumentEnd() {
  const scrolling = document.scrollingElement;
  if (!scrolling) return false;
  return scrolling.scrollHeight - scrolling.clientHeight - scrolling.scrollTop <= 2;
}

function activationLine(root) {
  return Math.max(readerTopLine(root) + 48, window.innerHeight * 0.78);
}

function findContentNode(section, contentId) {
  for (const node of section.querySelectorAll("[data-content-id]")) {
    if (node instanceof HTMLElement && node.dataset.contentId === contentId) return node;
  }
  return null;
}

function textRangeRect(copy, lineIndex) {
  const text = copy.textContent ?? "";
  const lines = text.split("\n");
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;

  let lineStart = 0;
  for (let index = 0; index < lineIndex; index += 1) lineStart += lines[index].length + 1;
  const lineEnd = lineStart + lines[lineIndex].length;
  if (lineEnd <= lineStart) return null;

  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let length = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const size = node.nodeValue?.length ?? 0;
    nodes.push({ node, start: length, end: length + size });
    length += size;
  }

  const locate = (offset, preferPrevious = false) => {
    for (const entry of nodes) {
      if (offset < entry.end || (!preferPrevious && offset === entry.start)) {
        return { node: entry.node, offset: Math.max(0, Math.min(entry.end - entry.start, offset - entry.start)) };
      }
    }
    const last = nodes.at(-1);
    return last ? { node: last.node, offset: last.end - last.start } : null;
  };

  const start = locate(Math.max(lineStart, lineEnd - 1));
  const end = locate(lineEnd, true);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const rects = range.getClientRects();
  return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
}

function eventReached(event, section, root) {
  const node = findContentNode(section, event.contentId);
  if (!(node instanceof HTMLElement)) return null;

  if (event.kind === "line") {
    const copy = node.querySelector(".reader-block__text");
    if (!(copy instanceof HTMLElement)) return null;
    const rect = textRangeRect(copy, event.afterLineIndex);
    if (!rect) return null;
    return rect.bottom <= activationLine(root) || (readerAtDocumentEnd() && rect.top < window.innerHeight);
  }

  if (node.classList.contains("system-line")) return node.dataset.systemLineState === "settled";
  const rect = node.getBoundingClientRect();
  const edge = event.edge === "start" ? rect.top : rect.bottom;
  return edge <= activationLine(root) || (readerAtDocumentEnd() && rect.top < window.innerHeight);
}

export function installLiteraryBoundaryProjection(section, root, { events = EMPTY_EVENTS, onEvent = null } = {}) {
  if (!(section instanceof HTMLElement) || !(root instanceof HTMLElement) || typeof onEvent !== "function" || events.length === 0) {
    return () => {};
  }

  let index = 0;
  let frame = 0;
  let disconnected = false;

  const cleanup = () => {
    if (disconnected) return;
    disconnected = true;
    observer.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const check = () => {
    frame = 0;
    if (disconnected || !section.isConnected) return;
    while (index < events.length) {
      const reached = eventReached(events[index], section, root);
      if (reached === true) {
        onEvent(events[index]);
        index += 1;
        continue;
      }
      // Never leap over an existing, not-yet-reached literary boundary.
      // Only an unresolvable anchor may be dropped, and only after a later
      // boundary has itself causally entered. Optional media must fail open.
      if (reached === null && events.slice(index + 1).some((event) => eventReached(event, section, root) === true)) {
        console.warn("LITERARY_BOUNDARY_ANCHOR_SKIPPED", events[index].id);
        index += 1;
        continue;
      }
      break;
    }
    if (index >= events.length) cleanup();
  };

  const schedule = () => {
    if (disconnected || frame) return;
    frame = requestAnimationFrame(check);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-system-line-state"] });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
  return cleanup;
}
