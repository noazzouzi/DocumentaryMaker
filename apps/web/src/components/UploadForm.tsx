"use client";
// File upload with the mandatory licence declaration (own work / licensed / third-party quotation / AI-generated).
// Uses XHR for upload progress; the server streams the body to <project>/uploads/ and imports it.
import { useState } from "react";
import { LicenseCode, type FrozenAsset, type UploadDeclaration } from "@docmaker/core";
import { useT } from "./I18nProvider";
import { Button, ErrorText, Field, ProgressBar, inputCls } from "./ui";

export interface UploadResult { rel: string; asset: FrozenAsset | null }

export function uploadFile(url: string, file: File, fields: Record<string, string>, onProgress: (p: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v); // text fields first: the server reads them before the file
    fd.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult);
      else reject(new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(fd);
  });
}

export function DeclarationForm({ value, onChange }: { value: UploadDeclaration; onChange: (d: UploadDeclaration) => void }) {
  const t = useT();
  const kinds = ["own-work", "licensed", "third-party-quotation", "ai-generated"] as const;
  return (
    <fieldset className="grid gap-2 rounded-md border border-neutral-800 p-3">
      <legend className="px-1 text-xs uppercase text-neutral-400">{t("scenes.declaration")}</legend>
      <div className="grid gap-1 text-sm">
        {kinds.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="decl-kind" className="accent-amber-500" checked={value.kind === k} onChange={() => onChange({ ...value, kind: k, license: k === "licensed" ? value.license ?? "CC-BY" : null })} />
            {t(`scenes.decl.${k}`)}
          </label>
        ))}
      </div>
      {value.kind === "licensed" ? (
        <Field label={t("scenes.decl.license")}>
          <select className={inputCls} value={value.license ?? ""} onChange={(e) => onChange({ ...value, license: e.target.value as UploadDeclaration["license"] })}>
            {LicenseCode.options.filter((c) => c !== "UNKNOWN" && c !== "PROCEDURAL" && c !== "PROVIDER-TERMS").map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("scenes.decl.author")}>
          <input className={inputCls} value={value.author} onChange={(e) => onChange({ ...value, author: e.target.value })} />
        </Field>
        <Field label={t("scenes.decl.url")}>
          <input className={inputCls} value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} placeholder="https://" />
        </Field>
      </div>
      <Field label={t("scenes.decl.note")}>
        <input className={inputCls} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </Field>
    </fieldset>
  );
}

export const declarationValid = (d: UploadDeclaration): boolean =>
  (d.kind !== "licensed" || !!d.license) && ((d.kind !== "licensed" && d.kind !== "third-party-quotation") || d.url.trim().length > 0);

export function UploadForm({ slug, accept, onUploaded, label, initialKind = "own-work" }: { slug: string; accept: string; onUploaded: (r: UploadResult) => void | Promise<void>; label?: string; initialKind?: UploadDeclaration["kind"] }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [decl, setDecl] = useState<UploadDeclaration>({ kind: initialKind, license: null, author: "", url: "", note: "" });
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const r = await uploadFile(`/api/projects/${slug}/upload?kind=asset`, file, { declaration: JSON.stringify(decl) }, setProgress);
      await onUploaded(r);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="space-y-3">
      <input type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm text-neutral-300 file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-100" />
      <DeclarationForm value={decl} onChange={setDecl} />
      {progress !== null ? <ProgressBar pct={progress} /> : null}
      <Button variant="primary" disabled={!file || !declarationValid(decl) || progress !== null} busy={progress !== null} onClick={submit}>
        {label ?? t("scenes.uploadAndUse")}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
