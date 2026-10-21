import type { PgDatabase } from "./database.ts";

export type QueueDiagnostics = {
  eventType: string;
  pending: number;
  due: number;
  retrying: number;
  repeatedFailures: number;
  staleLocks: number;
  overdue: number;
  oldestPendingAgeSeconds: number;
};
export type AttachmentDiagnostics = { status: string; count: number; stalled: number };

export function diagnosticIssues(queues: readonly QueueDiagnostics[], attachments: readonly AttachmentDiagnostics[]): string[] {
  const issues: string[] = [];
  if (queues.some((q) => q.repeatedFailures > 0)) issues.push("OUTBOX_REPEATED_FAILURES");
  if (queues.some((q) => q.staleLocks > 0)) issues.push("OUTBOX_STALE_LOCKS");
  if (queues.some((q) => q.overdue > 0)) issues.push("OUTBOX_OVERDUE");
  if (attachments.some((a) => a.stalled > 0)) issues.push("ATTACHMENTS_STALLED");
  return issues;
}

// Aggregate-only, read-only operator view. No payloads, email addresses, tokens or last_error text.
export async function readOperationalDiagnostics(database: PgDatabase) {
  const [queueResult, attachmentResult] = await Promise.all([
    database.query<QueueDiagnostics>(`
      SELECT event_type AS "eventType", count(*)::int AS pending,
        count(*) FILTER (WHERE available_at <= now())::int AS due,
        count(*) FILTER (WHERE last_error IS NOT NULL)::int AS retrying,
        count(*) FILTER (WHERE attempts >= 5 AND last_error IS NOT NULL)::int AS "repeatedFailures",
        count(*) FILTER (WHERE locked_at < now() - interval '5 minutes')::int AS "staleLocks",
        count(*) FILTER (WHERE available_at < now() - interval '15 minutes'
          AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))::int AS overdue,
        greatest(0, extract(epoch FROM now() - min(occurred_at)))::int AS "oldestPendingAgeSeconds"
      FROM outbox_events WHERE processed_at IS NULL GROUP BY event_type ORDER BY event_type
    `),
    database.query<AttachmentDiagnostics>(`
      SELECT status, count(*)::int AS count,
        count(*) FILTER (WHERE
          (status = 'processing' AND uploaded_at < now() - interval '15 minutes') OR
          (status = 'cleanup_pending' AND updated_at < now() - interval '15 minutes'
            AND expires_at < now() - interval '15 minutes'))::int AS stalled
      FROM attachments WHERE status IN ('processing', 'cleanup_pending', 'rejected')
      GROUP BY status ORDER BY status
    `),
  ]);
  const queues = queueResult.rows;
  const attachments = attachmentResult.rows;
  const issues = diagnosticIssues(queues, attachments);
  return { status: issues.length ? "degraded" as const : "ok" as const,
    checkedAt: new Date().toISOString(), issues, queues, attachments };
}
