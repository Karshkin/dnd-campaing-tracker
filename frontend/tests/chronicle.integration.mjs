import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createServer } from "vite";

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key, TRACKER_TEST_SERVICE_KEY: serviceKey } = process.env;
assert.ok(url && key && serviceKey, "Set the local Supabase URL, publishable key and test service key");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Use a disposable local Supabase project");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const run = randomUUID().slice(0, 8);
const password = `Test-${run}!23`;
const cleanup = [];
let server;
let browser;

function ok({ data, error }) {
  assert.ifError(error);
  return data;
}

async function account(name, superadmin = false) {
  const username = `${name} ${run}`;
  const email = `${name}-${run}@example.com`.toLowerCase();
  const { user } = ok(await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username },
  }));
  cleanup.push(() => admin.auth.admin.deleteUser(user.id));
  if (superadmin) ok(await admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
  const login = createClient(url, key, options);
  const { session } = ok(await login.auth.signInWithPassword({ email, password }));
  return { user, email, username, session, login };
}

async function scope(account, campaignId) {
  const client = createClient(url, key, { ...options, global: { headers: { "x-campaign-id": campaignId } } });
  ok(await client.auth.setSession(account.session));
  return client;
}

async function insert(client, table, row) {
  return ok(await client.from(table).insert(row).select().single());
}

const action = (client, name, payload) => client.rpc("campaign_rework", { action: name, payload });
const movement = (client, row, request_id = randomUUID()) => action(client, "treasury", {
  request_id, movements: Array.isArray(row) ? row : [row],
});

try {
  const dm = await account("Director", true);
  const player = await account("Player");
  const spectator = await account("Spectator");
  const slug = `chronicle-${run}`;
  const campaignId = ok(await dm.login.rpc("manage_campaign", { action: "create", payload: { name: slug } }));
  const otherId = ok(await dm.login.rpc("manage_campaign", { action: "create", payload: { name: `other-${run}` } }));
  cleanup.push(() => admin.from("campaigns").delete().in("id", [campaignId, otherId]));
  const director = await scope(dm, campaignId);
  const other = await scope(dm, otherId);
  const member = await scope(player, campaignId);
  const onlooker = await scope(spectator, campaignId);
  const outside = await scope(player, otherId);
  for (const actor of [player, spectator]) {
    ok(await director.rpc("manage_campaign", { action: "invite", payload: { username: actor.username } }));
    for (const pageKey of ["tracker", "characters", "organizations"]) {
      ok(await director.rpc("manage_campaign", {
        action: "permission", payload: { userId: actor.user.id, pageKey, permission_level: "edit" },
      }));
    }
  }

  const group = ok(await member.rpc("create_inventory_group", { group_name: "Exploradores" }));
  const foreignGroup = ok(await other.rpc("create_inventory_group", { group_name: "Exploradores" }));
  const faction = await insert(director, "organizations", { name: "Círculo del faro" });
  const secondFaction = await insert(director, "organizations", { name: "Orden de la costa" });
  const character = await insert(member, "characters", { name: "Niebla" });
  const otherCharacter = await insert(onlooker, "characters", { name: "Bruma" });
  const npc = await insert(director, "allies", { name: "Vigía", alignment: "neutral" });
  const secondNpc = await insert(director, "allies", { name: "Capitana" });
  const creatures = await Promise.all(["Hidra", "Grifo"].map((name) => insert(director, "creatures", { name })));
  const map = await insert(director, "maps", { name: "Costa" });
  const mapPath = `maps/${map.id}/${randomUUID()}.png`;
  const dot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64");
  ok(await director.storage.from("campaign-files").upload(mapPath, new Blob([dot], { type: "image/png" })));
  cleanup.push(() => admin.storage.from("campaign-files").remove([mapPath]));
  ok(await director.from("maps").update({ is_active: true, file_path: mapPath }).eq("id", map.id));
  const places = await Promise.all(["Faro viejo", "Embarcadero"].map((title) => insert(director, "points_of_interest", {
    title, map_id: map.id, latitude: 10, longitude: 10,
  })));
  const foreignNpc = await insert(other, "allies", { name: "Vigía remoto", alignment: "neutral" });
  const chapter = await insert(director, "chronicle_chapters", { title: "El faro" });
  const foreignChapter = await insert(other, "chronicle_chapters", { title: "Otro faro" });
  const sessionDraft = {
    title: "Tormenta azul", played_on: "2026-11-26", chapter_id: chapter.id,
    summary: "<p>Hallamos el <strong>faro</strong>.</p>", rewards: "Tres monedas", decisions: "Navegar", consequences: "La marea sube",
    notes: "El vigía conoce la ruta", attendance: [character.id], links: [{ npc_id: npc.id }, { organization_id: faction.id }],
  };
  assert.ok((await action(member, "save_session", sessionDraft)).error);
  assert.ok((await action(director, "save_session", { ...sessionDraft, chapter_id: foreignChapter.id })).error);
  assert.ok((await action(director, "save_session", { ...sessionDraft, links: [{ npc_id: foreignNpc.id }] })).error);
  assert.ok((await action(director, "save_session", { ...sessionDraft, attendance: [character.id, character.id] })).error);
  assert.ok((await action(director, "save_session", { ...sessionDraft, links: [{ npc_id: npc.id }, { npc_id: npc.id }] })).error);
  ok(await action(director, "save_session", sessionDraft));
  const session = ok(await director.from("chronicle_sessions").select().single());
  ok(await director.from("chronicle_sessions").update({
    summary: '<p style="color: green">Hallamos el <strong>faro</strong>.</p>',
  }).eq("id", session.id));
  assert.deepEqual(ok(await member.from("chronicle_sessions").select()), []);
  assert.deepEqual(ok(await member.from("chronicle_notes").select()), []);
  assert.deepEqual(ok(await member.from("chronicle_attendance").select()), []);
  assert.equal(ok(await director.from("chronicle_notes").select().single()).notes, sessionDraft.notes);

  const reputation = { organization_id: faction.id, group_id: group };
  const score = async (client = member) => ok(await client.from("faction_reputation").select().eq("group_id", group).eq("organization_id", faction.id));
  assert.equal((await score())[0].score, 0);
  assert.deepEqual(await score(onlooker), []);
  assert.deepEqual(await score(outside), []);
  assert.ok((await action(member, "reputation", { ...reputation, delta: 5, reason: "No autorizado" })).error);
  assert.ok((await action(director, "reputation", { ...reputation, delta: 5, reason: "    " })).error);
  assert.ok((await action(director, "reputation", { ...reputation, group_id: foreignGroup, delta: 5, reason: "Otra campaña" })).error);
  ok(await action(director, "reputation", { ...reputation, delta: 2147483647, reason: "Rescate", session_id: session.id }));
  assert.equal((await score())[0].score, 100);
  assert.deepEqual(ok(await member.from("faction_reputation_history").select()), []);
  ok(await action(director, "reputation", { ...reputation, delta: -2147483648, reason: "Traición" }));
  assert.equal((await score())[0].score, -100);
  ok(await action(director, "reputation", { ...reputation, visible: false }));
  assert.deepEqual(await score(), []);
  assert.deepEqual(ok(await member.from("faction_reputation_history").select()), []);
  ok(await action(director, "reputation", { ...reputation, visible: true }));
  assert.equal(ok(await member.from("faction_reputation_history").select().single()).requested, -2147483648);

  const deposit = { group_id: group, operation: "deposit", denomination: "gp", quantity: 10 };
  assert.ok((await movement(onlooker, deposit)).error);
  assert.ok((await movement(member, { ...deposit, group_id: foreignGroup })).error);
  const retry = randomUUID();
  const duplicates = await Promise.all([movement(member, deposit, retry), movement(member, deposit, retry)]);
  duplicates.forEach(ok);
  assert.ok((await movement(member, { ...deposit, quantity: 11 }, retry)).error);
  const wallet = async (client, column, id) => ok(await client.from("treasury_wallet").select("balance").eq(column, id).eq("denomination", "gp").single()).balance;
  assert.equal(await wallet(member, "group_id", group), 10);

  const transfer = { ...deposit, operation: "to_character", character_id: character.id, quantity: 7 };
  assert.ok((await movement(member, { ...transfer, character_id: otherCharacter.id })).error);
  const parallel = await Promise.all([movement(member, transfer), movement(member, transfer)]);
  assert.equal(parallel.filter(({ error }) => !error).length, 1);
  assert.equal(await wallet(member, "group_id", group), 3);
  assert.equal(await wallet(member, "character_id", character.id), 7);
  assert.deepEqual(ok(await onlooker.from("treasury_wallet").select().eq("character_id", character.id)), []);
  ok(await movement(member, { ...transfer, operation: "to_group", quantity: 3 }));
  assert.equal(await wallet(member, "group_id", group), 6);

  const personalItem = await insert(member, "character_inventory", {
    character_id: character.id, item_name: "Amuleto", quantity: 2, description: "De coral",
  });
  const itemTransfer = { group_id: group, character_id: character.id, quantity: 2, operation: "to_group", item_id: personalItem.id };
  const itemRaces = await Promise.all([movement(member, itemTransfer), movement(member, itemTransfer)]);
  assert.equal(itemRaces.filter(({ error }) => !error).length, 1);
  const groupItem = ok(await member.from("inventory_group_contributions").select().eq("group_id", group).single());
  assert.equal(groupItem.details.description, "De coral");
  ok(await movement(member, { ...itemTransfer, operation: "to_character", item_id: groupItem.id, quantity: 1 }));
  assert.equal(ok(await member.from("character_inventory").select().eq("character_id", character.id).single()).description, "De coral");

  const quest = await insert(director, "chronicle_quests", { title: "Encontrar el faro" });
  const closure = {
    session_id: session.id, movements: [{ ...transfer, operation: "distribution", quantity: 2 }],
    reputation: [{ ...reputation, delta: 5, reason: "Misión cumplida" }],
    quests: [{ id: quest.id, status: "completed" }], npcs: [{ id: npc.id, alignment: "allied" }],
  };
  assert.ok((await action(member, "close", closure)).error);
  assert.ok((await action(director, "close", { ...closure, npcs: [{ id: foreignNpc.id, alignment: "allied" }] })).error);
  assert.equal(await wallet(member, "group_id", group), 6);
  assert.equal((await score())[0].score, -100);
  assert.equal(ok(await director.from("chronicle_quests").select().single()).status, "active");
  assert.deepEqual(ok(await member.from("chronicle_sessions").select()), []);
  (await Promise.all([action(director, "close", closure), action(director, "close", closure)])).forEach(ok);
  assert.equal(await wallet(member, "group_id", group), 4);
  assert.equal(ok(await member.from("chronicle_sessions").select().single()).status, "closed");
  assert.equal(ok(await member.from("chronicle_quests").select().single()).status, "completed");
  assert.equal(ok(await director.from("allies").select().eq("id", npc.id).single()).alignment, "allied");
  assert.equal((await score())[0].score, -95);
  assert.deepEqual(ok(await member.from("chronicle_notes").select()), []);
  assert.equal(ok(await director.from("treasury_history").select().eq("operation", "distribution").single()).author_id, dm.user.id);

  const resource = await insert(director, "resources", { name: "Suministro anterior", quantity: 4, notes: "Existente" });
  const visibility = (client, entity_kind, id, mode, recipients = []) => client.rpc("manage_visibility", {
    entity_kind, target: String(id), visibility: mode, recipients,
  });
  const secret = await insert(director, "entity_secrets", {
    kind: "organizations", entity_id: String(faction.id), label: "Sede oculta", content: "Detrás del faro",
  });
  assert.equal(ok(await member.from("entity_secrets").select("id").eq("id",secret.id)).length,0);
  assert.ok((await member.from("entity_secrets").insert({
    kind: "organizations", entity_id: String(faction.id), label: "Otro", content: "Texto",
  })).error);
  ok(await director.from("entity_secrets").update({ audience: "characters", recipients: [character.id] }).eq("id",secret.id));
  assert.equal(ok(await member.from("entity_secrets").select("content").eq("id",secret.id).single()).content,"Detrás del faro");
  assert.equal(ok(await onlooker.from("entity_secrets").select("id").eq("id",secret.id)).length,0);
  assert.equal(ok(await other.from("entity_secrets").select("id").eq("id",secret.id)).length,0);
  ok(await visibility(director, "organizations", faction.id, "hidden"));
  assert.equal(ok(await member.from("entity_secrets").select("id").eq("id",secret.id)).length,0);
  ok(await visibility(director, "organizations", faction.id, "discovered"));
  assert.ok((await visibility(member, "organizations", faction.id, "hidden")).error);
  assert.ok((await visibility(director, "allies", foreignNpc.id, "hidden")).error);
  const factionArtwork = `organizations/${faction.id}/${randomUUID()}.png`;
  ok(await director.storage.from("campaign-files").upload(factionArtwork, new Blob(["image"], { type: "image/png" })));
  cleanup.push(() => admin.storage.from("campaign-files").remove([factionArtwork]));
  ok(await director.from("organizations").update({ image_path: factionArtwork }).eq("id", faction.id));
  assert.ok(ok(await member.storage.from("campaign-files").createSignedUrl(factionArtwork, 60)).signedUrl);
  ok(await visibility(director, "organizations", faction.id, "hidden"));
  const updates = (client) => client.from("campaign_activity").select("id").eq("entity_kind", "organizations").eq("entity_id", String(faction.id));
  assert.ok(ok(await updates(director)).length > 0);
  assert.deepEqual(ok(await updates(member)), []);
  assert.deepEqual(ok(await member.from("organizations").select("id").eq("id", faction.id)), []);
  assert.deepEqual(await score(), []);
  assert.deepEqual(ok(await member.from("chronicle_links").select("id").eq("organization_id", faction.id)), []);
  assert.ok((await member.storage.from("campaign-files").createSignedUrl(factionArtwork, 60)).error);
  ok(await visibility(director, "organizations", faction.id, "individual", [character.id]));
  assert.equal(ok(await member.from("organizations").select("id").eq("id", faction.id).single()).id, faction.id);
  assert.deepEqual(ok(await onlooker.from("organizations").select("id").eq("id", faction.id)), []);
  assert.ok(ok(await member.storage.from("campaign-files").createSignedUrl(factionArtwork, 60)).signedUrl);
  assert.ok((await onlooker.storage.from("campaign-files").createSignedUrl(factionArtwork, 60)).error);
  ok(await visibility(director, "organizations", faction.id, "discovered"));
  const { toHarptosDay, fromHarptosDay } = await import("../src/harptos.js");
  const midsummer = toHarptosDay(1492, 9, 1);
  assert.equal(fromHarptosDay(midsummer + 1).label, "Shieldmeet");
  assert.equal(fromHarptosDay(toHarptosDay(1493, 9, 1) + 1).label, "Eleasis");
  assert.ok((await member.rpc("set_harptos_date", { day_number: midsummer })).error);
  ok(await director.rpc("set_harptos_date", { day_number: midsummer }));
  const advances = await Promise.all([director.rpc("set_harptos_date", { advance: 1 }), director.rpc("set_harptos_date", { advance: 1 })]);
  advances.forEach(ok);
  assert.equal(ok(await member.from("harptos_clock").select("world_day").single()).world_day, midsummer + 2);
  const travel = await insert(director, "harptos_events", { title: "Viaje por la costa", kind: "travel", duration: 3, world_day: midsummer, session_id: session.id });
  const secretEvent = await insert(director, "harptos_events", { title: "Reunión secreta", private: true, world_day: midsummer });
  assert.deepEqual(ok(await member.from("harptos_events").select("id")), [{ id: travel.id }]);
  assert.ok(ok(await director.from("harptos_events").select("id").eq("id", secretEvent.id).single()));
  assert.deepEqual(ok(await outside.from("harptos_events").select("id")), []);

  // Exercise the app's regular browser entry points with persisted data.
  server = await createServer({ server: { host: "127.0.0.1", port: 5178, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.TRACKER_TEST_CHROMIUM || undefined });
  const page = await browser.newPage({ locale: "es-ES" });
  page.on("pageerror", (error) => console.error(error));
  const base = new URL(server.config.base, "http://127.0.0.1:5178");
  base.searchParams.set("campaign", slug);
  async function openAs(actor) {
    const loginUrl = new URL(base);
    loginUrl.hash = "/chronicle";
    const anonymousRequests = [];
    const track = (request) => {
      if (request.url().includes("/rest/v1/")) anonymousRequests.push(new URL(request.url()).pathname);
    };
    page.on("request", track);
    await page.goto(loginUrl.href);
    await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Crónica de aventuras" }).count(), 0);
    assert.equal(await page.getByText(slug, { exact: true }).count(), 0);
    assert.deepEqual(anonymousRequests, []);
    page.off("request", track);
    await page.getByPlaceholder("Correo", { exact: false }).fill(actor.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.getByRole("heading", { name: "Crónica de aventuras" }).waitFor();
  }

  await openAs(dm);
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await page.getByRole("heading", { name: "Panel del director" }).waitFor();
  await page.getByRole("heading", { name: "Actividad reciente", exact: true }).waitFor();
  await page.getByRole("button", { name: "Calendario", exact: true }).click();
  await page.getByRole("heading", { name: "Viaje por la costa" }).waitFor();
  await page.getByText("Sesión real · 2026-11-26", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Crónica de aventuras", exact: true }).click();
  const sidebar = page.getByRole("navigation", { name: "Menú de campaña" });
  await page.getByRole("button", { name: "Contraer navegación" }).click();
  assert.ok(await sidebar.getByRole("button", { name: "Inventario grupal" }).isVisible());
  await page.getByRole("button", { name: "Expandir navegación" }).click();
  await page.getByRole("button", { name: "Localizaciones y mapas", exact: true }).click();
  await page.getByRole("heading", { name: "Atlas de campaña", exact: true }).waitFor();
  await page.locator(".atlas-places").getByRole("button", { name: /Faro viejo/ }).click();
  await page.getByRole("region", { name: "Faro viejo" }).waitFor();
  await page.getByRole("button", { name: "Cerrar punto del mapa" }).click();
  await page.getByRole("button", { name: "Acercar", exact: true }).click();
  await page.getByRole("button", { name: "Pantalla completa", exact: true }).click();
  await page.getByRole("button", { name: "Salir de pantalla completa", exact: true }).click();
  await page.getByRole("button", { name: /Gestionar mapas|Administrar mapas|Gestión de mapas/i }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.locator('summary[aria-label="Buscar en la campaña"]').click();
  await page.getByRole("searchbox").fill("Vigía");
  await page.getByRole("button", { name: /Vigía/ }).click();
  await page.locator(`#npc_id-${npc.id}`).waitFor();
  await page.getByRole("button", { name: "Crónica de aventuras", exact: true }).click();
  const chronicle = page.locator(".chronicle");
  await chronicle.getByText("Galería", { exact: true }).click();
  await chronicle.getByLabel("Imagen", { exact: true }).setInputFiles({
    name: "faro.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64"),
  });
  await chronicle.getByLabel("Pie de foto", { exact: true }).fill("El faro al alba");
  await chronicle.getByRole("button", { name: "Subir imagen", exact: true }).click();
  const useCover = chronicle.getByRole("button", { name: "Usar en portada", exact: true });
  await useCover.waitFor();
  const image = ok(await director.from("chronicle_images").select().single());
  cleanup.push(() => admin.storage.from("chronicle-images").remove([image.object_path]));
  const publicClient = createClient(url, key, options);
  assert.ok((await publicClient.storage.from("chronicle-images").createSignedUrl(image.object_path, 60)).error);
  await useCover.click();
  await page.waitForFunction(() => {
    const cover = document.querySelector(".chronicle-cover img");
    return cover?.complete && cover.naturalWidth > 0;
  });
  await chronicle.getByRole("button", { name: "Sesiones", exact: true }).click();
  await page.getByRole("button", { name: "Nueva sesión", exact: true }).click();
  await page.getByLabel("Título", { exact: true }).fill("Epílogo");
  await page.getByLabel("Fecha", { exact: true }).fill("2026-11-27");
  await page.getByRole("textbox", { name: "Resumen", exact: true }).fill("Al alba");
  await page.getByLabel("Notas privadas del director", { exact: true }).fill("Solo DM");
  const attendancePicker = page.getByRole("group", { name: "Asistencia" });
  await attendancePicker.getByRole("button", { name: "Seleccionar toda la asistencia" }).click();
  const organizationPicker = page.getByRole("group", { name: "Organizaciones", exact: true });
  await organizationPicker.getByRole("checkbox", { name: faction.name }).check();
  await organizationPicker.getByRole("searchbox").fill(secondFaction.name);
  await organizationPicker.getByRole("checkbox", { name: secondFaction.name }).focus();
  await page.keyboard.press("Space");
  assert.equal(await organizationPicker.getByText("2 seleccionados", { exact: true }).count(), 1);
  const otherPickers = [
    ["PNJ", [npc.name, secondNpc.name]],
    ["Criaturas", creatures.map(({ name }) => name)],
    ["Lugares", places.map(({ title }) => title)],
  ];
  for (const [name, options] of otherPickers) {
    const picker = page.getByRole("group", { name, exact: true });
    for (const option of options) await picker.getByRole("checkbox", { name: option, exact: true }).check();
  }
  await page.getByRole("button", { name: "Guardar sesión", exact: true }).click();
  await page.getByRole("heading", { name: "Epílogo", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Epílogo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Editar sesión" }).click();
  assert.equal(await attendancePicker.getByRole("checkbox", { checked: true }).count(), 2);
  assert.equal(await organizationPicker.getByRole("checkbox", { checked: true }).count(), 2);
  for (const [name] of otherPickers) {
    assert.equal(await page.getByRole("group", { name, exact: true }).getByRole("checkbox", { checked: true }).count(), 2);
  }
  await organizationPicker.getByRole("button", { name: `Quitar ${secondFaction.name}` }).click();
  await page.getByRole("button", { name: "Guardar sesión", exact: true }).click();
  await page.getByRole("button", { name: "Guardar sesión", exact: true }).waitFor({ state: "hidden" });
  const epilogue = ok(await director.from("chronicle_sessions").select("id").eq("title", "Epílogo").single());
  assert.deepEqual(ok(await director.from("chronicle_links").select("organization_id").eq("session_id", epilogue.id).not("organization_id", "is", null)),
    [{ organization_id: faction.id }]);
  await page.getByRole("button", { name: "Publicar resumen", exact: true }).click();
  await page.getByText("Al alba", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".chronicle .chronicle-panel time")?.parentElement.textContent.includes("Publicada"));
  await page.getByRole("searchbox", { name: "Buscar en la crónica" }).fill("Tormenta");
  await page.getByRole("heading", { name: "Tormenta azul", exact: true }).waitFor();
  assert.equal(await page.locator('.chronicle-panel p[style="color: green"]').count(), 0);
  await page.locator(".chronicle-panel strong").filter({ hasText: "faro" }).waitFor();
  await page.getByRole("button", { name: "Círculo del faro", exact: true }).click();
  await page.getByRole("heading", { name: "Reputación", exact: true }).waitFor();
  await page.getByLabel("Motivo", { exact: true }).fill("Ayuda en la costa");
  await page.getByRole("button", { name: "+5", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("meter")?.value === -90);
  const orgPanel = page.locator('[id^="organization_id-"]');
  for (const name of [secondFaction.name, faction.name, secondFaction.name]) {
    await page.getByRole("button", { name, exact: true }).click();
    await orgPanel.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await orgPanel.count(), 1);
    assert.equal(await orgPanel.getByRole("button", { name: "Editar ficha", exact: true }).count(), 1);
    assert.equal(await orgPanel.getByRole("button", { name: "Galería", exact: true }).count(), 1);
  }

  await browser.close();
  browser = await chromium.launch({ executablePath: process.env.TRACKER_TEST_CHROMIUM || undefined });
  const playerPage = await browser.newPage({ locale: "es-ES" });
  const loginUrl = new URL(base);
  loginUrl.hash = "/login";
  await playerPage.goto(loginUrl.href);
  await playerPage.getByPlaceholder("Correo", { exact: false }).fill(player.email);
  await playerPage.locator('input[type="password"]').fill(password);
  await playerPage.locator('button[type="submit"]').click();
  await playerPage.getByRole("heading", { name: "Atlas de campaña", exact: true }).waitFor();
  await playerPage.getByRole("button", { name: "Crónica de aventuras", exact: true }).click();
  await playerPage.getByRole("heading", { name: "Epílogo", exact: true }).waitFor();
  assert.equal(await playerPage.getByText("Solo DM", { exact: true }).count(), 0);
  assert.equal(await playerPage.getByRole("button", { name: "Nueva sesión", exact: true }).count(), 0);
  await playerPage.locator(".chronicle").getByRole("button", { name: "Galería", exact: true }).click();
  await playerPage.waitForFunction(() => document.querySelector(".chronicle-cover img")?.naturalWidth > 0);
  const legacyDiary = await insert(director, "diary_entries", { title: "Registro anterior", content: "Debe conservarse" });
  assert.equal(ok(await member.from("diary_entries").select("content").eq("id", legacyDiary.id).single()).content, "Debe conservarse");
  const draft = { title: "Bitácora privada", content: "Solo la tripulación", visibility: "private", session_id: session.id, author_character_id: character.id };
  assert.ok((await onlooker.from("diary_entries").insert(draft)).error);
  const submitted = await insert(member, "diary_entries", draft);
  assert.equal(submitted.author_character_name, "Niebla");
  assert.equal(submitted.author_account_name, player.username);
  assert.deepEqual(ok(await onlooker.from("diary_entries").select("id").eq("id", submitted.id)), []);
  assert.equal(ok(await director.from("diary_entries").select("title").eq("id", submitted.id).single()).title, draft.title);
  assert.ok((await onlooker.from("campaign_comments").insert({
    diary_id: submitted.id, body: "No debería verlo", author_character_id: otherCharacter.id,
  })).error);
  assert.deepEqual(ok(await onlooker.from("diary_entries").update({ content: "Alteración" }).eq("id", submitted.id).select("id")), []);

  await playerPage.getByRole("button", { name: "Crónica de aventuras", exact: true }).click();
  await playerPage.getByRole("button", { name: "Entradas del diario", exact: true }).click();
  const entryCard = playerPage.locator(".chronicle-panel").filter({ has: playerPage.getByRole("heading", { name: draft.title }) });
  await entryCard.getByLabel("Añadir imagen", { exact: true }).setInputFiles({
    name: "bitacora.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64"),
  });
  await entryCard.getByRole("img", { name: draft.title }).waitFor();
  const diaryPath = ok(await member.from("diary_entries").select("image_path").eq("id", submitted.id).single()).image_path;
  cleanup.push(() => admin.storage.from("campaign-files").remove([diaryPath]));
  assert.ok((await onlooker.storage.from("campaign-files").createSignedUrl(diaryPath, 60)).error);
  ok(await member.from("diary_entries").update({ visibility: "shared" }).eq("id", submitted.id));
  assert.ok(ok(await onlooker.storage.from("campaign-files").createSignedUrl(diaryPath, 60)).signedUrl);
  ok(await onlooker.from("campaign_comments").insert({
    diary_id: submitted.id, body: "Anotado", author_character_id: otherCharacter.id,
  }));
  assert.equal(ok(await member.from("campaign_comments").select("body").eq("diary_id", submitted.id).single()).body, "Anotado");
  ok(await member.from("diary_entries").update({ visibility: "private" }).eq("id", submitted.id));
  assert.deepEqual(ok(await onlooker.from("campaign_comments").select("body").eq("diary_id", submitted.id)), []);
  assert.ok((await onlooker.storage.from("campaign-files").createSignedUrl(diaryPath, 60)).error);
  ok(await member.from("diary_entries").delete().eq("id", submitted.id).select().single());
  ok(await member.storage.from("campaign-files").remove([diaryPath]));

  const questDraft = {
    title: "Recuperar el mapa", author_character_id: character.id, visibility: "private", priority: "high",
    objectives: [{ title: "Encontrar la llave", done: false }], participants: [character.id, otherCharacter.id],
    organization_ids: [faction.id, secondFaction.id], session_id: session.id,
  };
  assert.ok((await onlooker.from("chronicle_quests").insert(questDraft)).error);
  assert.ok((await member.from("chronicle_quests").insert({ ...questDraft, status: "completed" })).error);
  assert.ok((await member.from("chronicle_quests").insert({ ...questDraft, npc_ids: [foreignNpc.id] })).error);
  assert.ok((await member.from("chronicle_quests").insert({ ...questDraft, participants: [character.id, character.id] })).error);
  const proposal = await insert(member, "chronicle_quests", questDraft);
  assert.deepEqual(proposal.organization_ids, [faction.id, secondFaction.id]);
  assert.deepEqual(ok(await onlooker.from("chronicle_quests").select("id").eq("id", proposal.id)), []);
  assert.ok((await member.from("chronicle_quests").update({ rewards: "Oro" }).eq("id", proposal.id)).error);
  assert.ok((await member.from("chronicle_quests").update({ status: "failed" }).eq("id", proposal.id)).error);
  ok(await member.from("chronicle_quests").update({ proposed_status: "completed" }).eq("id", proposal.id));
  ok(await director.from("chronicle_quests").update({ status: "completed", rewards: "Oro" }).eq("id", proposal.id));
  await playerPage.reload();
  await playerPage.getByRole("button", { name: "Misiones", exact: true }).click();
  const questCard = playerPage.locator(".chronicle-panel").filter({ has: playerPage.getByRole("heading", { name: questDraft.title }) });
  await questCard.getByRole("checkbox", { name: "Encontrar la llave" }).click();
  await questCard.getByRole("checkbox", { name: "Encontrar la llave", checked: true }).waitFor();
  await playerPage.reload();
  await playerPage.getByRole("button", { name: "Misiones", exact: true }).click();
  await questCard.getByText("Recompensas: Oro", { exact: true }).waitFor();
  assert.ok(await questCard.getByRole("checkbox", { name: "Encontrar la llave" }).isChecked());

  await playerPage.setViewportSize({ width: 390, height: 844 });
  const mobileMenu = playerPage.getByRole("button", { name: "Menú de campaña" });
  assert.equal(await playerPage.getByRole("navigation", { name: "Menú de campaña" }).isVisible(), false);
  await mobileMenu.click();
  await playerPage.getByRole("button", { name: "Inventario grupal", exact: true }).click();
  await playerPage.getByRole("heading", { name: "Monedero", exact: true }).waitFor();
  assert.equal(await mobileMenu.getAttribute("aria-expanded"), "false");
  assert.equal(await playerPage.getByRole("heading", { name: "Crónica de aventuras" }).count(), 0);
  const inventory = playerPage.locator(".group-inventory");
  assert.match(await inventory.locator(".treasury-wallet").textContent(), /Oro4/);
  await inventory.getByText("Ingresos, transferencias y reparto", { exact: true }).click();
  await inventory.getByLabel("Tipo", { exact: true }).selectOption("sp");
  await inventory.getByRole("spinbutton", { name: "Cantidad", exact: true }).fill("2");
  await inventory.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await playerPage.waitForFunction(() => document.querySelector(".treasury-wallet")?.textContent.includes("Plata2"));

  const encounter = ok(await director.from("encounters").insert({ title: "Batalla de prueba", session_id: session.id, experience: 50, rewards: "Tesoro reservado" }).select("id").single());
  const step = (client, action, expected, loot = []) =>
    client.rpc("encounter_step", { target: encounter.id, action, expected, loot });
  await insert(director, "encounter_combatants", {
    encounter_id: encounter.id, name: "Guardian secreto", creature_id: null, maximum_hp: 30, hp: 30, initiative: 18, player_visible: false, notes: "reservadas",
  });
  const publicUnit = await insert(director, "encounter_combatants", {
    encounter_id: encounter.id, name: character.name, character_id: character.id, maximum_hp: 12, hp: 12, initiative: 13,
  });
  assert.deepEqual(ok(await member.rpc("visible_encounter_turns", { target: encounter.id })), []);
  assert.ok((await step(member, "start", 0)).error);
  ok(await step(director, "start", 0));
  const encounterList = ok(await member.rpc("visible_encounters"));
  assert.equal(encounterList.find(({ id }) => id === encounter.id).rewards,null);
  assert.equal(ok(await member.from("encounters").select("id").eq("id",encounter.id)).length,0);
  assert.deepEqual(ok(await outside.rpc("visible_encounters")),[]);
  const turns = ok(await member.rpc("visible_encounter_turns", { target: encounter.id }));
  assert.deepEqual(turns.map(({ id, name }) => [id,name]), [[publicUnit.id,character.name]]);
  assert.ok(!Object.hasOwn(turns[0],"hp"));
  assert.deepEqual(ok(await member.from("encounter_combatants").select()), []);
  assert.deepEqual(ok(await outside.rpc("visible_encounter_turns", { target: encounter.id })), []);
  const parallelTurns = await Promise.all([step(director,"next",1),step(director,"next",1)]);
  assert.equal(parallelTurns.filter(({ error }) => !error).length,1);
  assert.ok(ok(await member.rpc("visible_encounter_turns", { target: encounter.id }))[0].current);
  ok(await step(director,"next",2));
  assert.equal(ok(await director.from("encounters").select("round").eq("id",encounter.id).single()).round,2);
  const currentCoins = await wallet(member, "group_id", group);
  assert.ok((await step(director, "complete", 3, [deposit, { ...deposit, quantity: -1 }])).error);
  assert.equal(await wallet(member, "group_id", group), currentCoins);
  ok(await step(director, "complete", 3, [deposit]));
  assert.equal(await wallet(member, "group_id", group), currentCoins + deposit.quantity);
  assert.equal(ok(await director.from("treasury_history").select("encounter_id").eq("encounter_id",encounter.id).single()).encounter_id, encounter.id);
  assert.ok((await step(director, "complete", 3, [deposit])).error);
  assert.equal(ok(await member.rpc("visible_encounters")).find(({ id }) => id === encounter.id).rewards,"Tesoro reservado");

  const legacy = new URL(base);
  legacy.hash = "/resources";
  await playerPage.goto(legacy.href);
  await playerPage.getByText("Recursos del Grupo", { exact: true }).click();
  await playerPage.getByText(resource.name, { exact: true }).waitFor();
  assert.equal(ok(await member.from("resources").select("quantity").eq("id", resource.id).single()).quantity, 4);
  assert.equal(ok(await member.from("inventory_group_contributions").select("id").eq("name", resource.name)).length, 0);

  await playerPage.getByLabel("Añadir imagen", { exact: true }).setInputFiles({
    name: "amuleto.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64"),
  });
  await playerPage.getByRole("link", { name: "Ampliar imagen de Amuleto" }).waitFor();
  const artwork = ok(await member.from("inventory_group_contributions").select("artwork_path").eq("id", groupItem.id).single()).artwork_path;
  cleanup.push(() => admin.storage.from("inventory-artwork").remove([artwork]));
  assert.ok((await onlooker.storage.from("inventory-artwork").createSignedUrl(artwork, 60)).error);
  assert.ok((await onlooker.rpc("set_inventory_artwork", { item: groupItem.id, path: null, previous_path: artwork })).error);
  ok(await movement(member, { ...itemTransfer, operation: "to_character", item_id: groupItem.id, quantity: 1 }));
  assert.equal(ok(await member.from("character_inventory").select("artwork_path").eq("artwork_path", artwork).single()).artwork_path, artwork);
  assert.ok(ok(await member.storage.from("inventory-artwork").createSignedUrl(artwork, 60)).signedUrl);

  const manageGroup = (client, action, party, group_name = null) =>
    client.rpc("manage_inventory_group", { action, party, group_name });
  assert.ok((await manageGroup(member, "rename", group, "Sin permiso")).error);
  assert.ok((await manageGroup(director, "archive", foreignGroup)).error);
  assert.ok((await manageGroup(director, "rename", group, "   ")).error);
  ok(await manageGroup(director, "rename", group, "Exploradores del faro"));
  assert.equal(ok(await member.from("inventory_groups").select("name").eq("id", group).single()).name, "Exploradores del faro");
  const impact = ok(await manageGroup(director, "impact", group));
  assert.equal(impact.members, 1);
  assert.equal(impact.coins.gp, currentCoins + deposit.quantity);
  assert.ok(impact.history > 0);
  ok(await manageGroup(director, "archive", group));
  assert.ok((await movement(member, deposit)).error);
  assert.equal(await wallet(member, "group_id", group), currentCoins + deposit.quantity);
  assert.equal(ok(await manageGroup(director, "impact", group)).history, impact.history);

  console.log("Passed chronicle, reputation, atomic treasury, access controls and browser checks.");
} finally {
  await browser?.close();
  await server?.close();
  for (const remove of cleanup.reverse()) await remove();
}
