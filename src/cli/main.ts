import fs from "node:fs";
import { openStore } from "../kb";
import type { DocKind, Frontmatter } from "../kb";

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  /** Body text from stdin; only called when --file is "-" or no body flag is given. */
  readStdin(): string;
}

const USAGE = `emo - project knowledge on the "exp" branch

  emo init
  emo plan add --goal <text> [--status draft|confirmed|done|dropped] [--supersedes <id>] [--file <path|->]
  emo lesson add --title <text> (--what <t> --why <t> --do <t> | --file <path|->)
  emo decision add --title <text> [--status proposed|accepted|superseded] [--supersedes <id>] [--file <path|->]
  emo close --plan <id> --outcome <text> [--tokens-estimated <n>] [--tokens-actual <n>] --file <path|->
  emo list <plan|closure|decision|lesson> [--all]   (hides superseded versions unless --all)
  emo show <id>
  emo validate
  emo sync

Options: --repo <dir> (default: cwd)  --author <name>
Creating commands print the new document id on stdout.`;

type Flags = Record<string, string>;

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "all") {
        flags[key] = "true";
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("--") && next !== "-")) {
        throw new Error(`--${key} needs a value`);
      }
      flags[key] = next;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function need(flags: Flags, key: string): string {
  const value = flags[key];
  if (value === undefined || value.trim() === "") throw new Error(`missing --${key}`);
  return value;
}

function bodyFrom(flags: Flags, io: Io): string {
  const file = flags.file;
  if (file === undefined) return "";
  return file === "-" ? io.readStdin() : fs.readFileSync(file, "utf8");
}

function num(flags: Flags, key: string): number | undefined {
  const raw = flags[key];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
}

const KINDS = ["plan", "closure", "decision", "lesson"];

function isKind(value: string | undefined): value is DocKind {
  return value !== undefined && KINDS.includes(value);
}

/** Run one CLI invocation. Returns the process exit code. */
export function run(argv: string[], io: Io): number {
  try {
    const { positional, flags } = parseArgs(argv);
    const [cmd, sub] = positional;
    if (cmd === undefined || cmd === "help") {
      io.out(USAGE);
      return cmd === undefined ? 1 : 0;
    }

    const store = openStore({
      repo: flags.repo ?? io.cwd,
      ...(flags.author !== undefined ? { author: flags.author } : {}),
    });

    switch (cmd) {
      case "init":
        io.out(store.root);
        return 0;

      case "plan": {
        if (sub !== "add") throw new Error("usage: emo plan add");
        const meta: Frontmatter = { goal: need(flags, "goal"), status: flags.status ?? "draft" };
        if (flags.supersedes !== undefined) meta.supersedes = flags.supersedes;
        const doc = store.addDoc({
          kind: "plan",
          meta,
          body: bodyFrom(flags, io) || `## Tasks\n\n(to be filled in by PM)\n`,
        });
        io.out(doc.id);
        return 0;
      }

      case "lesson": {
        if (sub !== "add") throw new Error("usage: emo lesson add");
        const body =
          flags.file !== undefined
            ? bodyFrom(flags, io)
            : `## What happened\n${need(flags, "what")}\n\n## Why\n${need(flags, "why")}\n\n## Do differently\n${need(flags, "do")}\n`;
        const doc = store.addDoc({ kind: "lesson", meta: { title: need(flags, "title") }, body });
        io.out(doc.id);
        return 0;
      }

      case "decision": {
        if (sub !== "add") throw new Error("usage: emo decision add");
        const meta: Frontmatter = { title: need(flags, "title"), status: flags.status ?? "proposed" };
        if (flags.supersedes !== undefined) meta.supersedes = flags.supersedes;
        const doc = store.addDoc({ kind: "decision", meta, body: bodyFrom(flags, io) || "(rationale)\n" });
        io.out(doc.id);
        return 0;
      }

      case "close": {
        const meta: Frontmatter = { plan: need(flags, "plan"), outcome: need(flags, "outcome") };
        const estimated = num(flags, "tokens-estimated");
        const actual = num(flags, "tokens-actual");
        if (estimated !== undefined) meta.tokens_estimated = estimated;
        if (actual !== undefined) meta.tokens_actual = actual;
        const doc = store.addDoc({ kind: "closure", meta, body: bodyFrom(flags, io) });
        io.out(doc.id);
        return 0;
      }

      case "list": {
        if (!isKind(sub)) throw new Error(`usage: emo list <${KINDS.join("|")}>`);
        const docs = store.list(sub);
        const replaced = new Set(
          docs.flatMap((d) => (typeof d.frontmatter.supersedes === "string" ? [d.frontmatter.supersedes] : [])),
        );
        for (const doc of docs) {
          if (flags.all === undefined && replaced.has(doc.id)) continue;
          const label = doc.frontmatter.title ?? doc.frontmatter.goal ?? doc.frontmatter.outcome ?? "";
          io.out(`${doc.id}\t${String(label)}`);
        }
        return 0;
      }

      case "show": {
        if (sub === undefined) throw new Error("usage: emo show <id>");
        const doc = store.get(sub);
        if (doc === null) throw new Error(`no document ${sub}`);
        io.out(fs.readFileSync(`${store.root}/${doc.path}`, "utf8").trimEnd());
        return 0;
      }

      case "validate": {
        const problems = store.validateAll();
        for (const p of problems) io.err(`${p.path}: ${p.errors.join("; ")}`);
        io.out(problems.length === 0 ? "ok" : `${problems.length} invalid document(s)`);
        return problems.length === 0 ? 0 : 1;
      }

      case "sync": {
        const result = store.sync();
        io.out(result.pushed ? `synced (pulled=${result.pulled})` : "no origin remote; nothing to sync");
        return 0;
      }

      default:
        throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
    }
  } catch (err) {
    io.err(`emo: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
