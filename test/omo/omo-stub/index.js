// Minimal stub for oh-my-openagent (omo) so opencode can load it without error.
// Used only to make the cache-compaction plugin detect omo as present and
// exercise the BA routing path. This is NOT the real omo.
export default {
  id: "oh-my-openagent",
  server: async () => ({}),
};
