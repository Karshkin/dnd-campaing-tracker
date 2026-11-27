import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;

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
    const signed = await value(bucket().createSignedUrls(paths.slice(offset, offset + 100), 900));
    for (const entry of signed) urls.set(entry.path, entry.signedUrl);
  }
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(mediaFields.filter((field) => row[field]).map((field) => [field, urls.get(row[field]) || null])),
  }));
}

function withPermissions(user) {
  return {
    ...user,
    permissions: user.permissions.map((entry) => user.is_admin
      ? { ...entry, permission_level: "admin" }
      : entry),
  };
}

const profileColumns = "id,username,is_admin,permissions:page_permissions(page_key,permission_level)";

export async function readProfile(userId) {
  const profile = await value(supabase.from("profiles").select(profileColumns).eq("id", userId).single());
  return withPermissions(profile);
}

async function manageUser(payload) {
  const { data, error } = await supabase.functions.invoke("manage-users", { body: payload });
  if (error) {
    let detail;
    if (error.context instanceof Response) {
      detail = (await error.context.json().catch(() => null))?.detail;
    }
    throw new Error(detail || error.message);
  }
  return data;
}

function fileExtension(file, field) {
  const extension = extensions[file?.type];
  if (!extension || (extension === "pdf" && field !== "sheet_file_path")) {
    throw new Error("Unsupported file type");
  }
  if (!file.size || file.size > 50 * 1024 * 1024) {
    throw new Error("File must be between 1 byte and 50 MB");
  }
  return extension;
}

async function removeFiles(paths) {
  if (paths.length) {
    const { error } = await bucket().remove(paths);
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

async function deleteRecord(table, id) {
  const poiFiles = table === "maps"
    ? await value(supabase.from("points_of_interest").select("image_path").eq("map_id", id))
    : [];
  const row = await value(supabase.from(table).delete().eq("id", id).select().single());
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
  const params = location.searchParams;

  if (collection === "users") {
    if (method === "GET") {
      const users = await value(supabase.from("profiles").select(profileColumns).order("created_at"));
      return users.map(withPermissions);
    }
    if (action === "permissions") {
      return value(supabase.from("page_permissions").update(body)
        .eq("user_id", id).eq("page_key", key).select().single());
    }
    return manageUser(id ? { action: "reset", userId: id, ...body } : { action: "create", ...body });
  }

  const nested = (collection === "characters" && ["inventory", "diary"].includes(action))
    || (collection === "maps" && action === "pois");
  const child = action === "diary" ? "characterDiary" : action;
  const [table, order, ascending] = collections[nested ? child : collection];
  const source = supabase.from(table);
  const parent = collection === "maps" ? "map_id" : "character_id";

  if (method === "GET") {
    const query = collection === "characters" && !nested
      ? source.select("*,owner:profiles(username)")
      : source.select();
    if (nested) query.eq(parent, id);
    if (collection === "maps" && !nested) query.eq("is_active", true);
    if (collection === "events" && params.has("map_id")) query.eq("map_id", params.get("map_id"));
    if (collection === "characters" && !nested) {
      const { session } = await value(supabase.auth.getSession());
      const ownId = session?.user.id;
      return listRows(query, order, ascending, (row) => row.user_id === ownId
        ? row
        : { ...row, image_path: null, sheet_file_path: null });
    }
    return listRows(query, order, ascending);
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
