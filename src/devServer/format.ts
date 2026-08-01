import type { z } from "zod";

// Field-by-field diff for a failed `POST /events` validation. Deliberately
// walks `.error.issues` rather than doing `String(result.error)` (a raw
// `ZodError` dump is a wall of nested JSON that buries the actually-useful
// path/message pairs) -- one line per issue, so a human scanning the dev
// server's stdout can immediately see which field broke and why.
export function formatValidationDiff(event: string, issues: z.ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `    ${path}: ${issue.message}`;
  });

  return [`✗ ${event} failed validation:`, ...lines].join("\n");
}

// Single-line acknowledgement for an accepted event (valid or schema-less).
// Intentionally a single line with no per-field breakdown, so it's visibly
// shorter/different in shape from `formatValidationDiff`'s multi-line output.
export function formatSuccessLine(event: string): string {
  return `✓ ${event} accepted`;
}
