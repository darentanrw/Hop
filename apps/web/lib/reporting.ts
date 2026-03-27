// Reports feed admin review without changing the ride lifecycle state.
export function buildGroupPatchForNewReport(currentReportCount?: number | null) {
  return {
    reportCount: (currentReportCount ?? 0) + 1,
  };
}
