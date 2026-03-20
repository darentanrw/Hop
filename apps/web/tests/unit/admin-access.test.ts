import { describe, expect, test } from "vitest";
import { isEmailAllowlisted, normalizeAdminEmails } from "../../lib/admin-access";

describe("admin allowlist helpers", () => {
  test("normalizes comma-separated admin emails", () => {
    expect(normalizeAdminEmails(" Admin@NUS.EDU ,admin@nus.edu, second@u.nus.edu ,, ")).toEqual([
      "admin@nus.edu",
      "second@u.nus.edu",
    ]);
  });

  test("matches allowlisted emails case-insensitively", () => {
    const allowlist = normalizeAdminEmails("ops@u.nus.edu,team@nus.edu.sg");

    expect(isEmailAllowlisted("OPS@u.nus.edu", allowlist)).toBe(true);
    expect(isEmailAllowlisted("other@u.nus.edu", allowlist)).toBe(false);
  });
});
