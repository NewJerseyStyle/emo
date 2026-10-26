import type { UlwSignal } from "./types";

// Pure function. Returns true if the session is a ULW/ulw-loop session.
// ULW if goalStatus is set (active/complete/paused) OR any recent message
// text matches /\b(ulw|ultrawork|ulw-loop)\b/i
export function isUlwSession(signal: UlwSignal): boolean {
  if (signal.goalStatus !== null) {
    return true;
  }
  return signal.recentMessages.some((message) => /\b(ulw|ultrawork|ulw-loop)\b/i.test(message));
}
