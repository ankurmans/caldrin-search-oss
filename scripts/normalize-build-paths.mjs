import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const root = process.cwd();
const relativePath = (value) => {
  if (typeof value !== "string" || !isAbsolute(value)) return value;
  const path = relative(root, value);
  return path && !path.startsWith("../") && path !== ".." ? path : value;
};

async function rewriteJson(path, transform) {
  const content = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify(transform(content), null, 2) + "\n");
}

// These generated config fields identify the source config for diagnostics.
for (const worker of ["server", "caldrin_search_audit_byok_preview"]) {
  await rewriteJson(resolve("dist", worker, "wrangler.json"), (config) => ({
    ...config,
    configPath: relativePath(config.configPath),
    userConfigPath: relativePath(config.userConfigPath),
  }));
}

// Vite emits dependency paths in this build manifest. Keep its keys and source
// fields relocatable while preserving assets, imports and configuration.
await rewriteJson("dist/server/.vite/manifest.json", (manifest) =>
  Object.fromEntries(
    Object.entries(manifest).map(([id, metadata]) => [
      relativePath(id),
      { ...metadata, src: relativePath(metadata.src) },
    ]),
  ),
);

// The SSR manifest includes build-time route source paths. Route IDs and
// imports keep their original values.
const assets = resolve("dist/server/assets");
const routeManifests = (await readdir(assets)).filter((name) =>
  /^_tanstack-start-manifest_v-.*\.js$/.test(name),
);
if (routeManifests.length !== 1)
  throw new Error("Expected one SSR route manifest");
const routeManifest = resolve(assets, routeManifests[0]);
const routes = await readFile(routeManifest, "utf8");
await writeFile(
  routeManifest,
  routes.replace(/filePath:\s*("(?:[^"\\]|\\.)*")/g, (match, value) => {
    const path = relativePath(JSON.parse(value));
    return path.startsWith("src/routes/")
      ? `filePath: ${JSON.stringify(path)}`
      : match;
  }),
);
