import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccountManageDashboard,
  canAccountViewRevenue,
  getAccounts,
  type ChannelPulseAccount
} from "../lib/auth.ts";

test("restricted admins can manage the dashboard without revenue access", () => {
  const account: ChannelPulseAccount = {
    username: "restricted-admin",
    password: "secret",
    role: "admin_no_revenue",
    channelIds: null
  };

  assert.equal(canAccountManageDashboard(account), true);
  assert.equal(canAccountViewRevenue(account), false);
});

test("dedicated restricted admin environment variables create an all-channel account", () => {
  const previousUser = process.env.DASHBOARD_RESTRICTED_ADMIN_USER;
  const previousPassword = process.env.DASHBOARD_RESTRICTED_ADMIN_PASSWORD;

  process.env.DASHBOARD_RESTRICTED_ADMIN_USER = "operations-admin";
  process.env.DASHBOARD_RESTRICTED_ADMIN_PASSWORD = "strong-password";

  try {
    const account = getAccounts().find((candidate) => candidate.username === "operations-admin");

    assert.deepEqual(account, {
      username: "operations-admin",
      password: "strong-password",
      role: "admin_no_revenue",
      channelIds: null
    });
  } finally {
    restoreEnvironmentValue("DASHBOARD_RESTRICTED_ADMIN_USER", previousUser);
    restoreEnvironmentValue("DASHBOARD_RESTRICTED_ADMIN_PASSWORD", previousPassword);
  }
});

function restoreEnvironmentValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
