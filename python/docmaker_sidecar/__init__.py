"""DocumentaryMaker Python sidecar (SPEC §8.8).

Protocol: ``python -m docmaker_sidecar <cmd> --in <in.json> --out <out.json>``. The dispatcher imports
``docmaker_sidecar.cmd_<cmd>`` (dashes become underscores) and calls ``run(input) -> output``. Exit 0 on success;
on failure the output file holds ``{"error": code, "message": str}`` and the exit code is 1. Progress goes to
stderr as ``PROGRESS <0..1> <message>`` lines.
"""

import sys

__all__ = ["SidecarError", "progress"]
__version__ = "0.1.0"


class SidecarError(Exception):
    """An expected failure with a DocmakerError-compatible code (VALIDATION, TOOL_MISSING, MODEL_MISSING, ...)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def progress(fraction: float, message: str = "") -> None:
    """Report progress (clamped to [0, 1]) on stderr for the Node side (runSidecar onProgress)."""
    f = 0.0 if fraction != fraction else max(0.0, min(1.0, float(fraction)))  # NaN-safe
    msg = " ".join(str(message).split())
    print(f"PROGRESS {f:.4f} {msg}".rstrip(), file=sys.stderr, flush=True)
