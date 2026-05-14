// One-off: grant test credits to all profiles that have spent their initial
// free balance during the welcome-flow signup loop. DELETE after use.
// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

serve(async () => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  // Restore credits to 5 for every profile with credits < 5. This is the
  // "first card free" + a few extras so the user can also test send-link
  // + friend paths after their initial pen-pal attempt failed.
  const { data, error } = await admin
    .from("profiles")
    .update({ credits: 5 })
    .lt("credits", 5)
    .select("id, credits");
  return new Response(
    JSON.stringify({ ok: !error, error: error?.message, restored: data }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
