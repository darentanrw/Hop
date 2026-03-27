import { afterEach, describe, expect, test } from "vitest";
import {
  getAdminAiConfig,
  normalizeSeverityAssessment,
  normalizeSummaryAssessment,
} from "../../lib/admin-ai";

describe("admin ai helpers", () => {
  afterEach(() => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.OPENAI_ADMIN_REPORT_MODEL = undefined;
    process.env.OPENAI_ADMIN_SUMMARY_MODEL = undefined;
    process.env.OPENAI_ADMIN_SUMMARY_TTL_MINUTES = undefined;
  });

  test("normalizes severity output with clamping and sensible fallbacks", () => {
    expect(
      normalizeSeverityAssessment({
        severityScore: 140,
        severityBand: "unknown",
        rationale: "  Escalated risk due to repeated unsafe behaviour.  ",
        recommendedNextStep: "",
      }),
    ).toEqual({
      severityScore: 100,
      severityBand: "critical",
      rationale: "Escalated risk due to repeated unsafe behaviour.",
      recommendedNextStep:
        "Review the report details and contact the involved riders if more context is needed.",
    });
  });

  test("normalizes dashboard summaries and removes empty focus items", () => {
    expect(
      normalizeSummaryAssessment({
        headline: "  Queue pressure rising  ",
        summary: "  Two unresolved payment and safety reports need attention.  ",
        recommendedFocus: ["Review high-risk reports", "  ", 42, "Clear failed AI scores"],
      }),
    ).toEqual({
      headline: "Queue pressure rising",
      summary: "Two unresolved payment and safety reports need attention.",
      recommendedFocus: ["Review high-risk reports", "Clear failed AI scores"],
    });
  });

  test("reads admin ai config from env with defaults", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_ADMIN_REPORT_MODEL = "gpt-4.1";
    process.env.OPENAI_ADMIN_SUMMARY_TTL_MINUTES = "30";

    expect(getAdminAiConfig()).toEqual({
      enabled: true,
      reportModel: "gpt-4.1",
      summaryModel: "gpt-4.1",
      summaryTtlMs: 30 * 60_000,
    });
  });
});
