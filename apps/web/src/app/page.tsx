// Home page (P0 skeleton; W11 replaces it). Server component that renders a client component importing the
// browser-safe Remotion package — this is what `pnpm smoke` builds with Next to prove the import graph works.
import { BUILTIN_FONT_FAMILIES } from "@docmaker/core";
import { Hello } from "../components/Hello";

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-10 font-sans">
      <h1 className="text-4xl font-black tracking-tight">DocumentaryMaker</h1>
      <p className="mt-2 text-neutral-400">Skeleton build — fonts: {BUILTIN_FONT_FAMILIES.join(", ")}</p>
      <Hello />
    </main>
  );
}
