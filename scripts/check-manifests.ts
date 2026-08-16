#!/usr/bin/env bun
/**
 * Verifies the plugin's two manifests agree, and optionally that they match a
 * release tag.
 *
 * A marketplace entry pinning a version the plugin manifest disagrees with is
 * the kind of mistake that installs cleanly and then serves the wrong thing.
 * This runs in CI with no dependency on the `claude` CLI being present.
 *
 *   bun run scripts/check-manifests.ts            # manifests agree
 *   bun run scripts/check-manifests.ts v2.0.0     # ...and match this tag
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

interface PluginManifest {
  name?: string;
  version?: string;
  metadata?: { hookContractVersion?: number };
}

interface MarketplaceManifest {
  name?: string;
  owner?: { name?: string };
  plugins?: Array<{ name?: string; source?: string; version?: string; description?: string }>;
}

const problems: string[] = [];
const note = (message: string) => problems.push(message);

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, relative), "utf8")) as T;
}

const plugin = await readJson<PluginManifest>(".claude-plugin/plugin.json");
const marketplace = await readJson<MarketplaceManifest>(".claude-plugin/marketplace.json");

if (!plugin.name) note("plugin.json is missing `name`, the one required field.");
if (!plugin.version) note("plugin.json is missing `version`, so users never receive updates.");

const entry = marketplace.plugins?.find((p) => p.name === plugin.name);
if (!entry) {
  note(`marketplace.json has no entry named "${plugin.name}".`);
} else {
  if (entry.source !== "./") {
    note(`marketplace.json entry should use "source": "./" for a single-plugin repo (found ${JSON.stringify(entry.source)}).`);
  }
  if (entry.version !== plugin.version) {
    note(`Version mismatch: plugin.json says ${plugin.version}, marketplace.json says ${entry.version}.`);
  }
  if (!entry.description) {
    note("The marketplace entry needs a description — `claude plugin validate --strict` fails without one.");
  }
}

// `cmc --version` reads package.json, so it is user-visible output. If it drifts
// from the manifests, users are told a version we never shipped.
const pkg = await readJson<{ version?: string }>("package.json");
if (pkg.version !== plugin.version) {
  note(`Version mismatch: plugin.json says ${plugin.version}, package.json says ${pkg.version} — this is what \`cmc --version\` prints.`);
}

if (!marketplace.description) {
  note("marketplace.json needs a top-level description to pass --strict validation.");
}

// The hook contract the code speaks must match what hooks.json passes.
const { HOOK_CONTRACT_VERSION } = await import("../src/surfaces/hook/contract.ts");
const hooks = await readFile(join(ROOT, "hooks/hooks.json"), "utf8");
const declared = [...hooks.matchAll(/--contract\s+(\d+)/g)].map((m) => Number(m[1]));

if (declared.length === 0) {
  note("hooks.json does not pass --contract, so a version mismatch would go undetected.");
}
for (const version of declared) {
  if (version !== HOOK_CONTRACT_VERSION) {
    note(`hooks.json passes --contract ${version} but the code speaks v${HOOK_CONTRACT_VERSION}.`);
  }
}

// When run for a release, the tag is the third source of truth.
const tag = process.argv[2];
if (tag) {
  const expected = tag.replace(/^v/, "");
  if (expected !== plugin.version) {
    note(`Tag ${tag} does not match plugin.json version ${plugin.version}.`);
  }
}

if (problems.length > 0) {
  console.error("Manifest check failed:\n");
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(
  `✔ Manifests agree — ${plugin.name} ${plugin.version}, hook contract v${HOOK_CONTRACT_VERSION}${tag ? `, tag ${tag}` : ""}`,
);
