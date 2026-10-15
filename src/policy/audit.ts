/**
 * Structured audit trail for every tool call.
 * Each entry records who called what, with which arguments, and the outcome.
 * In production, write this to an append-only sink (file, DB table, SIEM).
 */
export interface AuditEntry {
  ts: string;
  tool: string;
  kind: "read" | "write" | "approval";
  ok: boolean;
  argsPreview: string;
  detail?: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, "ts">): AuditEntry {
    const full: AuditEntry = { ts: new Date().toISOString(), ...entry };
    this.entries.push(full);
    // Structured stdout keeps stdio transport clean (JSON lines go to stderr-safe console).
    console.error(`[audit] ${JSON.stringify(full)}`);
    return full;
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }

  byKind(kind: AuditEntry["kind"]): AuditEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }
}
