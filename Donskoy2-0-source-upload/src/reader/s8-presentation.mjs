const CODE_SIGNAL = /(?:[={}\[\]()]+|\b[A-Z][A-Z0-9_]{2,}\b|\b[a-z_][a-z0-9_.]*\s*=)/u;
const TOKEN_RE = /(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<keyword>\b(?:true|false|null)\b)|(?<constant>\b[A-Z][A-Z0-9_]{2,}\b)|(?<number>\b\d+(?::\d+)?\b)|(?<function>\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\())|(?<field>\b(?:owner|medium|event|subject|entity|status|entry|time|release|scene|layer|cursor|revision|language|content|role|type|id)\b)|(?<operator>[={}\[\]():.,])/gu;
const CHARACTER_VALUE_RE = /^(.*?\.{2,}\s+)(.+)$/u;

export function shouldHighlightSystemLine(text) {
  return typeof text === "string" && CODE_SIGNAL.test(text);
}

export function systemSyntaxTokens(text) {
  if (typeof text !== "string") throw new TypeError("system syntax source must be a string");
  const tokens = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    if (match.index > cursor) tokens.push({ type: null, text: text.slice(cursor, match.index) });
    const type = Object.entries(match.groups || {}).find(([, value]) => value !== undefined)?.[0] ?? null;
    tokens.push({ type, text: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: null, text: text.slice(cursor) });
  return tokens;
}

export function characterCardSyntaxTokens(text) {
  if (typeof text !== "string") throw new TypeError("character syntax source must be a string");
  const pair = CHARACTER_VALUE_RE.exec(text);
  if (pair) {
    return [
      { type: null, text: pair[1] },
      { type: /^\d+$/u.test(pair[2]) ? "number" : "constant", text: pair[2] },
    ];
  }
  if (text.trimEnd().endsWith("?")) return [{ type: "danger", text }];
  return [{ type: null, text }];
}

function renderTokens(node, tokens) {
  const fragment = document.createDocumentFragment();
  for (const token of tokens) {
    if (!token.type) {
      fragment.append(document.createTextNode(token.text));
      continue;
    }
    const span = document.createElement("span");
    span.className = `system-syntax system-syntax--${token.type}`;
    span.textContent = token.text;
    fragment.append(span);
  }
  node.replaceChildren(fragment);
  node.dataset.syntaxHighlighted = "true";
}

function renderSyntax(node, text) {
  if (!shouldHighlightSystemLine(text)) return false;
  renderTokens(node, systemSyntaxTokens(text));
  return true;
}

function isCharacterCardLine(node) {
  const panel = node.closest(".system-panel");
  const label = panel?.firstElementChild;
  return label instanceof HTMLElement
    && label.classList.contains("system-panel__label")
    && label.textContent === "CHARACTER";
}

function decorateSystemLine(node) {
  if (!(node instanceof HTMLElement) || !node.matches(".system-line")) return;
  if (node.dataset.systemLineState !== "settled" || node.dataset.syntaxHighlighted === "true") return;
  const text = node.textContent ?? "";
  if (isCharacterCardLine(node)) renderTokens(node, characterCardSyntaxTokens(text));
  else renderSyntax(node, text);
  if ((node.textContent ?? "") !== text) throw new Error("S8 syntax decoration changed SYSTEM text");
}

function scan(node) {
  if (!(node instanceof HTMLElement)) return;
  decorateSystemLine(node);
  for (const line of node.querySelectorAll(".system-line")) decorateSystemLine(line);
}

export function installS8Presentation(root) {
  if (!(root instanceof HTMLElement)) throw new TypeError("S8 presentation root must be HTMLElement");
  const flow = root.querySelector("[data-reader-flow]");
  if (!(flow instanceof HTMLElement)) throw new Error("reader flow missing for S8 presentation");

  scan(flow);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") scan(record.target);
      for (const node of record.addedNodes) scan(node);
    }
  });
  observer.observe(flow, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-system-line-state"],
  });

  return Object.freeze({ disconnect: () => observer.disconnect() });
}
