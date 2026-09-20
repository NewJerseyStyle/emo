import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface HostileClient {
  client: unknown;
  calls: string[];
}

export function createHostileClient(): HostileClient {
  const calls: string[] = [];
  const makeProxy = (trail: string): object =>
    new Proxy(
      function prohibited() {},
      {
        get(_target, property) {
          const next = trail ? `${trail}.${String(property)}` : String(property);
          calls.push(next);
          return makeProxy(next);
        },
        apply() {
          calls.push(`${trail}()`);
          throw new Error(`prohibited OpenCode client call: ${trail}`);
        },
      },
    );
  return { client: makeProxy("client"), calls };
}

export function copyFixture(name: string, destination: string): void {
  const source = path.join(import.meta.dir, "fixtures", name);
  fs.cpSync(source, destination, { recursive: true });
}

export function hashTree(root: string): string {
  if (!fs.existsSync(root)) return "missing";
  const hash = createHash("sha256");
  const visit = (current: string, relative: string): void => {
    const stat = fs.lstatSync(current);
    const normalized = relative.split(path.sep).join("/");
    hash.update(`${normalized}\0${stat.mode & 0o7777}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(`link\0${fs.readlinkSync(current)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update("directory\0");
      for (const entry of fs.readdirSync(current).sort()) {
        visit(path.join(current, entry), path.join(relative, entry));
      }
      return;
    }
    if (stat.isFile()) {
      hash.update("file\0");
      hash.update(fs.readFileSync(current));
      return;
    }
    hash.update("other\0");
  };
  visit(root, ".");
  return hash.digest("hex");
}

export function makeReadOnlyTree(root: string): void {
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) visit(path.join(current, entry));
      fs.chmodSync(current, 0o555);
    } else if (stat.isFile()) {
      fs.chmodSync(current, 0o444);
    }
  };
  visit(root);
}

export function makeWritableTree(root: string): void {
  if (!fs.existsSync(root)) return;
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o755);
      for (const entry of fs.readdirSync(current)) visit(path.join(current, entry));
    } else if (stat.isFile()) {
      fs.chmodSync(current, 0o644);
    }
  };
  visit(root);
}

export function findFiles(root: string, suffix?: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort()) visit(path.join(current, entry));
    } else if (stat.isFile() && (suffix === undefined || current.endsWith(suffix))) {
      files.push(current);
    }
  };
  visit(root);
  return files;
}

export interface PluginHooks {
  event?: (input: { event: { type: string; properties: { sessionID: string } } }) => Promise<void>;
}

export interface PluginModule {
  id: string;
  server: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<PluginHooks>;
}

export function pluginInput(projectRoot: string, client: unknown): Record<string, unknown> {
  return {
    client,
    directory: projectRoot,
    worktree: projectRoot,
    project: {
      id: "fixture-project",
      directory: projectRoot,
      worktree: projectRoot,
    },
    serverUrl: new URL("http://127.0.0.1:1"),
    $: () => {
      throw new Error("plugin must not execute a subprocess");
    },
  };
}
