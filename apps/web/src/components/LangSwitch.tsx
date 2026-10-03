"use client";
// Switches the [lang] segment of a language-specific project page.
import Link from "next/link";
import type { Lang } from "@docmaker/core";
import { cx } from "./ui";

export function LangSwitch({ langs, current, hrefFor }: { langs: Lang[]; current: Lang; hrefFor: string }) {
  if (langs.length < 2) return null;
  return (
    <div className="flex overflow-hidden rounded-md border border-neutral-700 text-xs">
      {langs.map((l) => (
        <Link key={l} href={hrefFor.replace("{lang}", l)} className={cx("px-2.5 py-1 uppercase", l === current ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white")}>
          {l}
        </Link>
      ))}
    </div>
  );
}
