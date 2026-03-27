import { supabaseServer } from "@/lib/supabase";
import { Domain } from "@/lib/types";

function isMissingAuditTableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("public.admin_audit_logs") &&
    (normalized.includes("could not find the table") || normalized.includes("does not exist"))
  );
}

export type AuditAction =
  | "ingestion_batch_started"
  | "worker_job_created"
  | "worker_job_submitted"
  | "worker_job_approved"
  | "worker_job_rejected"
  | "file_deleted"
  | "chat_queried";

export async function createAuditLog(params: {
  email: string;
  domain: Domain;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer.from("admin_audit_logs").insert({
    actor_email: params.email,
    domain: params.domain,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId ?? null,
    details: params.details ?? {},
  });

  if (error) {
    if (isMissingAuditTableError(error.message)) {
      return;
    }

    throw new Error(`Failed to write admin audit log: ${error.message}`);
  }
}

export async function listAuditLogs(domain: Domain) {
  const { data, error } = await supabaseServer
    .from("admin_audit_logs")
    .select("id, actor_email, domain, action, resource_type, resource_id, details, created_at")
    .eq("domain", domain)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (isMissingAuditTableError(error.message)) {
      return [];
    }

    throw new Error(`Failed to read admin audit logs: ${error.message}`);
  }

  return data ?? [];
}
