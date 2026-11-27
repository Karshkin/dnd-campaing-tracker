import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "vite";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.TRACKER_TEST_SERVICE_KEY;
assert.ok(url && key && serviceKey, "Set the local Supabase URL, anon key and test service key");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
  "Tests must run against a disposable local Supabase project");

const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: "custom" });
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const outsider = createClient(url, key, options);
const run = randomUUID().slice(0, 8);
const password = `Player-${run}!23`;
const playerEmail = `player-${run}@example.com`;
const secondEmail = `second-${run}@example.com`;
const adminEmail = `dm-${run}@example.com`;
const cleanup = [];

function ok({ data, error }) {
  assert.ifError(error);
  return data;
}

async function request(api, path, method, body) {
  const response = await api(path, { method, body });
  const result = await response.json();
  assert.ok(response.ok, `${method ?? "GET"} ${path}: ${result?.detail}`);
  return result;
}

function formFile(filename, type, data) {
  const form = new FormData();
  form.append("file", new File([data], filename, { type }));
  return form;
}

try {
  const { campaignRequest: api, supabase, readProfile } = await vite.ssrLoadModule("/src/campaign.js");
  const player = ok(await supabase.auth.signUp({
    email: playerEmail, password,
    options: { data: { username: `Player ${run}`, is_admin: true } },
  })).user;
  cleanup.push(() => admin.auth.admin.deleteUser(player.id));
  ok(await supabase.auth.signOut());
  ok(await supabase.auth.signInWithPassword({ email: playerEmail, password }));
  assert.equal(ok(await supabase.auth.getSession()).session.user.id, player.id);

  const dm = ok(await admin.auth.admin.createUser({
    email: adminEmail, password, email_confirm: true, user_metadata: { username: `DM ${run}` },
  })).user;
  cleanup.push(() => admin.auth.admin.deleteUser(dm.id));
  ok(await admin.from("profiles").update({ is_admin: true }).eq("id", dm.id));
  const dmClient = createClient(url, key, options);
  ok(await dmClient.auth.signInWithPassword({ email: adminEmail, password }));

  const profile = await readProfile(player.id);
  assert.equal(profile.username, `Player ${run}`);
  assert.equal(profile.is_admin, false);
  assert.equal(profile.permissions.find(({ page_key }) => page_key === "admin").permission_level, "none");
  assert.ok((await supabase.from("profiles").update({ is_admin: true }).eq("id", player.id)).error);
  assert.deepEqual(ok(await supabase.from("page_permissions").update({ permission_level: "admin" })
    .eq("user_id", player.id).select()), []);
  assert.equal((await api("/users", { method: "POST", body: { email: secondEmail, password, username: "Unauthorized" } })).ok, false);

  const dmCreate = ok(await dmClient.functions.invoke("manage-users", {
    body: { action: "create", email: secondEmail, password, username: `Second ${run}` },
  }));
  assert.equal(dmCreate.detail, "Account created");
  const second = createClient(url, key, options);
  const secondUser = ok(await second.auth.signInWithPassword({ email: secondEmail, password })).user;
  cleanup.push(() => admin.auth.admin.deleteUser(secondUser.id));
  const newPassword = `Changed-${run}!23`;
  ok(await dmClient.functions.invoke("manage-users", {
    body: { action: "reset", userId: secondUser.id, password: newPassword },
  }));
  assert.ok((await second.auth.signInWithPassword({ email: secondEmail, password })).error);
  ok(await second.auth.signInWithPassword({ email: secondEmail, password: newPassword }));

  const permissions = await dmClient.from("page_permissions").update({ permission_level: "edit" })
    .eq("user_id", player.id).eq("page_key", "tracker").select().single();
  ok(permissions);
  assert.deepEqual(ok(await dmClient.from("page_permissions").update({ permission_level: "none" })
    .eq("user_id", dm.id).eq("page_key", "admin").select()), []);

  const name = `Torch ${run}`;
  const resource = await request(api, "/resources", "POST", { name, quantity: 1 });
  cleanup.push(() => admin.from("resources").delete().eq("id", resource.id));
  await request(api, `/resources/${resource.id}`, "PUT", { name, quantity: 2 });
  assert.equal((await request(api, "/resources")).find(({ id }) => id === resource.id).quantity, 2);
  assert.deepEqual(ok(await second.from("resources").delete().eq("id", resource.id).select()), []);
  assert.ok((await outsider.from("resources").select()).error);

  const character = await request(api, "/characters", "POST", { name: `Adventurer ${run}` });
  assert.equal(character.emoji, "");
  const profilePath = `/characters/${character.id}`;
  await request(api, profilePath, "PUT", { emoji: "🐉", background: "From the mountains", equipment: "Longbow" });
  const expanded = (await request(api, "/characters")).find((row) => row.id === character.id);
  assert.equal(expanded.emoji, "🐉");
  assert.equal(expanded.background, "From the mountains");
  assert.equal(expanded.equipment, "Longbow");
  const companion = ok(await second.rpc("list_character_companions").eq("id", character.id).single());
  assert.equal(companion.name, character.name);
  assert.equal(companion.emoji, "🐉");
  assert.equal(companion.owner_name, `Player ${run}`);
  assert.equal(companion.equipment, undefined);
  assert.ok((await outsider.rpc("list_character_companions")).error);
  const privacyDraft = { emoji: "🐉", equipment: "Longbow", background: "Secret origin", private_fields: ["background"] };
  await request(api, profilePath, "PUT", privacyDraft);
  const ownPrivate = (await request(api, "/characters")).find((row) => row.id === character.id);
  assert.equal(ownPrivate.background, "Secret origin");
  assert.deepEqual(ownPrivate.private_fields, ["background"]);
  const shared = ok(await second.rpc("list_shared_character_sheets")
    .eq("id", character.id).single());
  assert.equal(shared.background, "");
  assert.equal(shared.equipment, "Longbow");
  assert.deepEqual(ok(await dmClient.from("character_private_fields").select().eq("character_id", character.id)), []);
  assert.equal(ok(await dmClient.from("characters").select("background")
    .eq("id", character.id).single()).background, "");
  await request(api, profilePath, "PUT", { ...privacyDraft, private_fields: [] });
  assert.equal(ok(await second.rpc("list_shared_character_sheets")
    .eq("id", character.id).single()).background, "Secret origin");

  const galleryPath = `${profilePath}/gallery`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");
  const image = await request(api, galleryPath, "POST", new File([png], "portrait.png", { type: "image/png" }));
  const galleryRow = ok(await supabase.from("character_gallery").select("object_path").eq("id", image.id).single());
  cleanup.push(() => admin.storage.from("character-gallery").remove([galleryRow.object_path]));
  const gallery = await request(api, galleryPath);
  assert.equal(gallery.length, 1);
  assert.equal((await fetch(gallery[0].url)).status, 200);
  assert.deepEqual(ok(await second.from("character_gallery").select().eq("id", image.id)), []);
  assert.ok((await second.storage.from("character-gallery").createSignedUrl(galleryRow.object_path, 60)).error);
  assert.equal(ok(await dmClient.from("character_gallery").select("id").eq("id", image.id).single()).id, image.id);
  const dmImage = ok(await dmClient.storage.from("character-gallery").createSignedUrl(galleryRow.object_path, 60));
  assert.equal((await fetch(dmImage.signedUrl)).status, 200);
  assert.deepEqual(ok(await dmClient.from("character_gallery").delete().eq("id", image.id).select()), []);
  await request(api, `${galleryPath}/${image.id}`, "DELETE");
  assert.deepEqual(await request(api, galleryPath), []);
  assert.ok((await admin.storage.from("character-gallery").download(galleryRow.object_path)).error);

  const itemPath = `/characters/${character.id}/inventory`;
  const diaryPath = `/characters/${character.id}/diary`;
  const item = await request(api, itemPath, "POST", { item_name: "Rope" });
  await request(api, diaryPath, "POST", { title: "Session 1", content: "Found a cave" });
  assert.equal((await request(api, itemPath))[0].id, item.id);
  assert.equal((await request(api, diaryPath))[0].content, "Found a cave");
  const visibleCharacter = ok(await dmClient.from("characters").select("id,owner:profiles(username)")
    .eq("id", character.id).single());
  assert.equal(visibleCharacter.owner.username, `Player ${run}`);
  assert.equal(ok(await dmClient.from("character_diary").select("content")
    .eq("character_id", character.id).single()).content, "Found a cave");
  assert.deepEqual(ok(await dmClient.from("characters").update({ name: "Unauthorized" })
    .eq("id", character.id).select()), []);
  assert.ok((await dmClient.from("character_diary").insert({
    character_id: character.id, title: "Unauthorized", content: "Unauthorized",
  })).error);
  assert.deepEqual(ok(await dmClient.from("character_inventory").select().eq("id", item.id)), []);
  assert.deepEqual(ok(await second.from("characters").select().eq("id", character.id)), []);
  assert.deepEqual(ok(await second.from("character_diary").select().eq("character_id", character.id)), []);
  assert.deepEqual(ok(await second.from("character_inventory").select().eq("id", item.id)), []);
  assert.ok((await second.from("character_inventory").insert({ item_name: "Unauthorized", character_id: character.id })).error);
  assert.ok((await supabase.from("characters").update({ user_id: secondUser.id }).eq("id", character.id)).error);

  // The same browser-facing service used by App uploads, signs and removes these files.
  const sheet = formFile("sheet.pdf", "application/pdf", "%PDF-1.4\nCampaign integration test");
  await request(api, `/characters/${character.id}/upload-sheet`, "POST", sheet);
  const row = ok(await supabase.from("characters").select("sheet_file_path").eq("id", character.id).single());
  cleanup.push(() => admin.storage.from("campaign-files").remove([row.sheet_file_path]));
  const signed = (await request(api, "/characters")).find(({ id }) => id === character.id).sheet_file_path;
  const download = await fetch(signed);
  assert.equal(download.status, 200);
  assert.match(await download.text(), /^%PDF-1\.4/);
  assert.ok((await second.storage.from("campaign-files").createSignedUrl(row.sheet_file_path, 60)).error);
  assert.ok((await outsider.storage.from("campaign-files").createSignedUrl(row.sheet_file_path, 60)).error);
  await supabase.storage.from("campaign-files").remove([row.sheet_file_path]);
  assert.ok(ok(await supabase.storage.from("campaign-files").download(row.sheet_file_path)).size);

  await request(api, `/inventory/${item.id}`, "DELETE");
  assert.deepEqual(await request(api, itemPath), []);
  await request(api, `/characters/${character.id}`, "DELETE");
  assert.ok((await admin.storage.from("campaign-files").download(row.sheet_file_path)).error);
  assert.deepEqual(ok(await supabase.from("character_diary").select().eq("character_id", character.id)), []);
  await request(api, `/resources/${resource.id}`, "DELETE");
  assert.equal((await request(api, "/resources")).find(({ id }) => id === resource.id), undefined);
  ok(await supabase.auth.signOut());
  assert.equal(ok(await supabase.auth.getSession()).session, null);

  console.log("Passed local Auth, account administration, RLS, CRUD and private Storage checks.");
} finally {
  for (const remove of cleanup.reverse()) await remove();
  await vite.close();
}
