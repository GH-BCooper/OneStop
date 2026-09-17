"""Hello-world processor proving the Node <-> Python JSON bridge.

Contract for every processor: read one JSON document from stdin, write one JSON
document to stdout, exit 0 on success. Diagnostics go to stderr.
"""

import json
import platform
import sys


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(f"invalid JSON input: {exc}", file=sys.stderr)
        return 1

    name = payload.get("name", "world") if isinstance(payload, dict) else "world"
    json.dump(
        {
            "ok": True,
            "message": f"Hello, {name}!",
            "python": platform.python_version(),
            "echo": payload,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
