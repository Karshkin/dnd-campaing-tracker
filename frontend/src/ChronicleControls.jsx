import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export function useCampaignQuery(load, revision) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const rows = await load();
      if (version === sequence.current) {
        setData(rows);
        setError("");
      }
    } catch (error) {
      if (version === sequence.current) setError(error.message);
    }
  }, [load]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      ++sequence.current;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, revision]);
  return { data, error, refresh };
}

export function useCampaignMutation(refresh) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function run(action) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function SelectRow({ label, rows, value, onChange, empty, required }) {
  const labelId = useId();
  return <label><span id={labelId}>{label}</span>
    <select aria-labelledby={labelId} value={value} required={required} onChange={(event) => onChange(event.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {rows.map((row) => <option key={row.id} value={row.id}>{row.title ?? row.name}</option>)}
    </select>
  </label>;
}

export function Choices({ label, rows, values, onChange, selectAll = false }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const selected = new Set(values);
  const visible = rows.filter((row) =>
    (row.title ?? row.name).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const toggle = (id) => onChange(selected.has(id) ? values.filter((value) => value !== id) : [...values, id]);

  return <fieldset className="chronicle-choices">
    <legend>{label}</legend>
    <label>{t("choices.search")} <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <p aria-live="polite">{t("choices.selected", { count: values.length })}</p>
    {values.length > 0 && <ul className="choice-summary">
      {values.map((id) => {
        const row = rows.find((option) => option.id === id);
        const name = row?.title ?? row?.name ?? t("choices.unavailable", { id });
        return <li key={id}><button type="button" aria-label={t("choices.remove", { name })}
          onClick={() => toggle(id)}>{name} ×</button></li>;
      })}
    </ul>}
    {selectAll && <button type="button" disabled={rows.every(({ id }) => selected.has(id))}
      onClick={() => onChange([...new Set([...values, ...rows.map(({ id }) => id)])])}>{t("choices.all")}</button>}
    <div className="choice-options">
      {visible.length ? visible.map((row) => (
        <label key={row.id}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
          <span>{row.title ?? row.name}</span></label>
      )) : <p>{t("choices.empty")}</p>}
    </div>
  </fieldset>;
}
