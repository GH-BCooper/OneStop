import { PythonBridgeError, runPython } from "../src/python-bridge.ts";

try {
  const result = await runPython("hello.py", { name: "OneStop" }, { timeoutMs: 15_000 });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  if (err instanceof PythonBridgeError) {
    console.error(`[${err.code}] ${err.message}`);
    if (err.detail) console.error(err.detail);
  } else {
    console.error(err);
  }
  process.exit(1);
}
