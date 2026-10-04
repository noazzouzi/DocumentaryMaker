"use client";
// /settings: keys (masked status, consented write, test), contact, defaults, UI language, licence, paths, doctor, setup.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENV_KEYS, type HomeConfig, type Lang, type SecretName } from "@docmaker/core";
import type { StyleSummary } from "@docmaker/styles";
import { api, errorText } from "@/lib/api";
import { setUiLangCookie } from "@/lib/cookies";
import { useI18n } from "./I18nProvider";
import { useDoctor } from "./useDoctor";
import { DoctorList } from "./DoctorList";
import { LicenseChoice } from "./LicenseChoice";
import { Badge, Banner, Button, Card, ErrorText, Field, inputCls } from "./ui";

const KEY_NAMES = Object.keys(ENV_KEYS) as SecretName[];

function KeyRow({ name, status }: { name: SecretName; status: { set: boolean; masked: string } | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [isSet, setIsSet] = useState<boolean | null>(status?.set ?? null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/keys", { method: "POST", json: { name, value, consent } });
      setValue("");
      setConsent(false);
      setOpen(false);
      setIsSet(true);
      setMsg({ tone: "green", text: t("common.saved") });
    } catch (e) {
      setMsg({ tone: "red", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; tier: string | null; message: string }>(`/api/keys/test?name=${name}`);
      setMsg({ tone: r.ok ? "green" : "red", text: r.message });
    } catch (e) {
      setMsg({ tone: "red", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const shown = isSet ?? status?.set ?? null;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-44 font-mono text-xs">{ENV_KEYS[name]}</span>
        {shown === null ? <Badge>…</Badge> : shown ? <Badge tone="green">{t("settings.key.set")}</Badge> : <Badge>{t("settings.key.unset")}</Badge>}
        {status?.masked && status.set ? <span className="font-mono text-xs text-neutral-500">{status.masked}</span> : null}
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setOpen((o) => !o)}>{t("settings.key.replace")}</Button>
          <Button size="sm" onClick={test} busy={busy && !open} disabled={!shown}>{t("settings.key.test")}</Button>
        </div>
      </div>
      {open ? (
        <div className="mt-2 space-y-2 rounded-md border border-neutral-800 p-3">
          <input type="password" autoComplete="off" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder={ENV_KEYS[name]} />
          <label className="flex items-start gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-amber-500" />
            {t("settings.key.consent")}
          </label>
          <Button size="sm" variant="primary" busy={busy} disabled={!consent || !value.trim()} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
      {msg ? <p className={msg.tone === "green" ? "mt-1 text-xs text-emerald-400" : "mt-1 text-xs text-red-400"}>{msg.text}</p> : null}
    </li>
  );
}

export function SettingsPanel({ home, styles, paths }: { home: HomeConfig; styles: StyleSummary[]; paths: { label: string; value: string }[] }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const doctor = useDoctor(true);
  const [contact, setContact] = useState(home.contact ?? "");
  const [langs, setLangs] = useState<Lang[]>(home.defaults.languages);
  const [minutes, setMinutes] = useState(home.defaults.targetMinutes);
  const [styleId, setStyleId] = useState<string | null>(home.defaults.styleId);
  const [llm, setLlm] = useState<"anthropic" | "claude-code">(home.defaults.llm ?? "anthropic");
  const [uiLang, setUiLang] = useState(home.uiLang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const keyStatus = (name: SecretName) => {
    const c = doctor.report?.checks.find((x) => x.id === `key:${name}`);
    if (!c) return null;
    return { set: c.hint === null, masked: c.value.replace(ENV_KEYS[name], "").trim() };
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/home", {
        method: "PATCH",
        json: { contact: contact.trim() || null, uiLang, defaults: { languages: langs.length ? langs : ["en"], targetMinutes: Math.min(60, Math.max(1, minutes)), styleId, llm } },
      });
      setUiLangCookie(uiLang === "en" || uiLang === "fr" ? uiLang : null);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("settings.keys")}>
        <ul className="divide-y divide-neutral-800">
          {KEY_NAMES.map((n) => (
            <KeyRow key={n} name={n} status={keyStatus(n)} />
          ))}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card title={t("settings.defaults")} actions={<Button variant="primary" size="sm" busy={busy} onClick={save}>{t("common.save")}</Button>}>
          <div className="grid gap-3">
            <Field label={t("settings.contact")} hint={t("setup.contactHint")}>
              <input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t("setup.contactPlaceholder")} maxLength={200} />
            </Field>
            <Field label={t("new.languages")}>
              <div className="flex gap-3">
                {(["en", "fr"] as const).map((l) => (
                  <label key={l} className="flex items-center gap-1.5 uppercase">
                    <input type="checkbox" className="accent-amber-500" checked={langs.includes(l)} onChange={(e) => setLangs((cur) => (e.target.checked ? [...new Set([...cur, l])] : cur.filter((x) => x !== l)))} />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
            <Field label={t("new.minutes")}>
              <input type="number" min={1} max={60} className={inputCls} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </Field>
            <Field label={t("new.style")}>
              <select className={inputCls} value={styleId ?? ""} onChange={(e) => setStyleId(e.target.value || null)}>
                <option value="">—</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.names[lang]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("new.llm")} hint={t("settings.llmHint")}>
              <select className={inputCls} value={llm} onChange={(e) => setLlm(e.target.value as "anthropic" | "claude-code")}>
                <option value="claude-code">{t("new.llm.claude-code")}</option>
                <option value="anthropic">{t("new.llm.anthropic")}</option>
              </select>
            </Field>
            <Field label={t("settings.uiLang")}>
              <select className={inputCls} value={uiLang} onChange={(e) => setUiLang(e.target.value as HomeConfig["uiLang"])}>
                <option value="auto">{t("settings.uiLang.auto")}</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </Field>
            {saved ? <Banner tone="green">{t("common.saved")}</Banner> : null}
            <ErrorText error={error} />
          </div>
        </Card>
        <Card title={t("settings.license")}>
          <LicenseChoice current={home.remotionLicense} />
        </Card>
        <Card title={t("settings.paths")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {paths.map((p) => (
              <div key={p.label} className="contents">
                <dt className="text-neutral-500">{p.label}</dt>
                <dd className="truncate font-mono text-neutral-300" title={p.value}>
                  {p.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <Card title={t("settings.doctor")} actions={<Button size="sm" busy={doctor.loading} onClick={() => void doctor.run()}>{t("settings.runDoctor")}</Button>} className="lg:col-span-2">
        {doctor.error ? <Banner tone="red">{doctor.error}</Banner> : null}
        {doctor.report ? <DoctorList checks={doctor.report.checks} /> : <p className="text-sm text-neutral-500">{t("common.loading")}</p>}
      </Card>
      <Card title={t("settings.setupActions")} className="lg:col-span-2">
        <p className="mb-2 text-sm text-neutral-400">{t("setup.cli")}</p>
        <div className="grid gap-1.5 font-mono text-xs text-amber-300 sm:grid-cols-2">
          {["setup --browser", "setup --sfx procedural", "setup --tts kokoro", "setup --tts piper:fr_FR-gilles-low", "setup --python", "setup --yt-dlp", "setup --whisper faster-whisper", "setup --clip"].map((c) => (
            <code key={c} className="rounded bg-neutral-950 px-2 py-1">
              pnpm docmaker {c}
            </code>
          ))}
        </div>
      </Card>
    </div>
  );
}
