// Licence mapping (provider strings → LicenseInfo), attribution text and the LicensePolicyEngine (§7.4 matrix).
import type { CueType, LicenseCode, LicenseInfo, LicensePolicy, LicenseRestriction, UploadDeclaration } from "@docmaker/core";

const CC_URL: Partial<Record<LicenseCode, string>> = {
  "CC-BY": "by", "CC-BY-SA": "by-sa", "CC-BY-NC": "by-nc", "CC-BY-ND": "by-nd", "CC-BY-NC-SA": "by-nc-sa", "CC-BY-NC-ND": "by-nc-nd",
};

export const LICENSE_LABEL: Record<LicenseCode, string> = {
  CC0: "CC0", PDM: "Public Domain", "CC-BY": "CC BY", "CC-BY-SA": "CC BY-SA", "CC-BY-NC": "CC BY-NC", "CC-BY-ND": "CC BY-ND",
  "CC-BY-NC-SA": "CC BY-NC-SA", "CC-BY-NC-ND": "CC BY-NC-ND", PEXELS: "Pexels License", PIXABAY: "Pixabay Content License",
  UNSPLASH: "Unsplash License", "AI-GENERATED": "AI-generated", "YOUTUBE-FAIR-USE": "Fair use / quotation (YouTube)",
  PROCEDURAL: "Procedural (generated)", "USER-OWNED": "Own work", UNKNOWN: "Rights unknown", "PROVIDER-TERMS": "Provider terms",
};

/** Builds a complete LicenseInfo for a code (+ extra restrictions). */
export function licenseInfo(code: LicenseCode, o?: { version?: string | null; url?: string | null; attributionText?: string | null; restrictions?: LicenseRestriction[] }): LicenseInfo {
  const version = o?.version ?? null;
  const restrictions = new Set<LicenseRestriction>(o?.restrictions ?? []);
  let commercialOk = true;
  let derivativesOk = true;
  let attributionRequired = false;
  if (code.startsWith("CC-BY")) attributionRequired = true;
  if (code.includes("-NC")) { commercialOk = false; restrictions.add("nc"); }
  if (code.endsWith("-ND")) { derivativesOk = false; restrictions.add("nd"); }
  if (code.endsWith("-SA")) restrictions.add("sa");
  switch (code) {
    case "PEXELS":
    case "PIXABAY":
    case "UNSPLASH":
      restrictions.add("no-bad-light");
      restrictions.add("no-redistribution");
      if (code === "PEXELS") restrictions.add("trademark");
      break;
    case "UNKNOWN":
      commercialOk = false;
      restrictions.add("unknown-rights");
      restrictions.add("editorial-only");
      break;
    case "YOUTUBE-FAIR-USE":
      commercialOk = false;
      derivativesOk = true;
      attributionRequired = true;
      restrictions.add("fair-use-user-risk");
      break;
    case "AI-GENERATED":
      restrictions.add("synthetic");
      break;
    default:
      break;
  }
  let url = o?.url ?? null;
  if (!url && CC_URL[code]) url = `https://creativecommons.org/licenses/${CC_URL[code]}/${version ?? "4.0"}/`;
  if (!url && code === "CC0") url = "https://creativecommons.org/publicdomain/zero/1.0/";
  if (!url && code === "PDM") url = "https://creativecommons.org/publicdomain/mark/1.0/";
  if (!url && code === "PEXELS") url = "https://www.pexels.com/license/";
  if (!url && code === "PIXABAY") url = "https://pixabay.com/service/license-summary/";
  return {
    code, version, url, commercialOk, derivativesOk, attributionRequired, attributionText: o?.attributionText ?? null,
    restrictions: [...restrictions].sort(),
  };
}

/**
 * Parses licence strings from providers: Openverse codes ("by-sa", "cc0", "pdm"), Commons LicenseShortName ("CC BY-SA 4.0",
 * "Public domain", "CC0"), licence URLs (creativecommons.org/licenses/by/2.0/, publicdomain/mark|zero/1.0). Unknown → null.
 */
export function parseCcLicense(raw: string | null | undefined, versionHint?: string | null): { code: LicenseCode; version: string | null } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  const urlM = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?(\d+(\.\d+)?)?/.exec(s);
  if (urlM) {
    if (urlM[1] === "publicdomain") return { code: urlM[2] === "zero" ? "CC0" : "PDM", version: urlM[3] ?? null };
    if (urlM[2] === "publicdomain") return { code: "PDM", version: null }; // legacy creativecommons.org/licenses/publicdomain/
    return ccFromParts(urlM[2]!, urlM[3] ?? versionHint ?? null);
  }
  if (/^(cc0|cc-0|cc zero|cc0 1\.0|cc0-1\.0)/.test(s) || s === "cc-zero") return { code: "CC0", version: "1.0" };
  if (/^(pdm|public ?domain|pd(-|\s|$)|no restrictions|no known (copyright )?restrictions)/.test(s) || /^pd-/.test(s)) return { code: "PDM", version: null };
  // The licence parts must end the string or be followed by a version: free text ("by permission of…", "byline") is not a licence.
  const m = /^(?:cc[\s-]*)?(by(?:[\s-](?:nc|sa|nd))*)(?=[\s-]*$|[\s-]*\d)(?:[\s-]*(\d+(?:\.\d+)?))?/.exec(s.replace(/_/g, "-"));
  if (m) return ccFromParts(m[1]!, m[2] ?? versionHint ?? null);
  return null;
}

function ccFromParts(parts: string, version: string | null): { code: LicenseCode; version: string | null } | null {
  const p = parts.replace(/\s+/g, "-");
  const has = (x: string) => p.split("-").includes(x);
  if (!p.startsWith("by")) return null;
  const nc = has("nc");
  const sa = has("sa");
  const nd = has("nd");
  let code: LicenseCode;
  if (nc && nd) code = "CC-BY-NC-ND";
  else if (nc && sa) code = "CC-BY-NC-SA";
  else if (nc) code = "CC-BY-NC";
  else if (nd) code = "CC-BY-ND";
  else if (sa) code = "CC-BY-SA";
  else code = "CC-BY";
  return { code, version };
}

/** Ready-to-print credit line: `"<title>" by <author> — <licence + version> — <url>` (fields omitted when unknown). */
export function attributionText(i: { title: string; author: string | null; license: Pick<LicenseInfo, "code" | "version">; sourcePageUrl: string | null }): string {
  const parts: string[] = [];
  const title = i.title.trim();
  parts.push(title ? `"${title}"${i.author ? ` by ${i.author}` : ""}` : i.author ? `by ${i.author}` : "Untitled");
  parts.push(`${LICENSE_LABEL[i.license.code]}${i.license.version ? ` ${i.license.version}` : ""}`);
  if (i.sourcePageUrl) parts.push(i.sourcePageUrl);
  return parts.join(" — ");
}

/** LicenseInfo of a user upload / local import from its declaration. Never defaulted (the declaration is mandatory). */
export function declarationLicense(d: UploadDeclaration): LicenseInfo {
  switch (d.kind) {
    case "own-work":
      return licenseInfo("USER-OWNED", { attributionText: d.author ? `Own work by ${d.author}` : null });
    case "licensed": {
      const code = d.license ?? "UNKNOWN";
      const base = licenseInfo(code === "USER-OWNED" ? "UNKNOWN" : code, { url: d.url || null });
      return { ...base, attributionText: d.author ? `${d.author} — ${LICENSE_LABEL[base.code]}${d.url ? ` — ${d.url}` : ""}` : null };
    }
    case "third-party-quotation":
      return licenseInfo("UNKNOWN", { restrictions: ["editorial-only", "fair-use-user-risk"], url: d.url || null, attributionText: d.author ? `${d.author}${d.url ? ` — ${d.url}` : ""}` : null });
    case "ai-generated":
      return licenseInfo("AI-GENERATED", { attributionText: d.author ? `AI-generated (${d.author})` : "AI-generated" });
  }
}

export interface PolicyVerdict { allowed: boolean; reasons: string[]; flags: string[] }

/** §7.4 matrix. `monetized` is the conservative OR of editorial.monetized and licensePolicy.mode. */
export class LicensePolicyEngine {
  readonly policy: LicensePolicy;
  readonly ctx: { monetized: boolean; fairUseAcknowledged: boolean };
  constructor(policy: LicensePolicy, ctx: { monetized: boolean; fairUseAcknowledged: boolean }) {
    this.policy = policy;
    this.ctx = ctx;
  }
  get monetized(): boolean {
    return this.ctx.monetized || this.policy.mode === "monetized";
  }
  evaluate(license: LicenseInfo, beat: { personIds: string[]; cueTypes: CueType[] } | null): PolicyVerdict {
    const p = this.policy;
    const reasons: string[] = [];
    const flags = new Set<string>(license.restrictions);
    let allowed = true;
    const deny = (r: string) => {
      allowed = false;
      reasons.push(r);
    };
    const code = license.code;
    const nc = code.includes("-NC") || license.restrictions.includes("nc");
    const nd = code.endsWith("-ND") || license.restrictions.includes("nd");
    const sa = code.endsWith("-SA") || license.restrictions.includes("sa");
    if (sa) {
      flags.add("sa");
      if (this.monetized && !p.allowShareAlike) deny(`${code}: share-alike licences are disabled (allowShareAlike=false)`);
    }
    if (nc) {
      flags.add("nc");
      if (this.monetized && !p.allowNonCommercial) deny(`${code}: non-commercial licence on a monetized project`);
    }
    if (nd) {
      flags.add("nd");
      if (!p.allowNoDerivatives) deny(`${code}: no-derivatives licence (we crop, zoom and grade)`);
    }
    switch (code) {
      case "PEXELS":
      case "PIXABAY":
      case "UNSPLASH":
        flags.add("no-bad-light");
        break;
      case "UNKNOWN":
        flags.add("editorial-only");
        if (!p.allowUnknownEditorial) deny("rights unknown (allowUnknownEditorial=false)");
        break;
      case "YOUTUBE-FAIR-USE":
        flags.add("fair-use-user-risk");
        if (!p.allowYoutubeFairUse) deny("YouTube fair-use clips are disabled (allowYoutubeFairUse=false)");
        else if (!this.ctx.fairUseAcknowledged) deny("the fair-use notice has not been acknowledged");
        break;
      case "AI-GENERATED":
        flags.add("synthetic");
        if (!p.allowAiGenerated) deny("AI-generated images are disabled (allowAiGenerated=false)");
        if (beat && beat.personIds.length > 0) deny("AI-generated image on a beat about real people");
        break;
      case "PROVIDER-TERMS":
        break;
      default:
        break;
    }
    if (license.restrictions.includes("personality")) flags.add("personality");
    return { allowed, reasons, flags: [...flags].sort() };
  }
}
