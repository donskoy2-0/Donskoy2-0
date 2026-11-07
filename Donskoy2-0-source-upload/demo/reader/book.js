"use strict";
const el = id => document.getElementById(id);
const languages = {ru:"Russian", ua:"Ukrainian", en:"English"};
const layers = {earth:"Earth", heaven:"Heaven"};
const controls = Object.fromEntries(["decrease","increase","theme"].map(id => [id, el(id)]));
createDisplayController({controls});

function validate(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) throw Error("Expected a list of excerpts.");
  const keys = new Set();
  for (const c of chunks) {
    if (!c || !Number.isInteger(c.chapter) || c.chapter < 1 || !Object.hasOwn(layers,c.layer)) throw Error("Check the chapter number and layer.");
    const key = c.chapter + "/" + c.layer;
    if (keys.has(key)) throw Error("Duplicate chapter and layer.");
    keys.add(key);
    for (const lang of Object.keys(languages)) {
      if (!Array.isArray(c[lang]) || !c[lang].length) throw Error("Three translations are required.");
      for (const line of c[lang]) {
        if (typeof line?.text !== "string") throw Error("A line is missing its text.");
        if (line.colors && !(Array.isArray(line.colors) && line.colors.length === 2 && line.colors.every(v => /^#[0-9a-f]{6}$/i.test(v)))) throw Error("Invalid colour palette.");
      }
    }
  }
  return chunks;
}
let edition = validate(JSON.parse(el("edition").textContent));
function options(select, entries) {
  const previous = select.value;
  select.replaceChildren(...entries.map(([id,name]) => new Option(name,id)));
  if (entries.some(([id]) => String(id) === previous)) select.value = previous;
}
function chapters() {
  const nums = [...new Set(edition.map(c => c.chapter))].sort((a,b) => a-b);
  options(el("chapter"),nums.map(n => [n,n]));
  selectChapter();
}
function selectChapter() {
  const available = edition.filter(c => c.chapter === Number(el("chapter").value));
  options(el("layer"),available.map(c => [c.layer,layers[c.layer]]));
  render();
}
function render() {
  const current = edition.find(c => c.chapter === Number(el("chapter").value) && c.layer === el("layer").value);
  const pages = [];
  for (const [lang,name] of Object.entries(languages)) {
    const section = document.createElement("section");
    section.lang = lang === "ua" ? "uk" : lang;
    const title = document.createElement("h2"); title.textContent = name; section.append(title);
    for (const line of current[lang]) {
      const p = document.createElement("p"); p.textContent = line.text;
      if (line.style === "document") p.className = "doc";
      if (line.style === "system") p.className = "system";
      if (line.colors) {
        p.classList.add("voice");
        p.style.setProperty("--dark",line.colors[0]);
        p.style.setProperty("--light",line.colors[1]);
      }
      section.append(p);
    }
    pages.push(section);
  }
  el("pages").replaceChildren(...pages);
}
el("chapter").addEventListener("change",selectChapter);
el("layer").addEventListener("change",render);
async function openFile(file) {
  if (!file) return;
  try {
    if (file.size > 16*1024*1024) throw Error("The file exceeds 16 MB.");
    edition = validate(JSON.parse(await file.text()));
    chapters(); el("status").textContent = file.name;
  } catch (e) { el("status").textContent = "Could not open JSON. " + e.message; }
}
el("file").addEventListener("change",e => openFile(e.target.files[0]));
document.addEventListener("dragover",e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
document.addEventListener("drop",e => { if (e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files[0]); } });
chapters();
