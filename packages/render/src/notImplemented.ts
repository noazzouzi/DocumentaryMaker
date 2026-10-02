// P0 helper: the error every not-yet-implemented API stub throws (SPEC §0.1 step 3, §4.19).
import { DocmakerError } from "@docmaker/core";

export function notImplemented(name: string): DocmakerError {
  return new DocmakerError("INTERNAL", `not implemented: ${name}`, { hint: "this package API is still a P0 stub" });
}
