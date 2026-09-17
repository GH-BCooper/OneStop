# @onestop/api

Framework-agnostic backend modules for OneStop.

HTTP routes live as Next.js route handlers in `apps/web/src/app/api/` (see the decisions log in `docs/PROGRESS.md`). Those handlers call into this package, so if the backend ever needs to be split out, this is the boundary to extract.

## Python bridge

`runPython(script, input, options)` in `src/python-bridge.ts` spawns a script from `processors/python/` (no shell, bare script names only), sends `input` as JSON on stdin and parses JSON from stdout. It fails with a typed `PythonBridgeError` (`PYTHON_NOT_FOUND`, `SCRIPT_NOT_FOUND`, `TIMEOUT`, `PROCESS_FAILED`, `INVALID_JSON`, `OUTPUT_TOO_LARGE`) and never hangs: every call has a timeout (default 30s).

```bash
npm run bridge:hello
```
