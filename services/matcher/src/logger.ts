import type { Request } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  service: "matcher";
  event: string;
} & Record<string, unknown>;

type LoggerOptions = {
  level?: LogLevel;
  sink?: (entry: LogEntry) => void;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: string | undefined): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function resolveLogLevel(level: LogLevel | undefined) {
  if (level) return level;

  const envLevel = process.env.MATCHER_LOG_LEVEL?.trim().toLowerCase();
  return isLogLevel(envLevel) ? envLevel : "info";
}

function serializeError(error: Error) {
  return {
    name: error.name,
    message: error.message,
  };
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]),
    );
  }

  return value;
}

function writeToConsole(entry: LogEntry) {
  const line = JSON.stringify(entry);

  switch (entry.level) {
    case "debug":
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export function createLogger(options: LoggerOptions = {}) {
  const minimumLevel = resolveLogLevel(options.level);
  const sink = options.sink ?? writeToConsole;

  function log(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minimumLevel]) {
      return;
    }

    const sanitizedContext = sanitizeValue(context);

    sink({
      timestamp: new Date().toISOString(),
      level,
      service: "matcher",
      event,
      ...(sanitizedContext &&
      typeof sanitizedContext === "object" &&
      !Array.isArray(sanitizedContext)
        ? sanitizedContext
        : { context: sanitizedContext }),
    });
  }

  return {
    debug(event: string, context?: Record<string, unknown>) {
      log("debug", event, context);
    },
    info(event: string, context?: Record<string, unknown>) {
      log("info", event, context);
    },
    warn(event: string, context?: Record<string, unknown>) {
      log("warn", event, context);
    },
    error(event: string, context?: Record<string, unknown>) {
      log("error", event, context);
    },
  };
}

export type MatcherLogger = ReturnType<typeof createLogger>;

export function getRequestLogContext(request: Request) {
  return {
    requestId: request.requestId,
    operation: request.path.replace(/^\/+/, "").replaceAll("/", ".") || "root",
  };
}

export function summarizeRequestBody(request: Request) {
  switch (request.path) {
    case "/matcher/submit-destination": {
      const address = typeof request.body?.address === "string" ? request.body.address.trim() : "";
      return {
        hasAddress: address.length > 0,
        addressLength: address.length,
      };
    }
    case "/matcher/compatibility": {
      const routeDescriptorRefs = Array.isArray(request.body?.routeDescriptorRefs)
        ? request.body.routeDescriptorRefs
        : [];

      return {
        routeDescriptorRefCount: routeDescriptorRefs.length,
      };
    }
    case "/matcher/reveal-envelopes": {
      const members = Array.isArray(request.body?.members) ? request.body.members : [];

      return {
        memberCount: members.length,
      };
    }
    default:
      return undefined;
  }
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
