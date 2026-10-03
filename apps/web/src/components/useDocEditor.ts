"use client";
// Editing state for one user-editable document: local value, dirty flag, ETag-guarded save (412 → conflict), issues.
import { useCallback, useState } from "react";
import { ApiError, errorText, getDoc, putDoc, type LintIssueLike } from "@/lib/api";

export function useDocEditor<T>(slug: string, rel: string, initial: T | null, initialEtag: string | null) {
  const [value, setValue] = useState<T | null>(initial);
  const [saved, setSaved] = useState<T | null>(initial);
  const [etag, setEtag] = useState<string | null>(initialEtag);
  const [issues, setIssues] = useState<LintIssueLike[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = value !== saved;

  const update = useCallback((fn: (v: T) => T) => setValue((v) => (v === null ? v : fn(v))), []);

  const save = useCallback(
    async (next?: T): Promise<boolean> => {
      const v = next ?? value;
      if (v === null) return false;
      setSaving(true);
      setError(null);
      try {
        const r = await putDoc(slug, rel, v, etag);
        setEtag(r.etag);
        setIssues(r.issues);
        setSaved(v);
        setValue(v);
        setConflict(false);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 412) setConflict(true);
        setError(errorText(e));
        if (e instanceof ApiError && Array.isArray(e.details)) setIssues((e.details as { path: string; message: string }[]).map((d) => ({ level: "error", rule: "SCHEMA", where: d.path || "global", msg: d.message })));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [slug, rel, value, etag],
  );

  /** Reloads the server version (after a conflict or a revert). Local edits are discarded. */
  const reload = useCallback(async () => {
    try {
      const d = await getDoc<T>(slug, rel);
      setValue(d?.value ?? null);
      setSaved(d?.value ?? null);
      setEtag(d?.etag ?? null);
      setConflict(false);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [slug, rel]);

  return { value, setValue, update, saved, etag, dirty, save, saving, error, conflict, issues, setIssues, reload };
}
