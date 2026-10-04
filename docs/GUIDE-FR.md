# Guide pas à pas — « La rupture catastrophique de Johnny Depp » (25 min, français)

Ce guide fabrique un vrai documentaire de 25 minutes, de l'idée au fichier prêt à publier, de deux façons : **en ligne de commande** et **dans l'application web**. Les deux font exactement la même chose sur le même projet : vous pouvez commencer dans l'une et finir dans l'autre.

> **Raccourci : l'autopilote.** `pnpm docmaker auto "La rupture catastrophique de Johnny Depp" --lang fr --minutes 25` fait tout ce guide d'une traite, sans aucune validation manuelle (toutes sont automatiques et tracées « autopilot » ; les points de vérification sont validés tels quels, les citations introuvables réécrites en paraphrase attribuée), jusqu'au MP4 1080p et à l'export. Voir le [README](../README.md#mode-autopilote--du-sujet-à-la-vidéo-sans-intervention). Ce guide décrit le parcours avec relecture humaine, recommandé pour un sujet sensible.
>
> Toutes les commandes s'écrivent `pnpm docmaker …` depuis la racine du dépôt. Remplacez `<slug>` par l'identifiant du projet ; ici `la-rupture-catastrophique-de-johnny-depp`. Dans les exemples, on le garde dans une variable :
>
> ```sh
> S=la-rupture-catastrophique-de-johnny-depp
> ```

## Sommaire

0. [Avant de commencer](#0-avant-de-commencer)
1. [Créer le projet et confirmer le style](#1-créer-le-projet-et-confirmer-le-style)
2. [Recherche](#2-recherche)
3. [Plan et thèse](#3-plan-et-thèse)
4. [Script](#4-script)
5. [Vérification des faits](#5-vérification-des-faits)
6. [Beats, scènes et médias](#6-beats-scènes-et-médias)
7. [Extraits YouTube](#7-extraits-youtube)
8. [Voix off](#8-voix-off)
9. [Aperçu](#9-aperçu)
10. [Rendu](#10-rendu)
11. [Export vers DaVinci Resolve, Premiere, Final Cut](#11-export-vers-davinci-resolve-premiere-final-cut)
12. [Crédits et kit de publication](#12-crédits-et-kit-de-publication)
13. [Récapitulatif des coûts](#13-récapitulatif-des-coûts)
14. [En cas de problème](#14-en-cas-de-problème)

---

## 0. Avant de commencer

**Installation** (une fois) : voir le [README](../README.md#démarrage-rapide).

```sh
pnpm install --frozen-lockfile
pnpm docmaker setup --browser          # navigateur de rendu
pnpm docmaker setup --yt-dlp           # extraits YouTube (optionnel)
pnpm docmaker doctor                   # tout doit être vert ou en avertissement
```

**Claude** : au choix, votre **abonnement Claude** (Pro ou Max, sans clé API) ou une **clé API Anthropic** (facturée à l'appel).

Avec l'abonnement, DocumentaryMaker lance le programme officiel `claude` (Claude Code) connecté à votre compte. Installez-le là où tourne DocumentaryMaker (sous Windows : dans Ubuntu/WSL) :

```sh
curl -fsSL https://claude.ai/install.sh | bash
claude auth login                              # votre compte Claude, une seule fois
pnpm docmaker setup --llm claude-code          # nouveaux projets : abonnement (vérifie aussi l'installation)
```

Les étapes Claude coûtent alors 0 $ et consomment le quota de votre abonnement (Max conseillé pour un film de 25 min). Les estimations de coût de ce guide ne concernent plus que les autres services.

Avec une clé API, à la place :

```sh
pnpm docmaker keys set ANTHROPIC_API_KEY
pnpm docmaker keys test anthropic
```

**Autres clés** : ElevenLabs si vous voulez cette voix ; Pexels/Pixabay (gratuites) pour plus de b-roll ; un contact pour Wikimedia.

```sh
pnpm docmaker keys set ELEVENLABS_API_KEY      # optionnel
pnpm docmaker keys set PEXELS_API_KEY          # optionnel, gratuit
```

Pour le contact Wikimedia, ajoutez `DOCMAKER_CONTACT=votre-adresse@exemple.fr` dans `~/.documentarymaker/.env` ou `.env.local` (ou écran **Réglages → Contact Wikimedia**). Il n'est envoyé qu'à Wikimedia, Wikidata et Openverse, et réduit les refus « 429 Too Many Requests ».

**Web** : `pnpm dev:web`, puis ouvrez http://127.0.0.1:3210 (le moteur des nouveaux projets se règle aussi dans **Réglages → Moteur d'écriture**). Au premier lancement, l'écran **Installation** vous guide et vous demande votre **situation vis-à-vis de la licence Remotion** : « particulier ou entreprise de 3 personnes au plus » (gratuit) ou « licence entreprise ». L'outil ne choisit jamais à votre place.

**Comment fonctionnent les validations.** La chaîne avance seule jusqu'à une étape qui a besoin de vous. En ligne de commande, `run` s'arrête alors avec le **code 3**, affiche la commande à taper, puis vous relancez avec `--resume <jobId>`. Dans le web, un bandeau apparaît sur la **Vue d'ensemble** avec un bouton « Ouvrir ».

| Validation | Quand | `--yes` suffit ? |
|---|---|---|
| Confirmer le style | avant le plan | oui |
| Confirmer le coût | avant chaque étape payante | oui (ou `--max-cost`) |
| Approuver le plan (thèse confirmée) | avant le script | **non** |
| Traiter les points de vérification | avant voix finale, rendu, export | **non** |
| Approuver une personne non publique | avant de la nommer / la montrer | **non** |
| Revérifier les affaires en cours | avant rendu / export si un statut a plus de 30 jours | **non** |
| Accepter l'avertissement sur le droit de citation | avant le premier téléchargement YouTube | **non** |

---

## 1. Créer le projet et confirmer le style

### Ligne de commande

```sh
pnpm docmaker new "La rupture catastrophique de Johnny Depp" --lang fr --minutes 25
```

Sortie typique :

```
created la-rupture-catastrophique-de-johnny-depp (fr, 25 min)
suggested styles:
  drama-commentary       74  keywords: rupture; best for person_downfall; commentary style
  cinematic-essay        4  topic person_downfall not in bestFor; essay style
  true-crime-dossier     3  topic person_downfall not in bestFor; true-crime style
confirm later: docmaker style la-rupture-catastrophique-de-johnny-depp --pick <id> | --confirm
pipeline estimate: $3.09 (research $1.39, outline $0.15, script.fr $0.44, beats $0.86, factcheck.fr $0.25)
next: docmaker run la-rupture-catastrophique-de-johnny-depp
```

La suggestion est **gratuite et hors ligne** : le mot « rupture » et le sujet (la chute d'une personnalité) désignent `drama-commentary`. Pour un avis plus fin (quelques centimes) : `pnpm docmaker style $S --llm`. Puis confirmez :

```sh
pnpm docmaker style $S --pick drama-commentary --confirm
```

Variantes : `--lang fr,en --primary fr` pour une version anglaise écrite nativement en plus ; `--style drama-commentary` à la création confirme directement le style.

### Application web

**Projets → Nouveau projet** : tapez l'idée, cochez **FR**, durée **25 min**. Les cartes de style se classent pendant que vous tapez ; « Demander à Claude (peu coûteux) » affine le classement. Choisissez `drama-commentary`, vérifiez l'**estimation du film complet**, validez. Après la confirmation du coût (bandeau sur la Vue d'ensemble), la recherche démarre et la chaîne s'arrête au plan.

---

## 2. Recherche

Claude cherche et lit des pages web, puis produit :

- un **dossier** cité (`research/dossier.md`) ;
- un **registre des sources** limité aux URL réellement consultées (aucune source inventée) ;
- une **fiche de faits** : personnes (avec identifiant Wikidata), chronologie, citations **vérifiées mot à mot** dans la page source, chiffres, et **affaires** avec statut, juridiction, date de décision, réponse de la personne mise en cause et date de vérification.

### Ligne de commande

```sh
pnpm docmaker run $S            # lance research → outline ; demande d'abord d'approuver le coût
# … waiting for approval (exit 3): cost …
pnpm docmaker run $S --max-cost 5    # ou --yes
```

Si la recherche est interrompue (réseau, Ctrl+C), `pnpm docmaker research $S --resume` reprend sans repayer les tours déjà faits.

### Application web

Onglet **Recherche** : dossier, sources, personnes, chronologie, affaires, citations (badge « vérifiée »), lacunes. Si une **personne non publique** apparaît (un témoin, un employé…), elle n'est ni nommée ni montrée sans votre approbation explicite (`pnpm docmaker persons $S --ack <id> --note "…"`).

---

## 3. Plan et thèse

Le plan découpe 25 minutes en chapitres (actes, durée cible, rôle, accroche de sortie) à partir d'un budget calculé (débit de parole français, respirations, extraits). La **thèse** est la phrase qui résume ce que le film défend — par exemple : *« Le procès Depp–Heard n'a pas désigné un vainqueur moral : deux tribunaux, deux pays, deux verdicts opposés, et une affaire jugée d'abord par Internet. »*

Elle doit être **relue et confirmée par vous** : c'est elle qui oriente tout le script, et donc la responsabilité éditoriale du film.

### Ligne de commande

```sh
pnpm docmaker outline $S                       # affiche le plan
pnpm docmaker outline $S --confirm-thesis --approve --note "thèse relue"
pnpm docmaker run $S --resume <jobId>          # ou simplement : pnpm docmaker run $S --from script
```

### Application web

Onglet **Plan** : modifiez la thèse, les titres, les durées, l'ordre ; cochez « Je confirme cette thèse », puis **Approuver le plan**. Si une modification rend du travail obsolète, une fenêtre indique avant d'enregistrer ce qui sera refait et combien cela coûtera.

---

## 4. Script

Le script est écrit **nativement en français** (pas traduit), chapitre par chapitre. Chaque segment est de la narration, un extrait, un emplacement sponsor ou une respiration musicale. Un contrôle automatique signale les formulations accusatoires, les attributions manquantes, les phrases trop longues pour la voix et le rythme.

### Application web (recommandé pour l'édition)

Onglet **Script → fr** : un onglet par chapitre. Modifiez le texte directement ; chaque enregistrement relance gratuitement le contrôle et la vérification déterministe. Utile :

- **texte prononcé** (bascule par segment) : écrire ce que la voix doit dire quand il diffère de l'affichage (« 10 M$ » → « dix millions de dollars ») ;
- **Verrouiller le chapitre** : il ne sera jamais régénéré ;
- **Historique** : les 20 dernières versions, avec retour arrière ;
- **Retranscrire** (projet bilingue) : remet à jour un segment anglais devenu « désynchronisé » du français.

Vos chapitres modifiés ne sont jamais réécrits par l'IA sans confirmation explicite.

### Ligne de commande

```sh
pnpm docmaker run $S --to factcheck            # script → beats → vérification
pnpm docmaker script $S --lang fr --chapter CH3   # réécrire un chapitre avec Claude
```

Réécrire un chapitre que vous avez modifié ou verrouillé exige `--force-overwrite-edits`.

---

## 5. Vérification des faits

Une passe « avocat » relit la **narration, les textes à l'écran (citations, titres, chiffres), le titre, la miniature et la description**. Chaque point a un verdict (`supported`, `needs_attribution`, `status_missing_or_outdated`, `opinion_presented_as_fact`, `quote_mismatch`…), un niveau de risque et souvent une réécriture proposée.

### Pourquoi c'est indispensable sur ce sujet

L'affaire Depp–Heard est le cas d'école : **les verdicts britannique et américain divergent**.

- **Royaume-Uni, 2020** : Johnny Depp poursuit en diffamation l'éditeur du *Sun*, qui l'avait qualifié de « wife beater ». La Haute Cour de Londres (un juge, sans jury) donne raison au journal : ses propos sont jugés « substantiellement vrais ». L'autorisation de faire appel est refusée en 2021.
- **États-Unis, 2022** : Depp poursuit Amber Heard pour sa tribune du *Washington Post*. Un jury de Virginie (comté de Fairfax) estime que trois passages sont diffamatoires ; il retient aussi, sur la demande reconventionnelle de Heard, une déclaration de l'avocat de Depp. Les deux parties concluent un accord fin 2022.

Ce ne sont ni les mêmes défendeurs, ni les mêmes règles de preuve, ni le même type de juridiction. Une phrase comme « la justice a prouvé que… » est donc **fausse dans un pays ou dans l'autre**. C'est pourquoi chaque affaire de la fiche de faits porte un **statut**, une **juridiction** et une **date**, et la narration doit suivre ces mots :

| Statut (fiche de faits) | Formulation acceptable | À éviter |
|---|---|---|
| `judicial_finding_civil` · Haute Cour de Londres · 2020 | « En 2020, la Haute Cour de Londres a jugé substantiellement vrais les propos du *Sun*. » | « Depp est un homme violent. » |
| `judicial_finding_civil` · jury de Fairfax (Virginie) · 2022 | « En 2022, un jury de Virginie a estimé que la tribune d'Amber Heard était diffamatoire. » | « Amber Heard a menti. » |
| `settled_no_admission` · 2022 | « Les deux parties ont conclu un accord, sans reconnaissance de responsabilité. » | « Heard a reconnu… » |
| `denied_allegation` / `disputed` | « Selon…, ce que … conteste. » | toute affirmation à la voix du narrateur |

(Les statuts ci-dessus sont des exemples : les vrais statuts, sources et dates sont ceux de **votre** fiche de faits ; vérifiez-les.)

### Traiter les points

Pour chaque point à risque :

- **Appliquer la réécriture** proposée (ou corriger vous-même) ; ou
- **Assumer** : vous gardez la phrase et écrivez **une note d'au moins 10 caractères** expliquant pourquoi (« attribué au jugement de 2020, source BAILII ») ; ou
- **Écarter** un faux positif, avec une note.

Certains points ne peuvent **que** être corrigés : une citation qui ne correspond pas à sa source (`quote_mismatch`) ou une citation à haut risque non vérifiée. Toute modification ultérieure du script ou d'un texte à l'écran **réarme** la vérification sur les chapitres modifiés. Les statuts « en cours » (appel, enquête, procès en attente) de plus de 30 jours doivent être revérifiés avant le rendu.

### Application web

Onglet **Script**, panneau **Vérification** : verdict, risque, support, problème, réécriture → *Appliquer la réécriture* / *Assumer* / *Écarter*, puis **Enregistrer les validations**. Bandeau « Le script ou les textes à l'écran ont changé » → **Revérifier les chapitres modifiés**.

### Ligne de commande

```sh
pnpm docmaker factcheck $S --lang fr                     # lance / affiche la vérification
pnpm docmaker factcheck $S --lang fr --ack all           # dans un terminal : demande une note par point
# ou sans terminal interactif, un fichier JSON {"FC-…": "note"} :
pnpm docmaker factcheck $S --lang fr --ack-file acks.json
pnpm docmaker factcheck $S --lang fr --dismiss FC-1a2b3c4d --note "faux positif : citation exacte du jugement"
pnpm docmaker factcheck $S --recheck                     # revérifie les statuts en cours
```

---

## 6. Beats, scènes et médias

Un **beat** = une idée visuelle = une tranche exacte de la narration. Pour chaque beat, l'outil cherche des médias sous licence : Wikimedia Commons, Openverse, Internet Archive, Library of Congress, NASA, Pexels/Pixabay (avec clé), vos fichiers, et des extraits YouTube. Il écarte les images hors sujet (époque, lieu, monnaie étrangère au récit…), n'utilise pour une personne réelle que des **photos qui la représentent vraiment**, et ne génère **jamais** d'image IA d'une personne réelle. Quand rien ne convient, il compose un plan graphique (texte animé, carte, chiffre, frise datée) plutôt qu'un fond vide.

### Application web

Onglet **Scènes** : chapitres → cartes de beats (texte, type de visuel, médias avec badge de licence). **Changer** ouvre le **Choix des médias** :

- candidats déjà trouvés ;
- recherche en direct (les sources payantes n'apparaissent qu'après confirmation du prix) ;
- **import** de vos fichiers avec **déclaration de licence obligatoire** : œuvre personnelle / sous licence (code, auteur, URL) / citation d'un tiers / généré par IA.

« Utiliser comme plan N » enregistre votre choix (dans `assets/user-picks.json`, jamais écrasé) et remonte le chapitre automatiquement.

### Ligne de commande

```sh
pnpm docmaker run $S --to assets
pnpm docmaker assets $S --beat <beatId>          # médias retenus et candidats d'un beat
pnpm docmaker assets import $S ./mes-photos --declare own-work --tags depp,tribunal
pnpm docmaker assets import $S ./presse --declare "licensed:CC-BY-4.0:Nom Auteur:https://exemple.org/photo"
```

Pour remplacer un média précis, l'écran **Scènes** est le plus simple.

---

## 7. Extraits YouTube

Le script peut prévoir des segments « extrait » (une déclaration à la barre, une interview). L'outil cherche la vidéo, lit sa transcription, trouve le passage exact et coupe avec des marges (20 s au plus par défaut).

- **yt-dlp tourne en local, sur votre machine, à votre demande** (`pnpm docmaker setup --yt-dlp`).
- **Avant le premier téléchargement**, acceptez l'avertissement :
  ```sh
  pnpm docmaker approve $S fair-use --note "J'ai lu l'avertissement sur le droit de citation"
  ```
  (web : bandeau « Accepter l'avertissement sur le droit de citation »).
- **Votre responsabilité** : télécharger peut enfreindre les conditions de YouTube. En France, le **droit de citation** est plus étroit que le *fair use* américain : extraits **courts**, **commentés**, nécessaires au propos, source citée. Chaque extrait (URL, chaîne, timecodes) figure dans les crédits et le rapport éditorial, avec sa part de la durée totale.
- **Si YouTube bloque** (vérification anti-robot, 403) ou si vous avez déjà le fichier :
  ```sh
  pnpm docmaker assets clip $S CH2-S04 --url "https://www.youtube.com/watch?v=…" --from 01:02 --to 01:14 --channel "Nom de la chaîne" --title "Titre de la vidéo"
  pnpm docmaker assets clip $S CH2-S04 --file ./extrait.mp4 --from 00:05 --to 00:17
  ```
  (web : **Scènes**, segment extrait → URL ou fichier + entrée/sortie).
- Sans extraits : `pnpm docmaker assets $S --no-youtube`.

---

## 8. Voix off

Commencez **toujours par une prise brouillon** : gratuite, instantanée, aux timings exacts. Elle permet de tout prévisualiser et corriger **avant** de payer une voix.

```sh
pnpm docmaker voice $S --lang fr --scratch
pnpm docmaker run $S --from layout --to direct     # montage sur la voix brouillon
```

L'aperçu affiche alors « VOIX BROUILLON ». Ensuite, au choix :

### a) ElevenLabs (~2 $ pour une prise française de 25 min)

```sh
pnpm docmaker voice $S --lang fr --provider elevenlabs --voice <voice_id>
```

L'estimation s'affiche avant (validation de coût). Seuls les segments modifiés sont refaits ensuite (`--segments CH3-S02,CH3-S05` pour cibler, `--retry-bad` pour refaire les segments mal prononcés). Une **voix clonée** exige une déclaration de consentement (`--consent "…"`). La prise finale n'est possible qu'une fois la vérification des faits traitée.

### b) Voix locale gratuite

```sh
pnpm docmaker setup --tts kokoro       # une seule voix française (ff_siwis)
pnpm docmaker voice $S --lang fr --provider kokoro
# ou Piper : pnpm docmaker setup --tts piper:<voix> puis --provider piper
```

### c) Votre propre voix

1. Générez un **prompteur** (HTML, défilement au débit calibré, option miroir) :
   ```sh
   pnpm docmaker voice calibrate $S --lang fr          # mesure le débit (caractères/seconde)
   pnpm docmaker voice teleprompter $S --lang fr --out prompteur.html
   ```
   Dans le web, onglet **Voix** : enregistreur-prompteur dans le navigateur, segment par segment, avec reprise.
2. Enregistrez, puis importez (l'alignement retrouve chaque mot) :
   ```sh
   pnpm docmaker setup --whisper faster-whisper        # ou whisper-cpp (sans Python)
   pnpm docmaker voice import $S narration.wav --lang fr
   # un fichier par segment, nommés <segmentId>.wav :
   pnpm docmaker voice import $S ./prises/*.wav --lang fr --per-segment --pickup-tts elevenlabs
   ```
   `--pickup-tts` comble les segments manquants avec une voix de synthèse.

Après chaque nouvelle prise, mise en page, montage et mixage sont à refaire (gratuit) : le web s'en charge automatiquement ; en ligne de commande, `pnpm docmaker run $S --from layout --to mix`. Au rendu suivant, seuls les morceaux touchés sont refaits.

---

## 9. Aperçu

### Application web

Onglet **Aperçu** : le lecteur est synchronisé avec le script — **cliquez un mot pour y aller**. Sélecteur de chapitre, bande avec marqueurs et effets sonores, liste des habillages : **Retirer**, changer la **Transition** ou la **Disposition**, puis **Enregistrer et remonter**. Vos retouches sont gardées à part (`timeline/fr.overrides.json`) et réappliquées à chaque nouveau montage.

### Ligne de commande

```sh
pnpm docmaker preview $S --lang fr --sheet            # planche contact (une image par intervalle)
pnpm docmaker preview $S --lang fr --frames 0,900,1800
pnpm docmaker preview $S --lang fr --studio           # Remotion Studio sur la timeline
pnpm docmaker preview $S --lang fr --web              # ouvre l'aperçu web
```

---

## 10. Rendu

Deux préréglages :

- **`draft`** : 960×540, rapide, pour vérifier ;
- **`master`** : 1920×1080, qualité de diffusion, grain et étalonnage (LUT) du style.

Le rendu se fait par morceaux alignés sur les chapitres, **mis en cache** : après une correction, seuls les morceaux concernés sont refaits. Le son est mixé à −14 LUFS (norme YouTube), crête ≤ −1 dBTP. Comptez **plusieurs heures** pour 25 min sur 4 cœurs CPU (un brouillon tourne à environ 7 minutes de calcul par minute de film) : rendez d'abord un chapitre.

```sh
pnpm docmaker render $S --lang fr --preset draft --chapters CH1
pnpm docmaker render $S --lang fr --preset draft
pnpm docmaker render $S --lang fr --preset master
pnpm docmaker qa $S --lang fr --preset master         # rapport qualité (noirs, gels, volume, lisibilité)
```

Le fichier final : `projects/$S/render/fr/master/final.mp4`.

Web : onglet **Rendu et export** → préréglage → **Rendre le film entier** ou **Rendre des chapitres**, progression par morceau, annulation, lecteur et téléchargement, **Rapport qualité**. Si le rendu est bloqué, l'écran dit pourquoi (ex. « vérification périmée : revérifier 2 chapitres »).

---

## 11. Export vers DaVinci Resolve, Premiere, Final Cut

L'export **n'a pas besoin du rendu** : vous pouvez récupérer le montage dans votre logiciel dès que la timeline existe.

```sh
pnpm docmaker export $S --lang fr
# si vous montez sur une autre machine, indiquez où le dossier y sera copié :
pnpm docmaker export $S --lang fr --export-root "/Volumes/Montage/depp/export/fr"
```

Dossier `projects/$S/export/fr/` :

| Fichier | Pour |
|---|---|
| `<slug>.fr.fcpxml` | Final Cut Pro, DaVinci Resolve |
| `<slug>.fr.premiere.xml` | Premiere Pro |
| `<slug>.fr.otio` | Premiere 25.6.1+, Resolve, outils OpenTimelineIO |
| `<slug>.fr.markers.edl` | marqueurs (habillages, chapitres) pour Resolve |
| `<slug>.fr.srt` | sous-titres complets |
| `stems/{vo,music,sfx,clip}.wav` | mixage séparé par famille |
| `media/` | tous les médias, conformés (images 1920×1080, audio 48 kHz) |
| `credits.md`, `publish.fr.md`, `editorial-report.fr.md`, `README.md` | crédits, kit de publication, rapport éditorial, mode d'emploi |
| `reference.mp4` | le rendu correspondant, s'il est à jour |

**DaVinci Resolve**

1. Nouveau projet en **1920×1080**, à la cadence indiquée dans `README.md` (elle se verrouille dès que la Media Pool contient un média).
2. *File > Import > Timeline…* → le `.fcpxml`. Dans la fenêtre *Load XML*, cochez **« Use sizing information »** : sans elle, tous les zooms et recadrages (Ken Burns, punch-ins) sont perdus.
3. *Media Pool > Timelines > Import > Timeline Markers from EDL…* → le `.markers.edl`.
4. Resolve gratuit sous Linux ne décode pas le H.264/AAC : transcodez les `.mp4` de `media/` (DNxHR/ProRes) ou utilisez Resolve Studio.

**Premiere Pro** : *Fichier > Importer* → `.premiere.xml` (25.6.1 ou plus récent recommandé), ou le `.otio` en 25.6.1+.

**Final Cut Pro** : *Fichier > Importer > XML…* → `.fcpxml`.

Ce qui reste **modifiable** : coupes, plans, fondus centrés, images clés d'échelle/position/rotation, volumes (ducking, fondus), marqueurs. Pistes audio : A1 voix, A2 musique, A3 effets, A4 son des extraits ; A5–A8 = stems du mixage final, **désactivées** (activez-les à la place de A1–A4 pour entendre le mixage exact). Les habillages graphiques et sous-titres incrustés deviennent des **marqueurs** (comparez avec `reference.mp4`). Les médias ont des noms uniques : « Reconnecter » par dossier retrouve tout.

Web : **Rendu et export → Exporter le montage seul** (formats, préfixe de chemin sur la machine de montage), liens de téléchargement.

---

## 12. Crédits et kit de publication

```sh
pnpm docmaker credits $S --lang fr
```

Les crédits listent chaque média (auteur, licence avec **lien vers l'acte de licence**, source, modifications « recadré et animé »), les extraits, la voix et sa licence. Collez `credits.md` dans la description YouTube.

**Publication** (web, onglet **Publication**) : choisissez ou écrivez le titre, le texte de miniature et la description. Chaque changement est contrôlé (formulation accusatoire → « attribuez-la ou adoucissez-la ») puis revérifié à peu de frais. Le **kit de publication** `export/fr/publish.fr.md` contient titre, miniature, description, **horodatages des chapitres** (`00:00 Titre`), crédits et la liste de transparence.

Avant de publier :

- cochez la case YouTube « **contenu altéré ou synthétique** » si vous utilisez une voix de synthèse ou clonée, ou des illustrations IA ;
- relisez `editorial-report.fr.md` : affaires citées (statut, juridiction, date, sources), points de vérification et vos notes, extraits et leur part du film ;
- revérifiez les statuts juridiques en cours (`pnpm docmaker factcheck $S --recheck`) si du temps a passé ;
- vérifiez votre situation de **licence Remotion**.

Ces garde-fous réduisent les risques mais **ne sont pas un conseil juridique**.

---

## 13. Récapitulatif des coûts

| Poste | Ordre de grandeur |
|---|---|
| Claude (recherche, plan, script 25–30 min, beats, vérification) | **~5–10 $** au réel avec une clé API (l'estimation initiale affichée était de ~3 $ ; révisions, réécritures et revérifications s'ajoutent) ; **0 $** avec votre abonnement Claude (`setup --llm claude-code`), qui consomme alors votre quota |
| ElevenLabs, prise française de 25 min | **~2 $** selon l'abonnement ; les reprises ne refont que les segments modifiés |
| Prise brouillon, Kokoro/Piper, votre voix | gratuit |
| Commons, Openverse, Internet Archive, LOC, NASA, Pexels, Pixabay, YouTube local | gratuit |
| Brave, fal (optionnels) | à l'appel, affiché avant |
| Montage, mixage, rendu, export | gratuit (temps machine) |

Suivi : `pnpm docmaker cost $S` (ou la Vue d'ensemble). Plafonds par défaut : 25 $ par étape, 40 $ par projet. Un appel payant identique n'est jamais refacturé.

---

## 14. En cas de problème

| Symptôme | Que faire |
|---|---|
| `run` s'arrête avec le code 3 | une validation attend : la commande à taper est affichée ; puis `pnpm docmaker run $S --resume <jobId>` |
| « blocked: factcheck-ack » | traiter les points de vérification (section 5) |
| Wikimedia répond 429 | renseigner `DOCMAKER_CONTACT` ; l'outil attend et réessaie |
| YouTube : bot-check / 403 | importer l'extrait à la main (`assets clip`, section 7) |
| Rendu impossible | `pnpm docmaker doctor` ; `pnpm docmaker setup --browser` ; ou `DOCMAKER_BROWSER_EXECUTABLE` vers un Chrome Headless Shell existant |
| Disque plein | `pnpm docmaker cache gc --dry-run` puis `pnpm docmaker cache gc` |
| Voir ce qui tourne | `pnpm docmaker status $S`, `pnpm docmaker jobs $S` (`--cancel <jobId>`) |

Pour aller plus loin : [README](../README.md), [LEGAL.md](LEGAL.md), [EXTENDING.md](EXTENDING.md), spécification [ARCHITECTURE.md](ARCHITECTURE.md).
