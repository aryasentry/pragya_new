import { AdminProfile } from "@/lib/types";

export const APP_NAME = "Pragya";

export const ADMIN_PROFILES: AdminProfile[] = [
  {
    email: "citizen_admin@pragya.local",
    role: "citizen_admin",
    domain: "citizen_law",
    displayName: "Citizen Domain Admin",
  },
  {
    email: "hr_admin@pragya.local",
    role: "hr_admin",
    domain: "hr_law",
    displayName: "HR Domain Admin",
  },
  {
    email: "company_admin@pragya.local",
    role: "company_admin",
    domain: "company_law",
    displayName: "Company Domain Admin",
  },
];

export const EMAIL_TO_ADMIN = new Map(
  ADMIN_PROFILES.map((profile) => [profile.email.toLowerCase(), profile]),
);
