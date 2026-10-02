"""Dispatcher: python -m docmaker_sidecar <cmd> --in <in.json> --out <out.json>."""

import argparse
import importlib
import json
import os
import re
import sys
import tempfile
import traceback

from . import SidecarError

COMMAND = re.compile(r"^[a-z][a-z0-9_-]*$")


def _write_json(path: str, data) -> None:
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".out-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _fail(out_path: str, code: str, message: str) -> int:
    print(f"ERROR {code}: {message}", file=sys.stderr, flush=True)
    try:
        _write_json(out_path, {"error": code, "message": message})
    except OSError as e:  # the output path itself is unusable
        print(f"ERROR could not write {out_path}: {e}", file=sys.stderr, flush=True)
    return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="docmaker_sidecar", description="DocumentaryMaker Python sidecar")
    parser.add_argument("cmd", help="command name, e.g. asr, piper-align, beats, energy, cuts")
    parser.add_argument("--in", dest="inp", required=True, help="input JSON file")
    parser.add_argument("--out", dest="out", required=True, help="output JSON file")
    args = parser.parse_args(argv)

    if not COMMAND.match(args.cmd):
        return _fail(args.out, "VALIDATION", f"invalid command name {args.cmd!r}")
    module_name = f"docmaker_sidecar.cmd_{args.cmd.replace('-', '_')}"
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as e:
        if e.name == module_name:
            return _fail(args.out, "VALIDATION", f"unknown command {args.cmd!r}")
        return _fail(args.out, "TOOL_MISSING", f"missing Python package {e.name!r} (run `docmaker setup --python`)")
    run = getattr(module, "run", None)
    if not callable(run):
        return _fail(args.out, "INTERNAL", f"{module_name} has no run(input) function")

    try:
        with open(args.inp, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return _fail(args.out, "VALIDATION", f"cannot read input JSON: {e}")

    try:
        result = run(data)
    except SidecarError as e:
        return _fail(args.out, e.code, e.message)
    except ModuleNotFoundError as e:
        return _fail(args.out, "TOOL_MISSING", f"missing Python package {e.name!r} (run `docmaker setup --python`)")
    except KeyboardInterrupt:
        return _fail(args.out, "CANCELED", "interrupted")
    except Exception as e:  # noqa: BLE001 — every failure becomes an error JSON
        traceback.print_exc(file=sys.stderr)
        return _fail(args.out, "INTERNAL", f"{type(e).__name__}: {e}")

    _write_json(args.out, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
