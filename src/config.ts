import type { CacheCompactionConfig } from "./types";

export const DEFAULT_CONFIG: CacheCompactionConfig = {
  enabled: true,
  minContextTokens: 20_000, // below this, context too small to bother compacting
  heartbeatIntervalMs: 270_000, // 4.5 min — send heartbeat before 5min cache TTL
  idleTimeoutMs: 60_000, // 60s of no typing → user gave up → compact
  gracePeriodMs: 5_000, // idle → wait 5s before compacting (chance to type)
  maxHeartbeats: 3, // cap heartbeats, then force compact
  cacheTtlMs: 300_000, // 5 min provider cache TTL
};
