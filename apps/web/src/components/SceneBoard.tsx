"use client";
// /p/[slug]/scenes: chapters → beat cards (text, visual kind, cues, motion template + live-validated JSON editor, picks
// per slot with licence badges), orphaned picks (re-apply / discard), asset picker (stored candidates, live search with
// paid confirm, upload with declaration) → freeze → user-picks.json → coalesced assets→direct jobs; manual clips.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  P, PRICES, type AssetPick, type AssetProviderId, type BeatLang, type BeatPlan, type BeatSlicesDoc, type CandidateRecord, type CandidateScore,
  type ClipResolution, type FactSheet, type FrozenAsset, type Lang, type LicenseInfo, type PicksDoc, type Project, type ScriptSegment, type UserPicksDoc,
} from "@docmaker/core";
import { api, errorText, putDoc, submitJob, type LintIssueLike } from "@/lib/api";
import { checkMotionData } from "@/lib/motion";
import { useI18n } from "./I18nProvider";
import { FairUseDialog } from "./FairUseDialog";
import { UploadForm, uploadFile, DeclarationForm, declarationValid } from "./UploadForm";
import { Badge, Banner, Button, Card, ErrorText, Field, IssueList, Modal, Tabs, cx, inputCls } from "./ui";

const FREE_PROVIDERS: AssetProviderId[] = ["openverse", "wikimedia", "internet-archive", "nasa", "loc", "pexels", "pixabay", "local", "procedural"];
const PAID_PROVIDERS: AssetProviderId[] = ["brave", "fal"];
const ZERO_SCORE: CandidateScore = { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "user pick" };
const PAID_CALL_USD = Math.max(PRICES.bravePer1k / 1000, PRICES.fal["fal-ai/flux/schnell"].perMegapixel * 2);

export interface SceneData {
  project: Project; lang: Lang; plans: BeatPlan[]; slices: BeatSlicesDoc | null; slicesEtag: string | null; picks: PicksDoc | null;
  userPicks: UserPicksDoc | null; userPicksEtag: string | null; frozen: Record<string, FrozenAsset>; facts: FactSheet | null;
  clipSegments: ScriptSegment[]; readOnly: boolean;
}

const mediaUrl = (slug: string, rel: string) => `/api/projects/${slug}/media/${rel}`;

export function LicenseBadge({ license }: { license: LicenseInfo | null }) {
  if (!license) return <Badge>?</Badge>;
  const tone = license.code === "UNKNOWN" ? "red" : !license.commercialOk || license.restrictions.includes("fair-use-user-risk") ? "amber" : "green";
  return (
    <Badge tone={tone} title={license.attributionText ?? undefined}>
      {license.code}
    </Badge>
  );
}

function Thumb({ slug, asset }: { slug: string; asset: FrozenAsset | null }) {
  if (!asset) return <div className="flex aspect-video items-center justify-center rounded bg-neutral-800 text-xs text-neutral-500">—</div>;
  if (asset.kind === "video") return <video className="aspect-video w-full rounded bg-black object-cover" src={`${mediaUrl(slug, asset.projectRel)}#t=0.5`} preload="metadata" muted />;
  if (asset.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="aspect-video w-full rounded bg-black object-cover" src={mediaUrl(slug, asset.projectRel)} alt="" loading="lazy" />;
  return <div className="flex aspect-video items-center justify-center rounded bg-neutral-800 text-xs">♪</div>;
}

export function SceneBoard(d: SceneData) {
  const { t } = useI18n();
  const router = useRouter();
  const slug = d.project.slug;
  const [userPicks, setUserPicks] = useState<UserPicksDoc>(d.userPicks ?? { schemaVersion: 1, picks: [], portraits: [], clips: [] });
  const [upEtag, setUpEtag] = useState<string | null>(d.userPicksEtag);
  const [slices, setSlices] = useState<BeatSlicesDoc | null>(d.slices);
  const [slEtag, setSlEtag] = useState<string | null>(d.slicesEtag);
  const [picker, setPicker] = useState<{ plan: BeatPlan; slot: number } | null>(null);
  const [motionOpen, setMotionOpen] = useState<string | null>(null);
  const [motionText, setMotionText] = useState("");
  const [issues, setIssues] = useState<LintIssueLike[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ro = d.readOnly;

  const textBy = useMemo(() => new Map((slices?.texts ?? []).map((x) => [x.beatId, x])), [slices]);
  const picksBy = useMemo(() => {
    const m = new Map<string, AssetPick[]>();
    for (const p of d.picks?.picks ?? []) m.set(p.beatId, [...(m.get(p.beatId) ?? []), p].sort((a, b) => a.slot - b.slot));
    // unsaved user picks override the last stage output per (beat, slot)
    for (const u of userPicks.picks) {
      const cur = (m.get(u.beatId) ?? []).filter((p) => p.slot !== u.slot);
      m.set(u.beatId, [...cur, u].sort((a, b) => a.slot - b.slot));
    }
    return m;
  }, [d.picks, userPicks]);
  const chapters = useMemo(() => {
    const m = new Map<string, BeatPlan[]>();
    for (const p of [...d.plans].sort((a, b) => a.order - b.order)) m.set(p.chapterId, [...(m.get(p.chapterId) ?? []), p]);
    return [...m.entries()];
  }, [d.plans]);
  const orphans = d.picks?.orphans ?? [];

  const redirect = async () => {
    const r = await submitJob(slug, { kind: "pipeline", from: "assets", to: "direct", langs: [] });
    setInfo(t("scenes.redirect", { n: 1 }) + (r.coalesced ? " (coalesced)" : ""));
  };
  const saveUserPicks = async (next: UserPicksDoc) => {
    const r = await putDoc(slug, P.userPicks, next, upEtag);
    setUpEtag(r.etag);
    setUserPicks(next);
    setIssues(r.issues);
    await redirect();
  };
  const usePick = async (plan: BeatPlan, slot: number, asset: FrozenAsset, score: CandidateScore | null, freezeIssues: LintIssueLike[]) => {
    const pick: AssetPick = {
      beatId: plan.id, slot, assetId: asset.id, role: slot === 0 ? "primary" : "alt", focal: { x: 0.5, y: 0.45 }, crop: null,
      sourceInMs: null, sourceOutMs: null, score: score ?? ZERO_SCORE, pickedBy: "user", planKey: plan.planKey,
    };
    await saveUserPicks({ ...userPicks, picks: [...userPicks.picks.filter((p) => !(p.beatId === plan.id && p.slot === slot)), pick] });
    setIssues((cur) => [...freezeIssues, ...cur]);
    setPicker(null);
    router.refresh();
  };
  const reapply = async (o: AssetPick) => {
    const plan = d.plans.find((p) => p.id === o.beatId);
    if (!plan) return;
    try {
      await saveUserPicks({ ...userPicks, picks: [...userPicks.picks.filter((p) => !(p.beatId === o.beatId && p.slot === o.slot)), { ...o, planKey: plan.planKey, pickedBy: "user" }] });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const discard = async (o: AssetPick) => {
    try {
      await saveUserPicks({ ...userPicks, picks: userPicks.picks.filter((p) => !(p.beatId === o.beatId && p.slot === o.slot && p.assetId === o.assetId)) });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const motion = motionOpen ? (() => {
    const plan = d.plans.find((p) => p.id === motionOpen)!;
    return { plan, check: checkMotionData(plan.motionTemplate, motionText, d.facts) };
  })() : null;
  const saveMotion = async () => {
    if (!motion?.check.ok || !slices) return;
    setError(null);
    try {
      const next: BeatSlicesDoc = { ...slices, updatedAt: new Date().toISOString(), texts: slices.texts.map((x) => (x.beatId === motion.plan.id ? { ...x, motionData: motion.check.value! } : x)) };
      const r = await putDoc(slug, P.beatSlices(d.lang), next, slEtag);
      setSlices(next);
      setSlEtag(r.etag);
      setIssues(r.issues);
      setMotionOpen(null);
      const j = await submitJob(slug, { kind: "stage", stage: "direct", langs: [d.lang] });
      setInfo(t("scenes.redirect", { n: 1 }) + (j.coalesced ? " (coalesced)" : ""));
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!d.plans.length) return <p className="text-neutral-500">{t("scenes.noPlans")}</p>;
  return (
    <div className="space-y-4">
      {ro ? <Banner tone="blue">{t("common.readOnlyJob")}</Banner> : null}
      {info ? <Banner tone="green">{info}</Banner> : null}
      <ErrorText error={error} />
      {issues.length ? (
        <Card title={t("scenes.issues")}>
          <IssueList issues={issues} />
        </Card>
      ) : null}
      {orphans.length ? (
        <Card title={t("scenes.orphans")}>
          <p className="mb-2 text-xs text-neutral-400">{t("scenes.orphansHint")}</p>
          <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {orphans.map((o) => (
              <li key={`${o.beatId}-${o.slot}-${o.assetId}`} className="space-y-1 text-xs">
                <Thumb slug={slug} asset={d.frozen[o.assetId] ?? null} />
                <p className="font-mono">
                  {o.beatId} · {t("scenes.slot", { n: o.slot })}
                </p>
                <div className="flex gap-1">
                  <Button size="sm" disabled={ro || !d.plans.some((p) => p.id === o.beatId)} onClick={() => void reapply(o)}>
                    {t("scenes.reapply")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={ro} onClick={() => void discard(o)}>
                    {t("scenes.discard")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {chapters.map(([chId, plans]) => (
        <Card key={chId} title={chId}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const tx: BeatLang | undefined = textBy.get(plan.id);
              const picks = picksBy.get(plan.id) ?? [];
              const slots = Math.max(1, picks.length, plan.motionTemplate === "photo_burst" ? Number((tx?.motionData as { count?: number } | undefined)?.count ?? 3) : 1);
              const clip = plan.origin === "clip" ? d.picks?.clips.find((c) => c.segmentId === plan.segmentId) ?? null : null;
              return (
                <article key={plan.id} className="space-y-2 rounded-md border border-neutral-800 p-3 text-sm" data-testid={`beat-${plan.id}`}>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono text-neutral-500">{plan.id}</span>
                    <Badge tone="blue">{plan.visualKind.replace(/_/g, " ")}</Badge>
                    <Badge>{plan.purpose}</Badge>
                    <span className="text-neutral-500">E{plan.energy}</span>
                    {plan.motionTemplate !== "none" ? <Badge tone="violet">{plan.motionTemplate}</Badge> : null}
                  </div>
                  <p className="text-neutral-200">{tx?.text || <span className="italic text-neutral-500">{plan.origin}</span>}</p>
                  {tx?.onScreenText ? <p className="text-xs font-bold uppercase text-amber-300">{tx.onScreenText}</p> : null}
                  <p className="text-xs text-neutral-500">🔍 {plan.visualQuery}</p>
                  {plan.cueTags.length ? (
                    <div className="flex flex-wrap gap-1">
                      {plan.cueTags.map((c, i) => (
                        <span key={i} className="rounded bg-neutral-800 px-1 font-mono text-[10px] text-neutral-300">
                          {c.type}
                          {c.value ? `:${c.value}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: slots }, (_, slot) => {
                      const pk = picks.find((p) => p.slot === slot) ?? null;
                      const asset = pk ? d.frozen[pk.assetId] ?? null : null;
                      return (
                        <div key={slot} className="space-y-1">
                          <Thumb slug={slug} asset={asset} />
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-neutral-500">{t("scenes.slot", { n: slot })}</span>
                            <LicenseBadge license={asset?.candidate?.license ?? (asset?.declaration ? { code: asset.declaration.license ?? (asset.declaration.kind === "own-work" ? "USER-OWNED" : asset.declaration.kind === "ai-generated" ? "AI-GENERATED" : "UNKNOWN"), version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [] } : null)} />
                            {pk?.pickedBy === "user" ? <Badge tone="amber">user</Badge> : null}
                            <Button size="sm" variant="ghost" className="ml-auto" disabled={ro || plan.origin === "clip"} onClick={() => setPicker({ plan, slot })}>
                              {t("scenes.change")}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {plan.origin === "clip" ? <ClipResolver slug={slug} project={d.project} segmentId={plan.segmentId} clip={clip} disabled={ro} onResolved={() => void redirect().then(() => router.refresh())} /> : null}
                  {plan.motionTemplate !== "none" && tx ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ro}
                      onClick={() => {
                        setMotionText(JSON.stringify(tx.motionData, null, 2));
                        setMotionOpen(plan.id);
                      }}
                    >
                      {t("scenes.motionData")}
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Card>
      ))}
      <Modal
        open={motionOpen !== null}
        onClose={() => setMotionOpen(null)}
        title={`${t("scenes.motionData")} — ${motionOpen ?? ""} (${motion?.plan.motionTemplate ?? ""})`}
        footer={
          <Button variant="primary" disabled={!motion?.check.ok} onClick={saveMotion}>
            {t("common.save")}
          </Button>
        }
      >
        <textarea className={cx(inputCls, "min-h-72 font-mono text-xs")} value={motionText} onChange={(e) => setMotionText(e.target.value)} spellCheck={false} />
        {motion && !motion.check.ok ? (
          <ul className="mt-2 space-y-0.5 text-xs text-red-400">
            <li className="font-semibold">{t("scenes.motionInvalid")}</li>
            {motion.check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
      </Modal>
      {picker ? <AssetPicker slug={slug} plan={picker.plan} slot={picker.slot} onClose={() => setPicker(null)} onPicked={usePick} /> : null}
    </div>
  );
}

function AssetPicker({ slug, plan, slot, onClose, onPicked }: { slug: string; plan: BeatPlan; slot: number; onClose: () => void; onPicked: (plan: BeatPlan, slot: number, asset: FrozenAsset, score: CandidateScore | null, issues: LintIssueLike[]) => Promise<void> }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"stored" | "live" | "upload">("stored");
  const [stored, setStored] = useState<{ candidate: CandidateRecord["candidate"]; score: CandidateScore | null }[] | null>(null);
  const [storedErr, setStoredErr] = useState<string | null>(null);
  const [q, setQ] = useState(plan.visualQuery);
  const [kind, setKind] = useState<"image" | "video">(plan.visualKind === "news_footage" || plan.visualKind === "stock_broll" ? "video" : "image");
  const [providers, setProviders] = useState<AssetProviderId[]>(["openverse", "wikimedia", "internet-archive", "nasa", "loc"]);
  const [allowPaid, setAllowPaid] = useState(false);
  const [results, setResults] = useState<CandidateRecord[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ records: { candidate: CandidateRecord["candidate"]; score: CandidateScore | null }[] }>(`/api/projects/${slug}/assets/candidates/${plan.id}`)
      .then((r) => setStored(r.records))
      .catch((e) => {
        setStored([]);
        setStoredErr(errorText(e));
      });
  }, [slug, plan.id]);

  const search = async () => {
    const paid = providers.filter((p) => PAID_PROVIDERS.includes(p));
    if (paid.length && !window.confirm(t("scenes.paidConfirm", { usd: PAID_CALL_USD.toFixed(3) }))) return;
    setBusy("search");
    setError(null);
    try {
      const qs = new URLSearchParams({ beat: plan.id, q, kind, providers: providers.join(","), allowPaid: allowPaid && paid.length ? "1" : "0" });
      setResults(await api<CandidateRecord[]>(`/api/projects/${slug}/assets/search?${qs}`));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const choose = async (c: CandidateRecord["candidate"], score: CandidateScore | null) => {
    setBusy(`${c.provider}:${c.providerAssetId}`);
    setError(null);
    try {
      // only the reference is sent: the server re-derives the candidate and its licence
      const r = await api<{ asset: FrozenAsset; issues: LintIssueLike[] }>(`/api/projects/${slug}/assets/freeze`, { method: "POST", json: { beatId: plan.id, slot, provider: c.provider, providerAssetId: c.providerAssetId } });
      if (r.issues.some((i) => i.level === "error")) {
        setError(r.issues.map((i) => i.msg).join("; "));
        return;
      }
      await onPicked(plan, slot, r.asset, score, r.issues);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const Grid = ({ items }: { items: { candidate: CandidateRecord["candidate"]; score: CandidateScore | null }[] }) => (
    <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(({ candidate: c, score }) => (
        <li key={`${c.provider}:${c.providerAssetId}`} className="space-y-1 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.previewUrl ? <img src={c.previewUrl} alt={c.title} className="aspect-video w-full rounded bg-black object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <div className="aspect-video rounded bg-neutral-800" />}
          <p className="line-clamp-2 text-neutral-300" title={c.description}>
            {c.title}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Badge>{c.provider}</Badge>
            <LicenseBadge license={c.license} />
            {score ? <span className="text-neutral-500">{Math.round(score.total * 100)}%</span> : null}
            {c.width ? <span className="text-neutral-600">{c.width}×{c.height}</span> : null}
          </div>
          <Button size="sm" variant="primary" busy={busy === `${c.provider}:${c.providerAssetId}`} disabled={busy !== null} onClick={() => void choose(c, score)}>
            {t("scenes.useAsSlot", { n: slot })}
          </Button>
        </li>
      ))}
    </ul>
  );
  return (
    <Modal open onClose={onClose} title={`${t("scenes.picker")} — ${plan.id} · ${t("scenes.slot", { n: slot })}`}>
      <Tabs tabs={[{ key: "stored", label: t("scenes.stored") }, { key: "live", label: t("scenes.live") }, { key: "upload", label: t("scenes.upload") }]} value={tab} onChange={setTab} />
      <div className="mt-3 space-y-3">
        {tab === "stored" ? (stored === null ? <p className="text-sm text-neutral-500">{t("common.loading")}</p> : stored.length ? <Grid items={stored} /> : <p className="text-sm text-neutral-500">{storedErr ?? t("common.none")}</p>) : null}
        {tab === "live" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <input className={cx(inputCls, "flex-1")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
              <select className={cx(inputCls, "w-28")} value={kind} onChange={(e) => setKind(e.target.value as "image" | "video")}>
                <option value="image">image</option>
                <option value="video">video</option>
              </select>
              <Button variant="primary" busy={busy === "search"} onClick={search} disabled={!q.trim() || !providers.length}>
                {t("common.search")}
              </Button>
            </div>
            <Field label={t("scenes.providers")}>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {[...FREE_PROVIDERS, ...(allowPaid ? PAID_PROVIDERS : [])].map((p) => (
                  <label key={p} className="flex items-center gap-1">
                    <input type="checkbox" className="accent-amber-500" checked={providers.includes(p)} onChange={(e) => setProviders((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} />
                    {p}
                    {PAID_PROVIDERS.includes(p) ? " $" : ""}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" className="accent-amber-500" checked={allowPaid} onChange={(e) => { setAllowPaid(e.target.checked); if (!e.target.checked) setProviders((cur) => cur.filter((p) => !PAID_PROVIDERS.includes(p))); }} />
              {t("scenes.allowPaid")}
            </label>
            {results ? results.length ? <Grid items={results} /> : <p className="text-sm text-neutral-500">{t("common.none")}</p> : null}
          </>
        ) : null}
        {tab === "upload" ? (
          <UploadForm
            slug={slug}
            accept="image/*,video/*"
            onUploaded={async (r) => {
              if (r.asset) await onPicked(plan, slot, r.asset, null, []);
            }}
          />
        ) : null}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function ClipResolver({ slug, project, segmentId, clip, disabled, onResolved }: { slug: string; project: Project; segmentId: string; clip: ClipResolution | null; disabled: boolean; onResolved: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState(clip?.youtube?.url ?? "");
  const [inS, setInS] = useState(clip?.youtube?.startMs != null ? clip.youtube.startMs / 1000 : 0);
  const [outS, setOutS] = useState(clip?.youtube?.endMs != null ? clip.youtube.endMs / 1000 : 10);
  const [channel, setChannel] = useState(clip?.youtube?.channel ?? "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [decl, setDecl] = useState({ kind: "third-party-quotation" as const, license: null, author: "", url: "", note: "" } as Parameters<typeof DeclarationForm>[0]["value"]);
  const [fairUse, setFairUse] = useState(false);
  const [fairAck, setFairAck] = useState(project.editorial.fairUseAcknowledged);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<LintIssueLike[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isYoutube = /(^|\.)youtube\.com|youtu\.be/.test(url);
  const submit = async (ack = fairAck) => {
    // §17.3: the fair-use notice is shown (and acknowledged) before the first YouTube download
    if (mode === "url" && isYoutube && !ack) return setFairUse(true);
    setBusy(true);
    setError(null);
    try {
      let uploadRel: string | null = null;
      if (mode === "file" && file) {
        const r = await uploadFile(`/api/projects/${slug}/upload?kind=asset`, file, { declaration: JSON.stringify(decl) }, () => {});
        uploadRel = r.asset?.projectRel ?? r.rel;
      }
      const r = await api<{ issues: LintIssueLike[] }>(`/api/projects/${slug}/clips/resolve`, {
        method: "POST",
        json: { segmentId, url: mode === "url" ? url : null, uploadRel, startMs: Math.round(inS * 1000), endMs: Math.round(outS * 1000), channel, title },
      });
      setIssues(r.issues);
      setOpen(false);
      onResolved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded border border-sky-900 p-2 text-xs">
      <div className="flex items-center gap-2">
        <Badge tone="blue">{t("scenes.clip")}</Badge>
        <span className="font-mono">{segmentId}</span>
        <Badge tone={clip?.status === "found" || clip?.status === "manual" ? "green" : "amber"}>{clip?.status ?? "—"}</Badge>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={disabled} onClick={() => setOpen((o) => !o)}>
          {t("scenes.clipResolve")}
        </Button>
      </div>
      {clip?.reason ? <p className="mt-1 text-neutral-500">{clip.reason}</p> : null}
      {open ? (
        <div className="mt-2 grid gap-2">
          <div className="flex gap-3">
            <label className="flex items-center gap-1"><input type="radio" checked={mode === "url"} onChange={() => setMode("url")} className="accent-amber-500" />URL</label>
            <label className="flex items-center gap-1"><input type="radio" checked={mode === "file"} onChange={() => setMode("file")} className="accent-amber-500" />{t("scenes.upload")}</label>
          </div>
          {mode === "url" ? (
            <input className={inputCls} placeholder={t("scenes.clipUrl")} value={url} onChange={(e) => setUrl(e.target.value)} />
          ) : (
            <>
              <input type="file" accept="video/*,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <DeclarationForm value={decl} onChange={setDecl} />
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("scenes.clipIn")}><input type="number" step="0.1" min={0} className={inputCls} value={inS} onChange={(e) => setInS(Number(e.target.value))} /></Field>
            <Field label={t("scenes.clipOut")}><input type="number" step="0.1" min={0} className={inputCls} value={outS} onChange={(e) => setOutS(Number(e.target.value))} /></Field>
            <Field label={t("scenes.clipChannel")}><input className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)} /></Field>
            <Field label={t("scenes.clipTitle")}><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          </div>
          <Button size="sm" variant="primary" busy={busy} disabled={outS <= inS || (mode === "url" ? !url.trim() : !file || !declarationValid(decl))} onClick={() => void submit()}>
            {t("scenes.clipSave")}
          </Button>
          <ErrorText error={error} />
        </div>
      ) : null}
      <IssueList issues={issues} />
      <FairUseDialog
        open={fairUse}
        onClose={() => setFairUse(false)}
        onAccept={async () => {
          setFairUse(false);
          try {
            await api(`/api/projects/${slug}/approvals`, { method: "POST", json: { gate: "fair-use", stage: "assets", lang: null, note: "", items: [], itemNotes: {} } });
            setFairAck(true);
            await submit(true);
          } catch (e) {
            setError(errorText(e));
          }
        }}
      />
    </div>
  );
}
