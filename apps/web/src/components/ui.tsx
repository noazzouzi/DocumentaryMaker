"use client";
// Small local UI kit (React + Tailwind only).
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-amber-500 text-neutral-950 hover:bg-amber-400 disabled:bg-amber-500/40",
  secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:text-neutral-500",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/40",
  ghost: "bg-transparent text-neutral-300 hover:bg-neutral-800 disabled:text-neutral-600",
};

export function Button({ variant = "secondary", size = "md", className, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        VARIANT[variant],
        className,
      )}
    >
      {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-neutral-800 bg-neutral-900/60", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-neutral-200">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";
const TONE: Record<Tone, string> = {
  neutral: "bg-neutral-800 text-neutral-300",
  green: "bg-emerald-900/60 text-emerald-300",
  amber: "bg-amber-900/50 text-amber-300",
  red: "bg-red-900/60 text-red-300",
  blue: "bg-sky-900/60 text-sky-300",
  violet: "bg-violet-900/60 text-violet-300",
};
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", TONE[tone])}>
      {children}
    </span>
  );
}

export function Banner({ tone = "amber", children, actions }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode; actions?: ReactNode }) {
  const t = { amber: "border-amber-700/60 bg-amber-950/40 text-amber-100", red: "border-red-700/60 bg-red-950/40 text-red-100", blue: "border-sky-700/60 bg-sky-950/40 text-sky-100", green: "border-emerald-700/60 bg-emerald-950/40 text-emerald-100" }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm", t)}>
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none disabled:opacity-60";

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(56rem,95vw)] rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-100 backdrop:bg-black/70">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-white" aria-label="close">
          ✕
        </button>
      </header>
      <div className="max-h-[70vh] overflow-y-auto p-4">{open ? children : null}</div>
      {footer ? <footer className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-3">{footer}</footer> : null}
    </dialog>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: ReactNode; badge?: ReactNode }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-neutral-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={t.key === value}
          onClick={() => onChange(t.key)}
          className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", t.key === value ? "border-amber-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200")}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  const p = Math.max(0, Math.min(1, pct));
  return (
    <div className="w-full" aria-label={label} role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
        <div className="h-full rounded bg-amber-500 transition-[width]" style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

export function IssueList({ issues, empty }: { issues: { level: "error" | "warn"; rule: string; where: string; msg: string }[]; empty?: ReactNode }) {
  if (!issues.length) return empty ? <p className="text-sm text-neutral-500">{empty}</p> : null;
  return (
    <ul className="space-y-1 text-sm">
      {issues.map((i, n) => (
        <li key={`${i.rule}-${i.where}-${n}`} className="flex gap-2">
          <Badge tone={i.level === "error" ? "red" : "amber"}>{i.level}</Badge>
          <span className="font-mono text-xs text-neutral-400">{i.where}</span>
          <span className="text-neutral-200">{i.msg}</span>
          <span className="ml-auto font-mono text-[10px] text-neutral-600">{i.rule}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-red-400">
      {error}
    </p>
  ) : null;
}
