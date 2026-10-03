"use client";
// Project tabs; language-specific pages link to the primary language by default.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Lang } from "@docmaker/core";
import type { MessageKey } from "@/i18n";
import { useT } from "./I18nProvider";
import { cx } from "./ui";

export function ProjectNav({ slug, primary }: { slug: string; primary: Lang }) {
  const t = useT();
  const path = usePathname();
  const base = `/p/${slug}`;
  const tabs: [MessageKey, string][] = [
    ["project.tab.overview", base],
    ["project.tab.research", `${base}/research`],
    ["project.tab.outline", `${base}/outline`],
    ["project.tab.script", `${base}/script/${primary}`],
    ["project.tab.scenes", `${base}/scenes`],
    ["project.tab.voice", `${base}/voice/${primary}`],
    ["project.tab.preview", `${base}/preview/${primary}`],
    ["project.tab.render", `${base}/render`],
    ["project.tab.publish", `${base}/publish/${primary}`],
    ["project.tab.credits", `${base}/credits`],
  ];
  const active = (href: string) => {
    if (href === base) return path === base;
    const prefix = href.split("/").slice(0, 4).join("/");
    return path === href || path.startsWith(prefix + "/") || path === prefix;
  };
  return (
    <nav className="flex flex-wrap gap-1 border-b border-neutral-800 text-sm">
      {tabs.map(([k, href]) => (
        <Link key={k} href={href} className={cx("-mb-px border-b-2 px-3 py-2", active(href) ? "border-amber-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200")}>
          {t(k)}
        </Link>
      ))}
    </nav>
  );
}
