import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

export const supabaseServer = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
