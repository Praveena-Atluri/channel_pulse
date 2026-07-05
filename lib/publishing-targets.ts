export type PublishingTargetPeriod = "daily" | "weekly";

export type PublishingTargetSetting = {
  period: PublishingTargetPeriod;
  value: number | null;
};

export function normalizePublishingTargetPeriod(value: unknown): PublishingTargetPeriod {
  if (value === null || value === undefined || value === "") return "daily";
  if (value === "daily" || value === "weekly") return value;

  throw new Error("Publishing target cadence must be daily or weekly.");
}

export function derivePublishingTargetForDays(target: PublishingTargetSetting | undefined, days: number) {
  if (!target || target.value === null) return null;

  const safeDays = Math.max(0, days);
  const rawTarget = target.period === "weekly" ? (target.value * safeDays) / 7 : target.value * safeDays;
  return Math.max(0, Math.round(rawTarget));
}

export function formatPublishingTargetSourceLabel(target: PublishingTargetSetting | undefined) {
  if (!target || target.value === null) return null;
  return target.period === "weekly" ? `${target.value}/week prorated` : `${target.value}/day`;
}
