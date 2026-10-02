# NLE import smoke checklist (manual)

Run after `docmaker export <slug>` on a machine with the NLE installed. Record date, NLE version, OS and result per line.

| NLE | File | Checks | Result |
|---|---|---|---|
| Final Cut Pro 10.6+ | `<slug>.fcpxml` (1.10) | imports without warnings; V1 spine contiguous; stills fill 1920×1080; dissolves centred on cuts; markers present; A1–A4 audio roles | |
| Premiere Pro | `<slug>.premiere.xml` (xmeml v4) | imports; media relinks; scale/position keyframes; audio levels; markers | |
| DaVinci Resolve | `<slug>.resolve.xml` + `<slug>.markers.edl` | timeline imports; marker EDL imports onto the timeline; durations match | |
| OpenTimelineIO | `<slug>.otio` | `otioconvert` round trip; opens in OTIO view | |
| Any | `stems/*.wav` | 4 stems, 48 kHz, line up with the reference MP4 | |

Notes: media paths are remapped with `project.export.exportRoot`; conformed media live in `export/<lang>/media/`.
