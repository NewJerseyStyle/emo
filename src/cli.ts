#!/usr/bin/env bun
import fs from "node:fs";
import { run } from "./cli/main";

const code = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readStdin: () => fs.readFileSync(0, "utf8"),
});
process.exit(code);
