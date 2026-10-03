"use client";
// Doctor report table (ok / warn / error with the hint command).
import type { DoctorCheck } from "@docmaker/engine";
import { Badge } from "./ui";

export function DoctorList({ checks }: { checks: DoctorCheck[] }) {
  return (
    <ul className="divide-y divide-neutral-800 text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
          <Badge tone={c.ok ? "green" : c.level === "error" ? "red" : c.level === "warn" ? "amber" : "neutral"}>{c.ok ? "ok" : c.level}</Badge>
          <span className="font-mono text-xs text-neutral-300">{c.id}</span>
          <span className="min-w-0 flex-1 truncate text-neutral-400" title={c.value}>
            {c.value}
          </span>
          {c.hint ? <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-amber-300">{c.hint}</code> : null}
        </li>
      ))}
    </ul>
  );
}
