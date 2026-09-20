import fs from "node:fs";
import type { CompletedWorkSnapshot } from "../../src/bridge-types";
import { executeEffectWithReceipt } from "../../src/processing/receipts";

const [snapshotPath, projectRoot, receiptRoot, effectLog] = process.argv.slice(2);
if (snapshotPath === undefined || projectRoot === undefined || receiptRoot === undefined || effectLog === undefined) {
  throw new Error("missing worker arguments");
}
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as CompletedWorkSnapshot;
const result = await executeEffectWithReceipt({
  projectRoot,
  receiptRoot,
  snapshot,
  effect: "memory",
  adapterID: "separate-process-test/v1",
  lockTimeoutMs: 2_000,
  lockLeaseMs: 1_000,
}, async () => {
  fs.appendFileSync(effectLog, "promoted\n");
  await new Promise((resolve) => setTimeout(resolve, 100));
});
process.stdout.write(result);
