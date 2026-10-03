# Manual NLE smoke checklist (§13.6)

Run before each release on real applications (the automated tests cover DTD validity, goldens and parity with the
research prototypes; these items need a human and the NLE). Use `pnpm docmaker demo` then the bundle in
`projects/<slug>/export/<lang>/`, and the 12 s scenario goldens in `packages/export/test/golden/`.

| # | App | File | Check | Expected |
|---|---|---|---|---|
| 1 | Premiere 25.6.1+ | `.premiere.xml` | Basic Motion **center** units and sign on a clip with an off-centre focal point | the frame matches `reference.mp4` (horiz = dx/W, vert = dy/H, +y down) |
| 2 | Premiere 25.6.1+ | `.premiere.xml` | rotation sign on a clip with a rotation key | same direction as the render (clockwise positive) |
| 3 | FCP 11/12 | `.fcpxml` | a still that is the incoming clip of a dissolve (`start="3600s"`) | dissolve plays with handles, no gap, no black frame |
| 4 | Resolve 20 | `.fcpxml` (tick "Use sizing information") | Ken Burns / punch keyframes | zooms match the render; without the tick they are dropped |
| 5 | Resolve 20 | `.fcpxml` and `.resolve.xml` | A2 music gain keyframes (ducking, chapter silences, fades) | keyframes present; if not, enable the A6 music stem |
| 6 | Resolve 20 | `.markers.edl` via Media Pool > Timelines > Import > Timeline Markers from EDL | marker positions and colours | chapters blue, "… not portable" notes cyan, at the right frames |
| 7 | Resolve 20 | `.fcpxml`, `.otio` | markers from FCPXML (clip-level) and OTIO (stack) | present (else rely on the marker EDL) |
| 8 | Resolve 20 | `.fcpxml` with `fcpxmlVersion: "1.11"` | import accepted | yes (1.10 is the safe default) |
| 9 | Premiere 25.6.1+ | `.otio` | Motion scale keyframes and Opacity | present (no LinearTimeWarp is written) |
| 10 | all | any | paths with spaces/accents (`Projet tulipes é`) and an `exportRoot` remap | media online without relinking |
| 11 | Resolve (free, Linux) | `.fcpxml` | H.264 clips | offline until transcoded (documented in README.md) |
