export const CHANNEL_PULSE_SESSION_COOKIE = "channel_pulse_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type AccountRole = "admin" | "user";

export type ChannelPulseAccount = {
  username: string;
  password: string;
  role: AccountRole;
  channelIds: string[] | null;
};

export type ChannelAccess = {
  channelIds: string[] | null;
};

type AuthCookieOptions = {
  httpOnly: boolean;
  path: string;
  sameSite: "lax";
  secure: boolean;
};

type RawConfiguredAccount = {
  username?: unknown;
  password?: unknown;
  role?: unknown;
  channels?: unknown;
  channelIds?: unknown;
};

export function getDashboardUser() {
  return process.env.DASHBOARD_BASIC_USER ?? "management";
}

export function getDashboardPassword() {
  return process.env.DASHBOARD_BASIC_PASSWORD ?? "";
}

export function getAccounts() {
  const accounts: ChannelPulseAccount[] = [];
  const adminPassword = getDashboardPassword();

  if (adminPassword) {
    accounts.push({
      username: getDashboardUser(),
      password: adminPassword,
      role: "admin",
      channelIds: null
    });
  }

  for (const account of getConfiguredAccounts()) {
    if (!accounts.some((candidate) => candidate.username === account.username)) {
      accounts.push(account);
    }
  }

  return accounts;
}

export function getLoginDefaultUsername() {
  return getAccounts()[0]?.username ?? getDashboardUser();
}

export function isAuthConfigured() {
  return getAccounts().length > 0 && getSessionSecret().length > 0;
}

export function authenticateAccount(username: string, password: string) {
  return getAccounts().find((account) => account.username === username && account.password === password) ?? null;
}

export function getAccountByUsername(username: string) {
  return getAccounts().find((account) => account.username === username) ?? null;
}

export function canAccountViewRevenue(account: ChannelPulseAccount) {
  return account.role === "admin";
}

export function getAccountChannelAccess(account: ChannelPulseAccount): ChannelAccess {
  return { channelIds: account.channelIds };
}

export function isChannelAllowedForAccount(account: ChannelPulseAccount, channelId: string) {
  return account.channelIds === null || account.channelIds.includes(channelId);
}

export function getAuthCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  };
}

export function sanitizeNextPath(value: unknown) {
  const path = typeof value === "string" ? value : "";

  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/";
  }

  if (path.startsWith("/login") || path.startsWith("/api/auth")) {
    return "/";
  }

  return path;
}

export async function createSessionToken(username: string) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const encodedUser = encodeURIComponent(username);
  const payload = `${encodedUser}.${expiresAt}`;
  const signature = await signPayload(payload);

  return `${payload}.${signature}`;
}

export async function isSessionTokenValid(token: string | undefined) {
  return Boolean(await getSessionAccount(token));
}

export async function getSessionAccount(token: string | undefined) {
  if (!token) return null;

  const [encodedUser, expiresAtValue, signature, ...extra] = token.split(".");
  if (!encodedUser || !expiresAtValue || !signature || extra.length > 0) {
    return null;
  }

  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  let username = "";
  try {
    username = decodeURIComponent(encodedUser);
  } catch {
    return null;
  }

  const account = getAccountByUsername(username);
  if (!account) {
    return null;
  }

  const expectedSignature = await signPayload(`${encodedUser}.${expiresAtValue}`);
  return timingSafeEqual(signature, expectedSignature) ? account : null;
}

function getConfiguredAccounts() {
  const rawAccounts = parseConfiguredAccounts();
  const accounts: ChannelPulseAccount[] = [];

  for (const rawAccount of rawAccounts) {
    const username = typeof rawAccount.username === "string" ? rawAccount.username.trim() : "";
    const password = typeof rawAccount.password === "string" ? rawAccount.password : "";
    const role: AccountRole = rawAccount.role === "admin" ? "admin" : "user";

    if (!username || !password) {
      continue;
    }

    accounts.push({
      username,
      password,
      role,
      channelIds: normalizeChannelIds(rawAccount.channelIds ?? rawAccount.channels, role)
    });
  }

  return accounts;
}

function parseConfiguredAccounts(): RawConfiguredAccount[] {
  const value = process.env.CHANNEL_PULSE_ACCOUNTS;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as RawConfiguredAccount[]) : [];
  } catch (error) {
    console.warn("CHANNEL_PULSE_ACCOUNTS must be a valid JSON array.", error);
    return [];
  }
}

function normalizeChannelIds(value: unknown, role: AccountRole) {
  if (value === "all" || (value === undefined && role === "admin")) {
    return null;
  }

  const ids =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.map((item) => (typeof item === "string" ? item : ""))
        : [];

  const uniqueIds = Array.from(new Set(ids.map((item) => item.trim()).filter(Boolean)));
  return uniqueIds;
}

function getSessionSecret() {
  const configuredSecret = process.env.CHANNEL_PULSE_SESSION_SECRET;
  if (configuredSecret) return configuredSecret;
  if (getDashboardPassword()) return getDashboardPassword();
  return getConfiguredAccounts()[0]?.password ?? "";
}

async function signPayload(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
