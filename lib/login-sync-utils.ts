export const LOGIN_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export function getPreviousMonthRefreshCutoff(now = new Date()) {
  const cutoffDay = Math.min(now.getUTCDate(), 4);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cutoffDay));
}

export function isMetricUpdateBeforeCutoff(updatedAt: string | null | undefined, cutoff: Date) {
  if (!updatedAt) return true;

  const updatedAtTime = new Date(updatedAt).getTime();
  return !Number.isFinite(updatedAtTime) || updatedAtTime < cutoff.getTime();
}

export function isLoginSyncFresh(lastSyncedAt: string | null | undefined, now = new Date()) {
  if (!lastSyncedAt) return false;

  const syncedAt = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(syncedAt)) return false;

  return now.getTime() - syncedAt < LOGIN_SYNC_INTERVAL_MS;
}

export function getLoginSyncScope(channelIds: string[]) {
  return `all-focused-channels:${hashValues(channelIds)}`;
}

function hashValues(values: string[]) {
  let hash = 5381;
  for (const value of [...values].sort().join("|")) {
    hash = ((hash << 5) + hash + value.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}
