import { EMAIL_TO_ADMIN } from "@/lib/constants";
import { AdminProfile } from "@/lib/types";

export function resolveAdminByEmail(email: string): AdminProfile {
  const admin = EMAIL_TO_ADMIN.get(email.toLowerCase().trim());

  if (!admin) {
    throw new Error("Unknown admin email. Use one of the configured Pragya domain admin emails.");
  }

  return admin;
}

export function getAdminEmails(): string[] {
  return [...EMAIL_TO_ADMIN.keys()];
}
