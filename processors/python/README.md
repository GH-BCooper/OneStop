# Python processors

Used only where a Python library is materially better than a Node one. Called from Node through `runPython()` in `apps/api/src/python-bridge.ts`.

Contract for every script: one JSON document on stdin, one JSON document on stdout, exit code 0 on success, diagnostics on stderr. Never read paths or commands from the input without validating them.
