import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { groupInventory } from "./campaign";
import { Treasury } from "./Treasury";
import "./group-inventory.css";

const categories = ["coins", "equipment", "consumables", "materials", "other"];
const blankItem = { name: "", category: "coins", quantity: "1" };
const collate = (rows, category) => rows.filter((row) => row.category === category);

function ActiveInventory({ groupId, userId, revision, onChange }) {
  const { t, i18n } = useTranslation();
  const [tables, setTables] = useState(null);
  const [draft, setDraft] = useState(blankItem);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const format = new Intl.NumberFormat(i18n.resolvedLanguage);

  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const data = await groupInventory.contents(groupId, userId);
      if (version === sequence.current) setTables(data);
    } catch (err) {
      if (version === sequence.current) setError(err.message);
    }
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      ++sequence.current;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, revision]);

  async function mutate(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChange();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form group-contribution-form" onSubmit={(event) => {
        event.preventDefault();
        mutate(async () => {
          await groupInventory.add(groupId, draft);
          setDraft(blankItem);
        });
      }}>
        <label>
          {t("groupInventory.category")}
          <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
            {categories.map((category) => <option key={category} value={category}>{t(`groupInventory.${category}`)}</option>)}
          </select>
        </label>
        <label>
          {t("groupInventory.itemName")}
          <input value={draft.name} required maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder={t("groupInventory.itemExample")} />
        </label>
        <label>
          {t("resources.quantity")}
          <input type="number" min={1} max={1000000000} required value={draft.quantity}
            onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} />
        </label>
        <button type="submit" disabled={busy || !draft.name.trim()}>{t("groupInventory.addItem")}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {!tables && !error && <p role="status">{t("common.loading")}</p>}
      {tables && (tables.totals.length ? (
        <div className="group-inventory-tables">
          {categories.map((category) => {
            const rows = collate(tables.totals, category);
            if (!rows.length) return null;
            return (
              <table key={category}>
                <caption>{t(`groupInventory.${category}`)}</caption>
                <thead><tr><th scope="col">{t("groupInventory.itemName")}</th><th scope="col">{t("groupInventory.total")}</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.item_key}><td>{row.name}</td><td>{format.format(row.quantity)}</td></tr>
                  ))}
                </tbody>
              </table>
            );
          })}
        </div>
      ) : <p>{t("groupInventory.empty")}</p>)}
      {tables?.mine.length > 0 && (
        <details className="group-my-contributions">
          <summary>{t("groupInventory.myContributions")}</summary>
          <ul>
            {tables.mine.map((row) => (
              <li key={row.id}>
                <strong>{row.name}</strong>
                <span>{t(`groupInventory.${row.category}`)} · {format.format(row.quantity)}</span>
                {editing?.id === row.id ? (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    mutate(async () => {
                      await groupInventory.update(groupId, row.id, editing.quantity, editing.previousQuantity);
                      setEditing(null);
                    });
                  }}>
                    <label>
                      {t("resources.quantity")}
                      <input type="number" min={1} max={1000000000} required value={editing.quantity}
                        onChange={(event) => setEditing({ ...editing, quantity: event.target.value })} />
                    </label>
                    <button type="submit" disabled={busy}>{t("common.save")}</button>
                    <button type="button" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                  </form>
                ) : (
                  <div className="group-inventory-actions">
                    <button type="button" disabled={busy} onClick={() => setEditing({ id: row.id, quantity: row.quantity, previousQuantity: row.quantity })}>{t("common.edit")}</button>
                    <button type="button" disabled={busy} onClick={() => {
                      if (window.confirm(t("groupInventory.removeConfirm"))) {
                        mutate(() => groupInventory.remove(groupId, row.id));
                      }
                    }}>{t("common.delete")}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function GroupInventory({ userId, characters, director, revision }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState(null);
  const [memberIds, setMemberIds] = useState([]);
  const [selection, setSelection] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const refresh = useCallback(async (preferred) => {
    const version = ++sequence.current;
    try {
      const data = await groupInventory.groups();
      if (version !== sequence.current) return;
      setGroups(data.groups);
      setMemberIds(data.memberIds);
      setSelection((current) => {
        if (data.groups.some((group) => group.id === preferred)) return preferred;
        if (data.groups.some((group) => group.id === current)) return current;
        return data.memberIds[0] ?? data.groups[0]?.id ?? null;
      });
    } catch (err) {
      if (version === sequence.current) setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const timer = setInterval(onFocus, 30_000);
    window.addEventListener("focus", onFocus);
    return () => {
      ++sequence.current;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function changeMembership(action) {
    setBusy(true);
    setError("");
    try {
      const preferred = await action();
      await refresh(preferred);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const [moves, setMoves] = useState(0);
  const [contributionChanges, setContributionChanges] = useState(0);
  const selectedGroup = groups?.find(({ id }) => id === selection);
  const archived = Boolean(selectedGroup?.archived_at);
  const joined = memberIds.includes(selection);

  async function archiveGroup() {
    const impact = await groupInventory.manage("impact", selection);
    const coins = Object.entries(impact.coins).map(([coin, balance]) => `${balance} ${coin}`).join(", ") || "0";
    if (window.confirm(`¿Archivar «${selectedGroup.name}»? Quedarán en modo de consulta ${impact.members} miembros, ${impact.items} unidades, ${coins} y ${impact.history} movimientos.`)) {
      await groupInventory.manage("archive", selection);
    }
    return selection;
  }
  return (
    <section className="character-sheet-panel group-inventory">
      <h3>{t("groupInventory.title")}</h3>
      <details className="group-create">
        <summary>{t("groupInventory.create")}</summary>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          changeMembership(async () => {
            const id = await groupInventory.create(name.trim());
            setName("");
            return id;
          });
        }}>
          <label>
            {t("groupInventory.groupName")}
            <input value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>{t("groupInventory.create")}</button>
        </form>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      {!groups && !error && <p role="status">{t("common.loading")}</p>}
      {groups?.length === 0 && <p>{t("groupInventory.noGroups")}</p>}
      {groups?.length > 0 && (
        <>
          <div className="group-inventory-actions">
            <label>
              {t("groupInventory.group")}
              <select value={selection ?? ""} disabled={busy} onChange={(event) => setSelection(Number(event.target.value))}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}{group.archived_at ? " · Archivado" : ""}{memberIds.includes(group.id) ? ` · ${t("groupInventory.member")}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {director && !archived && selectedGroup && <>
              <button type="button" disabled={busy} onClick={() => {
                const groupName = window.prompt("Nombre del grupo", selectedGroup.name);
                if (groupName !== null) changeMembership(async () => {
                  await groupInventory.manage("rename", selection, groupName);
                  return selection;
                });
              }}>Renombrar grupo</button>
              <button type="button" disabled={busy} onClick={() => changeMembership(archiveGroup)}>Archivar grupo</button>
            </>}
            {!archived && (joined ? (
              <button type="button" disabled={busy} onClick={() => {
                if (window.confirm(t("groupInventory.leaveConfirm"))) {
                  changeMembership(async () => {
                    await groupInventory.leave(selection);
                    return selection;
                  });
                }
              }}>{t("groupInventory.leave")}</button>
            ) : (
              <button type="button" disabled={busy || selection === null} onClick={() => changeMembership(async () => {
                await groupInventory.join(selection);
                return selection;
              })}>{t("groupInventory.join")}</button>
            ))}
          </div>
          {(joined || director) && <Treasury key={selection} groupId={selection} characters={characters} director={director} userId={userId} archived={archived}
            revision={revision + contributionChanges} onMove={() => setMoves((count) => count + 1)} />}
          {joined && !archived && <details><summary>Aportaciones y totales</summary>
            <ActiveInventory key={selection} groupId={selection} userId={userId}
              revision={revision + moves} onChange={() => setContributionChanges((count) => count + 1)} />
          </details>}
          {!joined && !director && !archived && <p>{t("groupInventory.joinHint")}</p>}
        </>
      )}
    </section>
  );
}
