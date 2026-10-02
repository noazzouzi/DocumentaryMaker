# Legal notes (summary — not legal advice)

DocumentaryMaker reduces editorial and licensing risk; it does not remove it. You are responsible for what you publish.

## Third-party clips (fair use / droit de citation) — shown before the first YouTube download

> **EN.** Downloading YouTube videos may breach YouTube's Terms of Service, and using third-party footage relies on fair use / fair dealing / the right of quotation, which depends on your jurisdiction. In France, the *droit de citation* is narrower than US fair use. DocumentaryMaker runs yt-dlp **on your machine at your request**. Keep clips short and directly commented on, and credit the source. A "Source:" label is not a legal shield. You are responsible for the use you make of the clips.
>
> **FR.** Télécharger des vidéos YouTube peut enfreindre les conditions d'utilisation de YouTube, et l'usage d'extraits relève du droit de citation, plus étroit en France que le *fair use* américain. DocumentaryMaker exécute yt-dlp **sur votre machine, à votre demande**. Gardez les extraits courts et commentés, et citez la source. La mention « Source : » ne constitue pas une protection juridique. Vous êtes responsable de l'usage des extraits.

Clips default to ≤ 20 s; every clip is logged (URL, channel, timecodes, transcript kind) in the ledger and the credits.

## Remotion licence

Remotion is free for individuals, for-profit organisations of ≤ 3 people and non-profits; other organisations need a Company License. The `<Player>` and server-side rendering count as automation APIs. The tool never decides for you: onboarding asks you to choose and stores your answer; `REMOTION_LICENSE_KEY` is passed when set.

## People, AI images and defamation safeguards

- No photorealistic AI images of real people (blocked at beat validation, at the fal provider and at every pick, override and upload). AI images carry an on-frame `ILLUSTRATION` label.
- Private persons and minors are never named on screen, searched or shown; non-public persons need a per-person approval.
- On-screen quotes, headlines and numbers are bound to fact-sheet references and fact-checked like the narration; editorial gates cannot be bypassed with `--yes`.
- Claim statuses (allegation, charged, convicted…) carry a jurisdiction and an `as_of` date; pending statuses older than 30 days need a recheck before render/export.

See `NOTICE.md` for licences and attributions.
