import type { OpencodeClient, Config } from "@opencode-ai/sdk";

/**
 * Plugin identifiers that indicate oh-my-opencode (omo) is installed. The
 * plugin may be referenced by its npm name, a scoped name, or a local path
 * containing the project name.
 */
const OMO_MARKERS = ["oh-my-opencode", "oh-my-openagent", "omo"];

/** Extract the plugin spec string from a config plugin entry. */
function pluginSpec(entry: string | [string, Record<string, unknown>]): string {
  return Array.isArray(entry) ? entry[0] : entry;
}

/** Pure check: does the config's plugin list reference omo? */
export function isOmoInstalled(config: Config | undefined): boolean {
  const plugins = config?.plugin;
  if (!Array.isArray(plugins)) return false;
  return plugins.some((entry) => {
    const spec = pluginSpec(entry).toLowerCase();
    return OMO_MARKERS.some((marker) => spec.includes(marker));
  });
}

/**
 * Detect whether omo is installed by reading the global opencode config.
 * Returns false on any error (e.g. no server / no config) so the plugin can
 * degrade gracefully instead of crashing.
 */
export async function detectOmo(client: OpencodeClient): Promise<boolean> {
  try {
    const res = await client.config.get();
    const config = res.data;
    return isOmoInstalled(config);
  } catch {
    return false;
  }
}
