import { describe, expect, test } from "vitest";
import { resolveAdminRedirect } from "../../lib/admin-guard";

describe("admin guard", () => {
  test("redirects unauthenticated users to login", () => {
    expect(resolveAdminRedirect({ hasToken: false, isAdmin: false })).toBe("/login");
  });

  test("redirects authenticated non-admin users to dashboard", () => {
    expect(resolveAdminRedirect({ hasToken: true, isAdmin: false })).toBe("/dashboard");
  });

  test("allows authenticated admins through", () => {
    expect(resolveAdminRedirect({ hasToken: true, isAdmin: true })).toBeNull();
  });
});
