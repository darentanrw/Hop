import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import {
  type ReportSeverityBand,
  clampSeverityScore,
  getAdminSummaryTtlMs,
  inferSeverityBandFromScore,
  normalizeReportSeverityBand,
} from "./admin-dashboard";

type SeverityAssessment = {
  severityScore: number;
  severityBand: ReportSeverityBand;
  rationale: string;
  recommendedNextStep: string;
};

type SummaryAssessment = {
  headline: string;
  summary: string;
  recommendedFocus: string[];
};

export type ReportSeverityPromptInput = {
  reportId: string;
  category: string;
  description: string;
  createdAt: string;
  groupStatus: string | null;
  groupReportCount: number;
  reporterLabel: string;
  reportedLabel: string;
  targetsSpecificUser: boolean;
};

export type AdminSummaryPromptInput = {
  kpis: {
    users: number;
    openAvailabilities: number;
    tentativeGroups: number;
    revealedGroups: number;
    totalReports: number;
    unresolvedReports: number;
    criticalOpenReports: number;
  };
  unresolvedReportCounts: {
    total: number;
    aiPending: number;
    aiFailed: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  topUrgentReports: Array<{
    reportId: string;
    category: string;
    createdAt: string;
    severityScore: number | null;
    severityBand: string | null;
    aiStatus: string;
    groupStatus: string | null;
    descriptionExcerpt: string;
  }>;
  recentAuditEvents: Array<{
    action: string;
    createdAt: string;
  }>;
};

const DEFAULT_OPENAI_ADMIN_MODEL = "gpt-4.1-mini";

let openAiClient: OpenAI | null = null;

const severityFormat = makeParseableTextFormat<SeverityAssessment>(
  {
    type: "json_schema",
    name: "report_severity_assessment",
    strict: true,
    description: "A severity assessment for an admin report moderation queue.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["severityScore", "severityBand", "rationale", "recommendedNextStep"],
      properties: {
        severityScore: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
        severityBand: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
        rationale: {
          type: "string",
        },
        recommendedNextStep: {
          type: "string",
        },
      },
    },
  },
  (content) => normalizeSeverityAssessment(JSON.parse(content) as Record<string, unknown>),
);

const summaryFormat = makeParseableTextFormat<SummaryAssessment>(
  {
    type: "json_schema",
    name: "admin_dashboard_summary",
    strict: true,
    description: "A concise admin dashboard summary grounded in queue and audit data.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "summary", "recommendedFocus"],
      properties: {
        headline: {
          type: "string",
        },
        summary: {
          type: "string",
        },
        recommendedFocus: {
          type: "array",
          minItems: 0,
          maxItems: 4,
          items: {
            type: "string",
          },
        },
      },
    },
  },
  (content) => normalizeSummaryAssessment(JSON.parse(content) as Record<string, unknown>),
);

function cleanEnvString(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return null;
  }

  return trimmed;
}

function getOpenAiApiKey() {
  return cleanEnvString(process.env.OPENAI_API_KEY);
}

function getOpenAiClient() {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey });
  }

  return openAiClient;
}

function cleanModelName(value: string | undefined, fallback: string) {
  return cleanEnvString(value) ?? fallback;
}

function cleanString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

export function getAdminAiConfig() {
  const reportModel = cleanModelName(
    process.env.OPENAI_ADMIN_REPORT_MODEL,
    DEFAULT_OPENAI_ADMIN_MODEL,
  );

  return {
    enabled: Boolean(getOpenAiApiKey()),
    reportModel,
    summaryModel: cleanModelName(process.env.OPENAI_ADMIN_SUMMARY_MODEL, reportModel),
    summaryTtlMs: getAdminSummaryTtlMs(),
  };
}

export function normalizeSeverityAssessment(payload: Record<string, unknown>): SeverityAssessment {
  const severityScore = clampSeverityScore(payload.severityScore) ?? 50;
  const severityBand =
    normalizeReportSeverityBand(payload.severityBand) ?? inferSeverityBandFromScore(severityScore);

  return {
    severityScore,
    severityBand,
    rationale: cleanString(
      payload.rationale,
      "The report needs human review because the provided details are limited.",
    ),
    recommendedNextStep: cleanString(
      payload.recommendedNextStep,
      "Review the report details and contact the involved riders if more context is needed.",
    ),
  };
}

export function normalizeSummaryAssessment(payload: Record<string, unknown>): SummaryAssessment {
  const recommendedFocusRaw = Array.isArray(payload.recommendedFocus)
    ? payload.recommendedFocus
    : [];

  return {
    headline: cleanString(payload.headline, "Admin queue overview"),
    summary: cleanString(
      payload.summary,
      "The dashboard summary is unavailable right now. Review the live KPIs and report queue directly.",
    ),
    recommendedFocus: recommendedFocusRaw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 4),
  };
}

export async function scoreAdminReportSeverity(input: ReportSeverityPromptInput) {
  const client = getOpenAiClient();
  const { reportModel } = getAdminAiConfig();
  const response = await client.responses.parse({
    model: reportModel,
    instructions:
      "You assist with moderation triage for a campus rideshare admin dashboard. " +
      "Use only the provided JSON data. Do not invent facts. " +
      "Assess urgency and potential rider safety or financial risk conservatively. " +
      "Return JSON that matches the schema exactly.",
    input: JSON.stringify(input, null, 2),
    temperature: 0.1,
    max_output_tokens: 240,
    text: {
      format: severityFormat,
    },
    metadata: {
      feature: "admin_report_scoring",
      reportId: input.reportId,
    },
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  if (!response.output_parsed) {
    throw new Error("OpenAI did not return a structured severity assessment.");
  }

  return {
    ...response.output_parsed,
    model: reportModel,
    requestId: response.id,
  };
}

export async function generateAdminDashboardSummary(input: AdminSummaryPromptInput) {
  const client = getOpenAiClient();
  const { summaryModel } = getAdminAiConfig();
  const response = await client.responses.parse({
    model: summaryModel,
    instructions:
      "You summarize a rideshare admin dashboard for operators. " +
      "Base the response only on the supplied JSON snapshot. " +
      "Keep the tone operational, concise, and factual. " +
      "Highlight risk concentration, queue bottlenecks, and the next best focus areas. " +
      "Return JSON that matches the schema exactly.",
    input: JSON.stringify(input, null, 2),
    temperature: 0.2,
    max_output_tokens: 320,
    text: {
      format: summaryFormat,
    },
    metadata: {
      feature: "admin_dashboard_summary",
    },
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  if (!response.output_parsed) {
    throw new Error("OpenAI did not return a structured dashboard summary.");
  }

  return {
    ...response.output_parsed,
    model: summaryModel,
    requestId: response.id,
  };
}
