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

export function Choices({ label, rows, values, onChange }) {
  const labelId = useId();
  return <label><span id={labelId}>{label}</span>
    <select aria-labelledby={labelId} multiple value={values.map(String)} onChange={(event) => {
      onChange(Array.from(event.target.selectedOptions, (option) => Number(option.value)));
    }}>
      {rows.map((row) => <option key={row.id} value={row.id}>{row.title ?? row.name}</option>)}
    </select>
  </label>;
}
