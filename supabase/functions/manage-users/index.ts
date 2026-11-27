// Campaign administrators manage memberships. Passwords belong to the shared Auth account.
Deno.serve((request) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({ detail: "Manage users from their campaign membership settings." }),
    { status: 410, headers });
});
