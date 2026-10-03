"use client";
// First-run onboarding (§14.2 /setup): Chrome → optional voices → optional Python → keys → contact → licence → demo.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { HomeConfig } from "@docmaker/core";
import type { DoctorCheck } from "@docmaker/engine";
import { api, errorText } from "@/lib/api";
import { useT } from "./I18nProvider";
import { useDoctor } from "./useDoctor";
import { DemoButton } from "./DemoButton";
import { LicenseChoice } from "./LicenseChoice";
import { Badge, Banner, Button, Card, ErrorText, Field, inputCls } from "./ui";

function Step({ n, title, status, children }: { n: number; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-xs">{n}</span>{title}</span>} actions={status}>
      {children}
    </Card>
  );
}

function CheckState({ checks, ids, optional }: { checks: DoctorCheck[] | null; ids: string[]; optional?: boolean }) {
  const t = useT();
  if (!checks) return <Badge>{t("common.loading")}</Badge>;
  const found = checks.filter((c) => ids.includes(c.id));
  const ok = found.length > 0 && found.some((c) => c.ok);
  return ok ? <Badge tone="green">{t("setup.ok")}</Badge> : <Badge tone={optional ? "neutral" : "red"}>{optional ? t("setup.optionalMissing") : t("setup.missing")}</Badge>;
}

const Cmd = ({ children }: { children: string }) => <code className="block rounded bg-neutral-950 px-3 py-2 font-mono text-xs text-amber-300">{children}</code>;

export function SetupWizard({ home }: { home: HomeConfig }) {
  const t = useT();
  const router = useRouter();
  const { report, error: docErr } = useDoctor(true);
  const checks = report?.checks ?? null;
  const [contact, setContact] = useState(home.contact ?? "");
  const [license, setLicense] = useState(home.remotionLicense);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintOf = (id: string) => checks?.find((c) => c.id === id)?.hint ?? null;

  const saveContact = async () => {
    setError(null);
    try {
      await api("/api/home", { method: "PATCH", json: { contact: contact.trim() || null } });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/home", { method: "PATCH", json: { onboardingDone: true, ...(contact.trim() ? { contact: contact.trim() } : {}) } });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const blocking = report?.blocking ?? false;
  return (
    <div className="space-y-4">
      {docErr ? <Banner tone="red">{docErr}</Banner> : null}
      {blocking ? <Banner tone="red">{t("setup.doctorBlocking")}</Banner> : null}
      <Step n={1} title={t("setup.step.chrome")} status={<CheckState checks={checks} ids={["chrome"]} />}>
        <p className="mb-2 text-sm text-neutral-400">{t("setup.cli")}</p>
        <Cmd>{hintOf("chrome") ?? "pnpm docmaker setup --browser"}</Cmd>
      </Step>
      <Step n={2} title={t("setup.step.models")} status={<CheckState checks={checks} ids={["model:kokoro", "model:piper"]} optional />}>
        <p className="mb-2 text-sm text-neutral-400">{t("setup.cli")}</p>
        <Cmd>pnpm docmaker setup --tts kokoro</Cmd>
      </Step>
      <Step n={3} title={t("setup.step.python")} status={<CheckState checks={checks} ids={["python-sidecar"]} optional />}>
        <p className="mb-2 text-sm text-neutral-400">{t("setup.cli")}</p>
        <Cmd>pnpm docmaker setup --python</Cmd>
      </Step>
      <Step n={4} title={t("setup.step.keys")}>
        <p className="text-sm text-neutral-400">{t("setup.keysHint")}</p>
        <a href="/settings" className="mt-2 inline-block text-sm text-amber-400 hover:underline">
          {t("nav.settings")} →
        </a>
      </Step>
      <Step n={5} title={t("setup.step.contact")} status={contact.trim() ? <Badge tone="green">{t("setup.ok")}</Badge> : <Badge>{t("common.optional")}</Badge>}>
        <Field label={t("settings.contact")} hint={t("setup.contactHint")}>
          <div className="flex gap-2">
            <input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t("setup.contactPlaceholder")} maxLength={200} />
            <Button onClick={saveContact}>{t("common.save")}</Button>
          </div>
        </Field>
      </Step>
      <Step n={6} title={t("setup.step.license")} status={license ? <Badge tone="green">{license.status}</Badge> : <Badge tone="red">{t("setup.missing")}</Badge>}>
        <LicenseChoice current={home.remotionLicense} onSaved={(h) => setLicense(h.remotionLicense)} />
      </Step>
      <Step n={7} title={t("setup.step.demo")}>
        <div className="flex flex-wrap items-center gap-3">
          <DemoButton />
          <Button variant="primary" busy={busy} disabled={!license} onClick={finish} data-testid="finish-setup">
            {t("setup.finish")}
          </Button>
        </div>
      </Step>
      <ErrorText error={error} />
    </div>
  );
}
