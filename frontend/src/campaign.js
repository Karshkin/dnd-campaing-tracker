import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export let selectedCampaignRef = new URLSearchParams(globalThis.location?.search).get("campaign");
export function campaignLink(slug, view = "") {
  const link = new URL(import.meta.env.BASE_URL, window.location.origin);
  if (slug) link.searchParams.set("campaign", slug);
  link.hash = view;
  return link;
}

export function replaceCampaignRef(slug) {
  const link = new URL(window.location.href);
  link.searchParams.set("campaign", slug);
  window.history.replaceState(window.history.state, "", link);
  selectedCampaignRef = slug;
}

export const supabase = url && key ? createClient(url, key, {
  global: {
    fetch(input, options) {
      const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (!selectedCampaignRef || !requestUrl.startsWith(`${url.replace(/\/$/, "")}/rest/v1/`)) {
        return fetch(input, options);
      }
      const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-campaign-id", encodeURIComponent(selectedCampaignRef));
      return fetch(input, { ...options, headers });
    },
  },
}) : null;

const collections = {
  maps: ["maps", "created_at", false],
  events: ["map_events", "created_at", false],
  pois: ["points_of_interest", "id", true],
  resources: ["resources", "name", true],
  diary: ["diary_entries", "created_at", false],
  characters: ["characters", "id", true],
  inventory: ["character_inventory", "id", true],
  characterDiary: ["character_diary", "created_at", false],
  creatures: ["creatures", "name", true],
  allies: ["allies", "name", true],
  organizations: ["organizations", "name", true],
};

const mediaFields = ["image_path", "sheet_file_path", "file_path"];
const extensions = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

async function value(result) {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}

function bucket() {
  return supabase.storage.from("campaign-files");
}

async function signMedia(rows) {
  const paths = [...new Set(rows.flatMap((row) => mediaFields.map((field) => row[field]).filter(Boolean)))];
  if (!paths.length) return rows;
  const urls = new Map();
  // Keep the Storage request bounded while signing a page of database rows.
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    const signed = await value(bucket().createSignedUrls(batch, batch.some((path) => path.startsWith("diary_entries/")) ? 60 : 900));
    for (const entry of signed) urls.set(entry.path, entry.signedUrl);
  }
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(mediaFields.filter((field) => row[field]).map((field) => [field, urls.get(row[field]) || null])),
  }));
}

function campaignAction(action, payload = {}) {
  return value(supabase.rpc("manage_campaign", { action, payload }));
}

export function readProfile() {
  return campaignAction("self");
}

export const campaignSettings = {
  list() {
    return campaignAction("directory");
  },
  async create(name) {
    const id = await campaignAction("create", { name });
    const { slug } = await value(supabase.from("campaigns").select("slug").eq("id", id).single());
    return slug;
  },
  setDirector(userId, director) {
    return campaignAction("director", { userId, director });
  },
  async images(campaign) {
    const objects = [campaign.cover_path, campaign.emblem_path].filter(Boolean);
    if (!objects.length) return {};
    const urls = await value(supabase.storage.from("campaign-art").createSignedUrls(objects, 900));
    return Object.fromEntries(urls.map((entry) => [entry.path, entry.signedUrl]));
  },
  async save(campaign, changes, artwork) {
    const storage = supabase.storage.from("campaign-art");
    const staged = [];
    try {
      for (const kind of ["cover", "emblem"]) {
        const file = artwork[kind];
        if (file === undefined) continue;
        if (file === null) {
          changes[`${kind}_path`] = null;
          continue;
        }
        const extension = fileExtension(file, kind);
        const path = `${campaign.id}/${kind}/${crypto.randomUUID()}.${extension}`;
        await value(storage.upload(path, file));
        staged.push(path);
        changes[`${kind}_path`] = path;
      }
      const { slug, ...patch } = changes;
      if (slug !== campaign.slug) patch.slug = slug;
      const query = supabase.from("campaigns").update(patch).eq("id", campaign.id);
      if (patch.slug) query.eq("slug", campaign.slug);
      const fields = ["cover_path", "emblem_path"].filter((field) => Object.hasOwn(changes, field));
      for (const field of fields) {
        if (campaign[field] === null) query.is(field, null);
        else query.eq(field, campaign[field]);
      }
      const saved = await value(query.select().single());
      await removeFiles(fields.map((field) => campaign[field]).filter(Boolean), storage);
      return { ...saved, is_director: campaign.is_director };
    } catch (error) {
      await removeFiles(staged, storage);
      throw error;
    }
  },
};

function fileExtension(file, field) {
  const extension = extensions[file?.type];
  if (!extension || (extension === "pdf" && field !== "sheet_file_path")) {
    throw new Error("Unsupported file type");
  }
  const limit = field === "gallery" ? 20 : ["cover", "emblem"].includes(field) ? 10 : 50;
  if (!file.size || file.size > limit * 1024 * 1024) {
    throw new Error(`File must be between 1 byte and ${limit} MB`);
  }
  return extension;
}

async function removeFiles(paths, storage = bucket()) {
  if (paths.length) {
    const { error } = await storage.remove(paths);
    if (error) console.error(error);
  }
}

async function upload(table, id, field, file, changes = {}) {
  const extension = fileExtension(file, field);
  const columns = table === "characters" ? `${field},user_id` : field;
  const current = await value(supabase.from(table).select(columns).eq("id", id).single());
  const owner = current.user_id ? `${current.user_id}/` : "";
  const object = `${table}/${owner}${id}/${crypto.randomUUID()}.${extension}`;
  await value(bucket().upload(object, file));

  let updated;
  try {
    // Compare the old path so concurrent replacements cannot overwrite each other.
    const mutation = supabase.from(table).update({ ...changes, [field]: object }).eq("id", id);
    const matching = current[field] === null
      ? mutation.is(field, null)
      : mutation.eq(field, current[field]);
    updated = await value(matching.select().single());
  } catch (error) {
    await removeFiles([object]);
    throw error;
  }
  if (current[field]) await removeFiles([current[field]]);
  return updated;
}

async function createMap(form) {
  const file = form.get("file");
  fileExtension(file, "file_path");
  const draft = await value(supabase.from("maps").insert({
    name: form.get("name"),
    description: form.get("description") ?? "",
  }).select().single());

  try {
    return await upload("maps", draft.id, "file_path", file, { is_active: true });
  } catch (error) {
    await supabase.from("maps").delete().eq("id", draft.id).eq("is_active", false);
    throw error;
  }
}

const galleryConfigs = {
  characters: { table: "character_gallery", parent: "character_id", bucket: "character-gallery" },
  creatures: { table: "campaign_entry_images", parent: "creature_id", bucket: "campaign-entry-images", section: "bestiary" },
  allies: { table: "campaign_entry_images", parent: "ally_id", bucket: "campaign-entry-images", section: "npcs" },
  organizations: { table: "campaign_entry_images", parent: "organization_id", bucket: "campaign-entry-images", section: "organizations" },
};

async function galleryRows(config, entryId) {
  const rows = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const page = await value(supabase.from(config.table).select("id,object_path")
      .eq(config.parent, entryId).order("id", { ascending: false }).range(offset, offset + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

async function entryGallery(config, entryId, imageId, method, file) {
  const storage = supabase.storage.from(config.bucket);
  const gallery = supabase.from(config.table);

  if (method === "GET") {
    const rows = await galleryRows(config, entryId);
    const images = [];
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const signed = await value(storage.createSignedUrls(batch.map((row) => row.object_path), 900));
      const urls = new Map(signed.map((entry) => [entry.path, entry.signedUrl]));
      images.push(...batch.map((row) => ({ id: row.id, url: urls.get(row.object_path) })));
    }
    return images;
  }

  if (method === "DELETE") {
    const row = await value(gallery.delete().eq("id", imageId).eq(config.parent, entryId)
      .select("object_path").single());
    await removeFiles([row.object_path], storage);
    return;
  }

  const extension = fileExtension(file, "gallery");
  const { session } = await value(supabase.auth.getSession());
  if (!session) throw new Error("Authentication required");
  const objectPath = `${config.section ?? session.user.id}/${entryId}/${crypto.randomUUID()}.${extension}`;
  await value(storage.upload(objectPath, file));
  try {
    return await value(gallery.insert({ [config.parent]: Number(entryId), object_path: objectPath }).select("id").single());
  } catch (error) {
    await removeFiles([objectPath], storage);
    throw error;
  }
}

async function deleteRecord(table, id) {
  const poiFiles = table === "maps"
    ? await value(supabase.from("points_of_interest").select("image_path").eq("map_id", id))
    : [];
  const config = galleryConfigs[table];
  const gallery = config ? await galleryRows(config, id) : [];
  const row = await value(supabase.from(table).delete().eq("id", id).select().single());
  if (gallery.length) {
    await removeFiles(gallery.map((image) => image.object_path), supabase.storage.from(config.bucket));
  }
  await removeFiles([...mediaFields.map((field) => row[field]), ...poiFiles.map((poi) => poi.image_path)].filter(Boolean));
}

async function listRows(query, order, ascending, transform = (row) => row) {
  const rows = [];
  const size = 1000;
  query.order(order, { ascending });
  if (order !== "id") query.order("id");
  for (let offset = 0; ; offset += size) {
    const page = await value(query.range(offset, offset + size - 1));
    rows.push(...await signMedia(page.map(transform)));
    if (page.length < size) return rows;
  }
}

// Keep the existing view handlers' status/detail contract while using the Supabase SDK.
async function dispatch(path, method, body) {
  const location = new URL(path, "https://campaign.invalid");
  const [collection, id, action, key] = location.pathname.slice(1).split("/");
  if (collection === "character-companions" && method === "GET") {
    return listRows(supabase.rpc("list_shared_character_sheets"), "name", true);
  }
  if (action === "gallery" && Object.hasOwn(galleryConfigs, collection)) {
    return entryGallery(galleryConfigs[collection], id, key, method, body);
  }
  const params = location.searchParams;

  if (collection === "users") {
    if (method === "GET") return campaignAction("roster");
    if (method === "POST") return campaignAction("invite", body);
    if (method === "DELETE") return campaignAction("remove", { userId: id });
    if (action === "permissions") {
      return campaignAction("permission", { ...body, userId: id, pageKey: key });
    }
  }

  const nested = (collection === "characters" && ["inventory", "diary"].includes(action))
    || (collection === "maps" && action === "pois");
  const child = action === "diary" ? "characterDiary" : action;
  const [table, order, ascending] = collections[nested ? child : collection];
  const source = supabase.from(table);
  const parent = collection === "maps" ? "map_id" : "character_id";

  if (method === "GET") {
    const query = collection === "characters" && !nested
      ? source.select("*,owner:profiles(username),private:character_private_fields!character_private_fields_character_id_fkey(fields)")
      : !nested && ["creatures", "allies", "organizations"].includes(collection)
        ? source.select(`*,private:campaign_entry_private_fields!campaign_entry_private_fields_${galleryConfigs[collection].parent}_fkey(fields)`)
        : source.select();
    if (nested) query.eq(parent, id);
    if (collection === "maps" && !nested) query.eq("is_active", true);
    if (collection === "events" && params.has("map_id")) query.eq("map_id", params.get("map_id"));
    if (collection === "characters" && !nested) {
      const { session } = await value(supabase.auth.getSession());
      const ownId = session?.user.id;
      return listRows(query, order, ascending, ({ private: privateRow, ...row }) => {
        const ownFields = privateRow?.fields ?? {};
        return row.user_id === ownId
          ? { ...row, ...ownFields, private_fields: Object.keys(ownFields) }
          : { ...row, sheet_file_path: null };
      });
    }
    if (!nested && ["creatures", "allies", "organizations"].includes(collection)) {
      return listRows(query, order, ascending, ({ private: privateRow, ...row }) => ({
        ...row, ...privateRow?.fields, private_fields: Object.keys(privateRow?.fields ?? {}),
      }));
    }
    return listRows(query, order, ascending);
  }

  if (["creatures", "allies", "organizations"].includes(collection) && !action
      && ["POST", "PUT"].includes(method) && Array.isArray(body?.private_fields)) {
    return value(supabase.rpc("save_campaign_entry", {
      collection, target_id: id ? Number(id) : null, draft: body,
    }));
  }

  if (collection === "characters" && !action && ["POST", "PUT"].includes(method)
      && Array.isArray(body?.private_fields)) {
    return value(supabase.rpc("save_character_profile", {
      target_id: id ? Number(id) : null, draft: body,
    }).single());
  }

  if (method === "DELETE" && action === "image") {
    const current = await value(source.select("image_path").eq("id", id).single());
    if (!current.image_path) return;
    await value(source.update({ image_path: null }).eq("id", id)
      .eq("image_path", current.image_path).select("id").single());
    await removeFiles([current.image_path]);
    return;
  }
  if (method === "DELETE") return deleteRecord(table, id);
  if (method === "POST") {
    if (collection === "maps") return createMap(body);
    if (action === "image" || action === "upload-sheet") {
      return upload(table, id, action === "image" ? "image_path" : "sheet_file_path", body.get("file"));
    }
    return value(source.insert(nested ? { ...body, [parent]: Number(id) } : body).select().single());
  }

  const changes = action === "alignment" ? { alignment: params.get("alignment") } : body;
  return value(source.update(changes).eq("id", id).select().single());
}

export async function campaignRequest(path, { method = "GET", body } = {}) {
  try {
    const data = await dispatch(path, method, body);
    return { ok: true, json: async () => data };
  } catch (error) {
    return { ok: false, json: async () => ({ detail: error.message }) };
  }
}

async function pagedRows(query) {
  const rows = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const page = await value(query.range(offset, offset + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export const groupInventory = {
  async groups() {
    const [groups, memberships] = await Promise.all([
      pagedRows(supabase.from("inventory_groups").select("id,name,archived_at").order("name").order("id")),
      pagedRows(supabase.from("inventory_group_members").select("group_id").order("group_id")),
    ]);
    return { groups, memberIds: memberships.map((row) => row.group_id) };
  },
  manage(action, party, group_name = null) {
    return value(supabase.rpc("manage_inventory_group", { action, party, group_name }));
  },
  create(name) {
    return value(supabase.rpc("create_inventory_group", { group_name: name }));
  },
  join(groupId) {
    return value(supabase.from("inventory_group_members").upsert({ group_id: groupId }, {
      onConflict: "group_id,user_id", ignoreDuplicates: true,
    }));
  },
  leave(groupId) {
    return value(supabase.from("inventory_group_members").delete().eq("group_id", groupId));
  },
  async contents(groupId, userId) {
    const [totals, mine] = await Promise.all([
      pagedRows(supabase.from("inventory_group_totals").select("category,item_key,name,quantity")
        .eq("group_id", groupId).order("category").order("item_key")),
      pagedRows(supabase.from("inventory_group_contributions").select("id,category,name,quantity")
        .eq("group_id", groupId).eq("contributed_by", userId).order("id", { ascending: false })),
    ]);
    return { totals, mine };
  },
  add(groupId, { category, name, quantity }) {
    return value(supabase.from("inventory_group_contributions").insert({
      group_id: groupId, category, name: name.trim(), quantity: Number(quantity),
    }));
  },
  update(groupId, id, quantity, previousQuantity) {
    const update = supabase.from("inventory_group_contributions").update({ quantity: Number(quantity) })
      .eq("group_id", groupId).eq("id", id);
    if (previousQuantity !== undefined) update.eq("quantity", previousQuantity);
    return value(update.select("id").single());
  },
  remove(groupId, id) {
    return value(supabase.from("inventory_group_contributions").delete()
      .eq("group_id", groupId).eq("id", id).select("id").single());
  },
};

const commentTargets = {
  diary: "diary_id",
  maps: "map_id",
  characters: "character_id",
  creatures: "creature_id",
  allies: "ally_id",
  organizations: "organization_id",
};

export const campaignComments = {
  list(collection, id) {
    return pagedRows(supabase.from("campaign_comments").select("id,author_name,body,created_at")
      .eq(commentTargets[collection], id).order("id", { ascending: false }));
  },
  add(collection, id, authorId, body) {
    return value(supabase.from("campaign_comments").insert({
      [commentTargets[collection]]: id, author_character_id: authorId, body: body.trim(),
    }));
  },
};

export const campaignChronicle = {
  list(table, order, filters = {}) {
    let query = supabase.from(table).select("*");
    for (const [field, filter] of Object.entries(filters)) query = query.eq(field, filter);
    return pagedRows(query.order(order).order("id"));
  },
  notes() {
    return pagedRows(supabase.from("chronicle_notes").select().order("session_id"));
  },
  attendance() {
    return pagedRows(supabase.from("chronicle_attendance").select().order("session_id").order("character_id"));
  },
  factions(id) {
    return Promise.all([
      pagedRows(supabase.from("faction_reputation").select().eq("organization_id", id).order("group_id")),
      pagedRows(supabase.from("faction_reputation_history").select().eq("organization_id", id)
        .order("created_at", { ascending: false }).order("id")),
      groupInventory.groups(),
      campaignChronicle.list("chronicle_sessions", "played_on"),
    ]);
  },
  action(action, payload) {
    return value(supabase.rpc("campaign_rework", { action, payload }));
  },
  save(table, fields, id) {
    const source = supabase.from(table);
    return value((id ? source.update(fields).eq("id", id) : source.insert(fields)).select().single());
  },
  async images() {
    const rows = await campaignChronicle.list("chronicle_images", "cover");
    const images = [];
    const storage = supabase.storage.from("chronicle-images");
    for (let start = 0; start < rows.length; start += 100) {
      const page = rows.slice(start, start + 100);
      const urls = new Map((await value(storage.createSignedUrls(page.map((r) => r.object_path), 900)))
        .map((image) => [image.path, image.signedUrl]));
      images.push(...page.map((r) => ({ ...r, url: urls.get(r.object_path) })));
    }
    return images;
  },
  async addImage(campaignId, file, caption) {
    const extension = fileExtension(file, "cover");
    const path = `${campaignId}/${crypto.randomUUID()}.${extension}`;
    const storage = supabase.storage.from("chronicle-images");
    await value(storage.upload(path, file));
    try {
      await campaignChronicle.save("chronicle_images", { object_path: path, caption });
    } catch (error) {
      await removeFiles([path], storage);
      throw error;
    }
  },
  async removeImage(id) {
    const row = await value(supabase.from("chronicle_images").delete().eq("id", id).select("object_path").single());
    await removeFiles([row.object_path], supabase.storage.from("chronicle-images"));
  },
};

export const treasury = {
  async artwork(path) {
    if (!path) return null;
    return (await value(supabase.storage.from("inventory-artwork").createSignedUrl(path, 900))).signedUrl;
  },
  async setArtwork(item, file) {
    let path = null;
    if (file) {
      const extension = fileExtension(file, "cover");
      if (!["png", "jpg", "webp", "gif", "avif"].includes(extension)) throw new Error("Formato de imagen no compatible");
      path = `${item.campaign_id}/${item.id}/${crypto.randomUUID()}.${extension}`;
      await value(supabase.storage.from("inventory-artwork").upload(path, file));
    }
    return value(supabase.rpc("set_inventory_artwork", {
      item: item.id, path, previous_path: item.artwork_path,
    }));
  },
  async contents(groupId) {
    const filters = { group_id: groupId };
    return Object.fromEntries(await Promise.all(Object.entries({
      wallet: ["treasury_wallet", "denomination"],
      items: ["inventory_group_contributions", "name"],
      history: ["treasury_history", "created_at"],
    }).map(async ([key, [table, order]]) => [key, await campaignChronicle.list(table, order, filters)])));
  },
  personal(characterId) {
    return Promise.all([
      campaignChronicle.list("character_inventory", "item_name", { character_id: characterId }),
      campaignChronicle.list("treasury_wallet", "denomination", { character_id: characterId }),
    ]);
  },
  move(movements, sessionId, requestId) {
    return campaignChronicle.action("treasury", { movements, session_id: sessionId || null, request_id: requestId });
  },
};
