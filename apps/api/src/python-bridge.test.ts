import { describe, expect, it } from "vitest";
import { PythonBridgeError, runPython } from "./python-bridge.ts";

describe("runPython (Node <-> Python bridge)", () => {
  it("round-trips JSON through hello.py", async () => {
    const result = await runPython<{ ok: boolean; message: string; echo: unknown }>("hello.py", {
      name: "OneStop",
      n: [1, 2, 3],
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Hello, OneStop!");
    expect(result.echo).toEqual({ name: "OneStop", n: [1, 2, 3] });
  });

  it("fails fast with a clear error when the interpreter path is wrong", async () => {
    const started = Date.now();
    const error = await runPython(
      "hello.py",
      {},
      {
        pythonPath: "definitely-not-a-real-python-binary",
        timeoutMs: 10_000,
      },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PythonBridgeError);
    expect((error as PythonBridgeError).code).toBe("PYTHON_NOT_FOUND");
    expect((error as PythonBridgeError).message).toMatch(/PYTHON_PATH/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects script names that could escape the processors directory", async () => {
    await expect(runPython("../../etc/passwd.py")).rejects.toMatchObject({
      code: "SCRIPT_NOT_FOUND",
    });
  });

  it("reports a missing script", async () => {
    await expect(runPython("does_not_exist.py")).rejects.toMatchObject({
      code: "SCRIPT_NOT_FOUND",
    });
  });

  it("times out instead of hanging", async () => {
    // A 1ms budget is shorter than interpreter startup, so the timeout path must fire.
    await expect(runPython("hello.py", {}, { timeoutMs: 1 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});
