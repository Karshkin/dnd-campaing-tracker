import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function AtlasDescription({ description }) {
  const { t } = useTranslation();
  const id = useId();
  const paragraph = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const text = description?.trim();

  useEffect(() => {
    const node = paragraph.current;
    if (!node) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      setCanExpand(node.scrollHeight > lineHeight * 3 + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [text]);

  if (!text) return null;
  return <div className="atlas-description">
    <p id={id} ref={paragraph} data-expanded={expanded}>{text}</p>
    {canExpand && <button type="button" className="atlas-description-toggle"
      aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      {t(expanded ? "shell.collapseMapDescription" : "shell.expandMapDescription")}
    </button>}
  </div>;
}
