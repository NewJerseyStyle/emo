import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashTree } from "./helpers";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "emo-package-"));
const packRoot = path.join(workspace, "pack");
const consumerRoot = path.join(workspace, "consumer");
const isolatedHome = path.join(workspace, "home");
let tarball = "";

function run(
  command: string[],
  cwd: string,
  environment: Record<string, string> = {},
): string {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${result.exitCode}): ${command.join(" ")}\n${stdout}\n${stderr}`,
    );
  }
  return stdout;
}

beforeAll(() => {
  fs.mkdirSync(packRoot, { recursive: true });
  run(["bun", "run", "build"], repositoryRoot);
  run(["bun", "pm", "pack", "--destination", packRoot, "--quiet"], repositoryRoot);
  const packed = fs.readdirSync(packRoot).filter((name) => name.endsWith(".tgz"));
  expect(packed).toHaveLength(1);
  tarball = path.join(packRoot, packed[0]!);
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("packed package contract", () => {
  it("contains only the supported plugin, library, declarations, and documentation", () => {
    const entries = run(["tar", "-tzf", tarball], repositoryRoot)
      .trim()
      .split("\n")
      .filter(Boolean);

    expect(entries).toContain("package/dist/index.js");
    expect(entries).toContain("package/dist/index.d.ts");
    expect(entries).toContain("package/dist/library.js");
    expect(entries).toContain("package/dist/library.d.ts");
    expect(entries).toContain("package/README.md");
    expect(entries).toContain("package/docs/migration-0.2.md");
    expect(entries.some((entry) => entry.includes("postinstall"))).toBe(false);
    expect(entries.some((entry) => entry.startsWith("package/src/"))).toBe(false);
    expect(entries.some((entry) => /\/(ba|pm|orchestrator|hl-repo|state-machine|ulw-detector)(\/|\.)/.test(entry))).toBe(false);
  });

  it("publishes the 0.2 export map without lifecycle scripts or an OMO dependency", () => {
    const manifest = JSON.parse(
      run(["tar", "-xOzf", tarball, "package/package.json"], repositoryRoot),
    ) as {
      version?: string;
      exports?: Record<string, unknown>;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(manifest.version).toBe("0.2.0");
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([".", "./library"]);
    expect(manifest.scripts?.postinstall).toBeUndefined();
    expect(manifest.dependencies?.["@opencode-ai/sdk"]).toBeUndefined();
    expect(
      Object.keys(manifest.dependencies ?? {}).some((name) => name.startsWith("@oh-my-opencode/")),
    ).toBe(false);
  });

  it("installs and imports from an isolated home without mutating it", () => {
    fs.mkdirSync(consumerRoot, { recursive: true });
    fs.mkdirSync(isolatedHome, { recursive: true });
    const cacheRoot = run(["bun", "pm", "cache"], repositoryRoot).trim();
    fs.writeFileSync(
      path.join(consumerRoot, "package.json"),
      JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: {
            "@cache-aware/opencode-cache-compaction": `file:${tarball}`,
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(consumerRoot, "verify.mjs"),
      [
        'import * as root from "@cache-aware/opencode-cache-compaction";',
        'import * as library from "@cache-aware/opencode-cache-compaction/library";',
        'if (JSON.stringify(Object.keys(root)) !== JSON.stringify(["default"])) throw new Error("root export leaked utilities");',
        'if (!root.default || typeof root.default.id !== "string" || typeof root.default.server !== "function") throw new Error("invalid plugin default export");',
        'for (const name of ["discoverCompletedWork", "processCompletedWork", "createClosureExporter"]) {',
        '  if (typeof library[name] !== "function") throw new Error(`missing library export: ${name}`);',
        '}',
      ].join("\n"),
    );
    const before = hashTree(isolatedHome);
    const environment = {
      HOME: isolatedHome,
      XDG_CACHE_HOME: path.join(workspace, "xdg-cache"),
      BUN_INSTALL_CACHE_DIR: cacheRoot,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    };

    run(["bun", "install", "--prefer-offline"], consumerRoot, environment);
    run(["bun", "verify.mjs"], consumerRoot, environment);

    expect(hashTree(isolatedHome)).toBe(before);
    expect(fs.existsSync(path.join(isolatedHome, ".hl"))).toBe(false);
    expect(fs.existsSync(path.join(consumerRoot, ".hl"))).toBe(false);
    expect(fs.existsSync(path.join(consumerRoot, ".omo"))).toBe(false);
    expect(fs.existsSync(path.join(consumerRoot, ".emo"))).toBe(false);
  });
});
