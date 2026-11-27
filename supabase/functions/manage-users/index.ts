import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return respond(405, "Method not allowed");

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond(401, "Authentication required");

  const url = Deno.env.get("SUPABASE_URL")!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await caller.auth.getUser(authorization.slice(7));
  if (error || !user) return respond(401, "Invalid session");

  const { data: profile } = await caller.from("profiles")
    .select("is_admin, permissions:page_permissions(page_key,permission_level)")
    .eq("id", user.id).single();
  const allowed = profile?.is_admin || profile?.permissions.some(
    (permission) => permission.page_key === "admin" && permission.permission_level === "admin",
  );
  if (!allowed) return respond(403, "Administrator access required");

  const body = await request.json().catch(() => null);
  if (typeof body?.password !== "string" || body.password.length < 8 ||
      new TextEncoder().encode(body.password).length > 72) {
    return respond(400, "Password must have at least 8 characters and at most 72 bytes");
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options).auth.admin;
  if (body.action === "create") {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (username.length < 3 || username.length > 50 || !email) {
      return respond(400, "A valid email and a display name of 3 to 50 characters are required");
    }
    // The administrator provisions the account and delivers its initial credentials.
    const { error: createError } = await admin.createUser({
      email, password: body.password, email_confirm: true, user_metadata: { username },
    });
    return createError
      ? respond(400, "Could not create the account. Check whether the email or display name is already used.")
      : respond(201, "Account created");
  }

  if (body.action === "reset" && typeof body.userId === "string") {
    const { data: target } = await caller.from("profiles").select("is_admin").eq("id", body.userId).single();
    if (!target) return respond(404, "Account not found");
    // A section administrator must not be able to take over a global administrator account.
    if (target.is_admin && !profile?.is_admin) return respond(403, "Global administrator access required");
    const { error: updateError } = await admin.updateUserById(body.userId, { password: body.password });
    return updateError ? respond(400, "Could not update the password") : respond(200, "Password updated");
  }

  return respond(400, "Unknown operation");
});
