import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
await mkdir(dist, {recursive: true});
for (const dir of ["demo/", "license/", "src/reader/", "src/kernel/", "canon/"]) {
  await cp(new URL(dir, root), new URL(dir, dist), {recursive: true});
}
async function copyOptionalMedia() {
  await cp(new URL("assets/media/", root), new URL("media/", dist), {recursive:true});
}
await copyOptionalMedia();
await cp(new URL("assets/fonts/", root), new URL("fonts/", dist), {recursive:true});
await writeFile(new URL("index.html",dist), await readFile(new URL("index.html",root)));
console.log(fileURLToPath(dist));
