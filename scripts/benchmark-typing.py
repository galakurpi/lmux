#!/usr/bin/env python3
import argparse
import json
import os
import socket
import sys
import time


def socket_target() -> tuple[str, int]:
    host = os.environ.get("LMUX_SOCKET_HOST", "127.0.0.1")
    port = os.environ.get("LMUX_SOCKET_PORT")
    if port:
        return host, int(port)
    with open(os.path.expanduser("~/.lmux/ptr.port"), "r", encoding="utf-8") as f:
        return host, int(f.read().strip())


class LmuxSocket:
    def __init__(self) -> None:
        self.host, self.port = socket_target()
        self.seq = 0

    def call(self, cmd: str, args: dict | None = None) -> dict:
        self.seq += 1
        payload = {"id": self.seq, "cmd": cmd, "args": args or {}}
        with socket.create_connection((self.host, self.port), timeout=60) as sock:
            sock.settimeout(60)
            sock.sendall(json.dumps(payload).encode("utf-8") + b"\n")
            sock.shutdown(socket.SHUT_WR)
            response = sock.makefile("r", encoding="utf-8").readline()
        data = json.loads(response)
        if data.get("error"):
            raise RuntimeError(f"{cmd}: {data['error']}")
        return data["result"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chars", type=int, default=900)
    parser.add_argument("--delay-ms", type=int, default=1)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--workspace-id")
    parser.add_argument("--surface-id")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    lmux = LmuxSocket()
    workspace_id = args.workspace_id
    surface_id = args.surface_id
    created_workspace = False

    if not workspace_id or not surface_id:
        workspace = lmux.call("workspace.new", {
            "name": f"typing-bench-{int(time.time())}",
            "template": "1x1",
        })
        workspace_id = workspace["id"]
        created_workspace = True
        time.sleep(1)
        pane = lmux.call("pane.list", {"workspace_id": workspace_id})[0]
        surface_id = pane["surface_id"]

    results = []
    for i in range(args.runs):
        result = lmux.call("perf.input-benchmark", {
            "workspace_id": workspace_id,
            "surface_id": surface_id,
            "chars": args.chars,
            "delay_ms": args.delay_ms,
        })
        result["run"] = i + 1
        results.append(result)
        print(json.dumps(result, indent=2), flush=True)
        time.sleep(0.4)

    worst = {
        "input_gap_max_ms": max(r["stats"]["inputGapMs"]["max"] for r in results),
        "input_gap_p99_ms": max(r["stats"]["inputGapMs"]["p99"] for r in results),
        "write_p99_ms": max(r["stats"]["writeMs"]["p99"] for r in results),
        "screen_capture_p99_ms": max(r["stats"]["screenCaptureMs"]["p99"] for r in results),
        "event_loop_drift_p99_ms": max(r["stats"]["eventLoopDriftMs"]["p99"] for r in results),
        "visible": all(r["visible"] for r in results),
    }
    print(json.dumps({"summary": worst}, indent=2), flush=True)

    if created_workspace and not args.keep:
        try:
            lmux.call("workspace.close", {"id": workspace_id})
        except Exception as exc:
            print(f"benchmark-typing: cleanup failed: {exc}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"benchmark-typing: {exc}", file=sys.stderr)
        raise SystemExit(1)
