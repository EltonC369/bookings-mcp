import { createHash, randomBytes } from "node:crypto";

/**
 * Approval gate for write tools.
 *
 * Design goals (why this is safe against model persuasion):
 *
 * 1. The check lives in HOST CODE, not in the prompt. A write tool cannot
 *    execute unless it receives a valid approval object as an argument.
 * 2. The approval is BOUND TO THE EXACT ACTION: a SHA-256 hash of the tool
 *    name plus the canonicalized (sorted-keys) JSON of the action arguments.
 *    Changing a single argument after approval invalidates the token.
 * 3. Tokens are SINGLE-USE: consuming one for an execution removes it, so a
 *    replayed or double-submitted approval can never double-apply.
 * 4. Expiry: approvals expire after 10 minutes by default.
 *
 * In production, tokens are minted by a human-in-the-loop surface (dashboard,
 * Slack button, mobile tap). Here, `requestApproval` plays that role for the
 * demo — but note it only ever MINTS approvals; it can never execute writes.
 */

export interface PendingApproval {
  token: string;
  tool: string;
  argsHash: string;
  approvedBy: string;
  expiresAt: number;
}

export interface ApprovalPayload {
  token: string;
  approvedBy: string;
}

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => k !== "approval") // the approval object itself is never part of the bound action
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export function actionHash(tool: string, args: unknown): string {
  return createHash("sha256").update(`${tool}:${canonicalize(args)}`).digest("hex");
}

export class ApprovalStore {
  private pending = new Map<string, PendingApproval>();

  request(tool: string, args: unknown, approvedBy: string): PendingApproval {
    const token = randomBytes(24).toString("hex");
    const approval: PendingApproval = {
      token,
      tool,
      argsHash: actionHash(tool, args),
      approvedBy,
      expiresAt: Date.now() + APPROVAL_TTL_MS,
    };
    this.pending.set(token, approval);
    return approval;
  }

  /**
   * Validate + consume an approval for a concrete write call.
   * Returns null (with reason logged by caller) on any mismatch.
   */
  consume(tool: string, args: unknown, approval: ApprovalPayload): { ok: true } | { ok: false; reason: string } {
    const record = this.pending.get(approval.token);
    if (!record) return { ok: false, reason: "Unknown approval token" };
    this.pending.delete(approval.token); // single-use, even on failure: no retry probing

    if (record.expiresAt < Date.now()) {
      return { ok: false, reason: "Approval expired — request a new one" };
    }
    if (record.tool !== tool) {
      return { ok: false, reason: `Approval was issued for tool '${record.tool}', not '${tool}'` };
    }
    const currentHash = actionHash(tool, args);
    if (currentHash !== record.argsHash) {
      return { ok: false, reason: "Arguments changed after approval — the token is bound to the original action" };
    }
    return { ok: true };
  }

  /** Test/inspection helper. */
  size(): number {
    return this.pending.size;
  }
}
