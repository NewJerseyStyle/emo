// postinstall.mjs — set up the HL repo (~/.hl) on install.
// Best-effort: never fail the install if setup is not possible.
import os from "node:os";
import path from "node:path";

try {
  const { ensureRepo } = await import("./dist/index.js");
  const root = path.join(os.homedir(), ".hl");
  ensureRepo({ root, autoPush: false });
  console.log(`[cache-compaction] HL repo ready at ${root}`);
} catch (err) {
  console.warn(
    `[cache-compaction] HL repo setup skipped: ${err instanceof Error ? err.message : String(err)}`,
  );
}
