# DTD test fixtures — attribution

These files are used **only as test fixtures** (DTD validation of the exporters' output with `xmllint --dtdvalid`).
They are not shipped in the product and are not part of the export bundle.

| File | Source | Copyright |
|---|---|---|
| `fcpxml-1.10.dtd` | Apple "FCPXML Document Type Definition", version 1.10 (developer.apple.com, Professional Video Applications documentation) | © 2011–2021 Apple Inc. All rights reserved. |
| `xmeml_dtd_4.dtd` | Apple "Final Cut Pro XML Interchange Format" DTD v4 (developer.apple.com archive, FinalCutPro_XML reference) | © 2007 Apple Inc. |
| `xmeml_dtd_4_premiere.dtd` | `xmeml_dtd_4.dtd` plus six lines declaring the Premiere Pro extensions written by Premiere's own FCP XML export (`numOutputChannels`, `explodedTracks`, `currentExplodedTrackIndex`, `totalExplodedTrackCount`, `premiereTrackType`, `premiereChannelType`, `authoringApp`) | Apple DTD © 2007 Apple Inc.; the added ATTLIST lines are ours |

The reference documents in `test/golden/reference/` are the validated prototypes of the research phase
(DTD-validated and read back with OpenTimelineIO 0.18.1); `test/golden/*` are the writers' approved outputs.
