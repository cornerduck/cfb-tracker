import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: "Required Supabase Edge Function configuration is missing" }, 500);
  }
  if (!token) return response({ error: "Sign-in is required to delete this account" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return response({ error: "The signed-in user could not be verified" }, 401);

  const { error: deletionError } = await supabase.auth.admin.deleteUser(data.user.id);
  if (deletionError) {
    console.error("Account deletion failed:", deletionError.message);
    return response({ error: "The account could not be deleted. Please try again." }, 500);
  }
  return response({ status: "success" });
});
