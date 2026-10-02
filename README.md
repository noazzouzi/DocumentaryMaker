# DocumentaryMaker

**Fabriquez des documentaires narrés de 15 à 30 minutes et plus à partir d'une simple idée** — par exemple « La rupture catastrophique de Johnny Depp » — avec recherche sourcée, script, voix off, montage automatique et export vers votre logiciel de montage.

> **État du projet.** Les fondations sont en place : monorepo, contrat de données complet (`packages/core`), stubs d'API pour tous les paquets, rendu Remotion de démonstration et squelette de l'application web. Les paquets fonctionnels (LLM, assets, voix, audio, réalisateur, rendu, export, moteur, interface web) sont en cours de construction ; la commande `docmaker demo --offline` sera opérationnelle à la fin de la phase d'intégration. La spécification complète se trouve dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Ce que fait l'application

1. **Recherche** avec Claude (recherche et lecture web) : un dossier cité, un registre de sources limité aux URL réellement renvoyées par l'API, et une fiche de faits structurée (personnes, événements, citations, chiffres, allégations avec statut juridique, juridiction et date).
2. **Style** : suggestion immédiate et hors ligne d'un style de montage (v1 : `drama-commentary`), que vous confirmez.
3. **Plan puis script**, écrits nativement en français et/ou en anglais, chapitre par chapitre, avec un budget de durée calculé et un contrôle déterministe (formulations accusatoires, attribution, rythme).
4. **Beats** : chaque idée visuelle est une tranche exacte de la narration ; chaque citation, titre ou chiffre affiché à l'écran est relié à la fiche de faits.
5. **Vérification des faits** de la narration *et* du texte à l'écran, avec des validations humaines obligatoires.
6. **Assets** sous licence (Openverse, Wikimedia Commons, Internet Archive, NASA, LOC, Pexels, Pixabay, imports locaux, générateur procédural, extraits YouTube via yt-dlp en local), avec un registre de licences et des crédits automatiques.
7. **Voix** : une prise « brouillon » gratuite, puis ElevenLabs, Kokoro/Piper en local, ou votre propre enregistrement aligné sur le script.
8. **Réalisation automatique** : un réalisateur déterministe compile le tout en une timeline (plans, Ken Burns, punch-ins, transitions, cartes de chapitre, sous-titres par mots-clés, design sonore, musique, ducking).
9. **Rendu** avec Remotion 4 (par morceaux, mis en cache) et mixage audio à −14 LUFS.
10. **Exports** : FCPXML 1.10 (Final Cut), xmeml (Premiere, Resolve), OTIO, marqueurs EDL, SRT, stems audio, kit de publication et rapport éditorial.

Deux interfaces : une **CLI** (`docmaker …`) et une **application web** Next.js 16 (aperçu avec le Player Remotion, suivi des tâches en direct).

## Démarrage rapide

Prérequis : Linux x64 ou macOS (Windows via WSL2), **Node.js 22.12+**, **pnpm 10**, **ffmpeg ≥ 6.1**. Python est optionnel.

```sh
pnpm install --frozen-lockfile
pnpm docmaker --version          # la CLI depuis les sources

# Démo complète, sans aucune clé ni réseau (disponible après la phase d'intégration) :
pnpm docmaker demo --offline     # ou : pnpm demo

# Application web (http://127.0.0.1:3210) :
pnpm dev:web
```

Le navigateur de rendu (Chrome Headless Shell) s'installe avec `pnpm docmaker setup --browser` ; vous pouvez aussi indiquer un exécutable existant avec `DOCMAKER_BROWSER_EXECUTABLE`.

Vérifications du dépôt : `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm smoke` (bundle + rendu de test + build web), `pnpm lint`.

## Clés d'API

Aucune clé n'est nécessaire pour la démo hors ligne. Pour un vrai projet, copiez [`.env.example`](.env.example) et renseignez uniquement ce dont vous avez besoin :

- `~/.documentarymaker/.env` (fichier canonique, permissions 0600 — `docmaker keys set <NOM>` l'écrit pour vous), ou
- `.env.local` à la racine du dépôt (pratique en développement ; ignoré par git).

Ordre de priorité : variables d'environnement > `~/.documentarymaker/.env` > `.env.local`. Les clés principales : `ANTHROPIC_API_KEY` (recherche et écriture), `ELEVENLABS_API_KEY` (voix), `PEXELS_API_KEY` / `PIXABAY_API_KEY` (stock gratuit). Les clés ne sont jamais écrites dans un projet, un log ou l'interface (affichage masqué).

## Architecture

```
packages/
  core/      schémas zod, interfaces, chemins, utilitaires (SHA-256 pur JS), ProjectStore — le contrat partagé
  styles/    styles de montage sous forme de dossiers de données (style.json, STYLE.md, GUIDE.md, prompts.json)
  llm/       client Claude, schémas « wire », prompts, étapes, lint de script, fixtures hors ligne
  assets/    fournisseurs, politique de licences, cache gelé, conformation, YouTube (yt-dlp local), crédits
  voice/     texte TTS, fournisseurs de voix, alignement, prises, import d'enregistrements
  audio/     pack SFX procédural, musique procédurale, assemblage VO, mixeur Node, loudness
  director/  horloge audio (layout) et réalisateur déterministe → Timeline
  remotion/  compositions et composants Remotion (navigateur uniquement)
  render/    bundle, rendu par morceaux, concaténation, mux, porte de loudness
  export/    FCPXML, xmeml, OTIO, EDL, SRT, bundle d'export
  engine/    étapes, hachage/obsolescence, validations, coûts, tâches, démo
apps/
  cli/       CLI `docmaker` + worker de tâches
  web/       application Next.js 16 (App Router)
```

Principes : **le moteur possède la timeline, le LLM ne remplit que des paramètres** (vocabulaires fermés) ; **l'audio est l'horloge** (tout est ancré sur des mots) ; **une seule timeline** alimente le rendu, l'aperçu, le mixage, les sous-titres et les exports ; **hors ligne d'abord** ; **le travail de l'utilisateur n'est jamais perdu** (historique des documents modifiés). Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ; notes de recherche : [`docs/RESEARCH.md`](docs/RESEARCH.md) ; environnement de développement : [`docs/DEV.md`](docs/DEV.md).

## Notes juridiques

- **Extraits tiers.** L'usage d'extraits YouTube relève du *fair use* (États-Unis) ou du **droit de citation** (France, plus restrictif). Télécharger des vidéos peut enfreindre les conditions d'utilisation de YouTube. yt-dlp s'exécute sur votre machine, à votre demande : gardez les extraits courts et commentés, citez la source. Une mention « Source : » n'est pas une protection juridique.
- **Licence Remotion.** Remotion est gratuit pour les particuliers, les organisations de 3 personnes au plus et les associations ; les autres structures ont besoin d'une licence entreprise. L'application vous demande votre situation et ne la choisit jamais à votre place. Vous restez responsable de votre licence Remotion.
- **Pas d'images IA de personnes réelles.** Les images générées par IA sont interdites pour toute personne réelle (blocage à plusieurs niveaux) et portent la mention « ILLUSTRATION ». Les personnes privées et les mineurs ne sont jamais nommés, recherchés ou montrés.
- Les garde-fous éditoriaux **réduisent** les risques (diffamation, droits) mais **ne constituent pas un conseil juridique**. Voir [`docs/LEGAL.md`](docs/LEGAL.md) et [`NOTICE.md`](NOTICE.md).

Code sous licence MIT ([`LICENSE`](LICENSE)) ; les dépendances et idées reprises conservent leurs licences ([`NOTICE.md`](NOTICE.md)).

---

## English summary

DocumentaryMaker turns an idea into a 15–30+ minute narrated documentary: sourced research with Claude, style suggestion, outline and script (French and/or English), beat planning tied to a fact sheet, a fact-check with human approval gates, licensed assets with automatic credits, voice-over (free scratch take, ElevenLabs, local Kokoro/Piper, or your own recording), a deterministic director that compiles everything into one word-anchored timeline, Remotion rendering with a loudness-normalised mix, and exports to Final Cut (FCPXML), Premiere/Resolve (xmeml), OTIO, EDL markers, SRT and stems. It ships as a CLI (`docmaker`) and a Next.js web app.

**Status:** the foundation is done (pnpm monorepo, the full core data contract, typed API stubs for every package, a placeholder Remotion composition that bundles and renders, a skeleton web app). The feature packages are being built; `docmaker demo --offline` (zero keys, no network) becomes functional after integration.

**Quick start:** Node 22.12+, pnpm 10, ffmpeg ≥ 6.1 → `pnpm install --frozen-lockfile`, `pnpm docmaker demo --offline`, `pnpm dev:web` (http://127.0.0.1:3210). Keys go in `~/.documentarymaker/.env` (or `.env.local` in the repo); see `.env.example`. None are needed for the offline demo.

**Legal:** third-party clips rely on fair use / the French *droit de citation* and are your responsibility; Remotion has its own licence (free for individuals and small teams, company licence otherwise — you choose, the tool never does); no AI images of real people; the safeguards reduce risk but are not legal advice. See `docs/LEGAL.md` and `NOTICE.md`. The full specification is `docs/ARCHITECTURE.md`.
