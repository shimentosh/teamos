// Who is using TeamOS right now. Every open page keeps calling the API, so a
// recent signed-in request is the one presence signal that does not depend on
// a WebSocket or an event stream surviving a restart or getting through a
// reverse proxy. Kept in memory, which is exact for a single API instance;
// with several instances each only knows its own callers.
const lastSeen = new Map<string, number>();

/** Marks the person as using TeamOS right now. */
export function markWebPresence(userId: string, now = Date.now()) {
  lastSeen.set(userId, now);
}

/** Ids of people who called the API since `since`. */
export function webPresentUserIds(since: number) {
  const present = new Set<string>();
  for (const [userId, seen] of lastSeen) {
    if (seen > since) present.add(userId);
    // Someone who stopped calling is gone for good until they come back, so
    // the entry is dropped rather than kept for the lifetime of the process.
    else lastSeen.delete(userId);
  }
  return present;
}
