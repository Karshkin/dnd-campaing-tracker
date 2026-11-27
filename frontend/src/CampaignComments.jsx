import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { campaignComments } from "./campaign";
import "./campaign-comments.css";

function CommentThread({ collection, entryId, authors }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState(null);
  const [author, setAuthor] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const authorId = authors.some((character) => character.id === author) ? author : authors[0]?.id;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" });

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const comments = await campaignComments.list(collection, entryId);
      if (request === latest.current) setRows(comments);
    } catch (err) {
      if (request === latest.current) setError(err.message);
    }
  }, [collection, entryId]);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 15_000);
    return () => {
      ++latest.current;
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [refresh]);

  async function submit(event) {
    event.preventDefault();
    if (!authorId || !body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await campaignComments.add(collection, entryId, authorId, body);
      setBody("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="campaign-comment-thread">
      {authorId ? (
        <form className="form" onSubmit={submit}>
          {authors.length > 1 ? (
            <label>
              {t("comments.asCharacter")}
              <select value={authorId} onChange={(event) => setAuthor(Number(event.target.value))}>
                {authors.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
              </select>
            </label>
          ) : <p>{t("comments.postingAs", { name: authors[0].name })}</p>}
          <label>
            {t("comments.comment")}
            <textarea rows={3} maxLength={2000} required value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <button type="submit" disabled={busy || !body.trim()}>{t("comments.publish")}</button>
        </form>
      ) : <p>{t("comments.needCharacter")}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!rows && !error && <p role="status">{t("common.loading")}</p>}
      {rows?.length === 0 && <p>{t("comments.empty")}</p>}
      {rows?.length > 0 && (
        <ul className="campaign-comment-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="campaign-comment-byline">
                <strong>{row.author_name}</strong>
                <time dateTime={row.created_at}>{date.format(new Date(row.created_at))}</time>
              </div>
              <p>{row.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CampaignComments({ collection, entryId, authors }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <details className="campaign-comments" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("comments.title")}</summary>
      {open && <CommentThread key={entryId} collection={collection} entryId={entryId} authors={authors} />}
    </details>
  );
}
