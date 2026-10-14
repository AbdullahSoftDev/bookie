import { describe, expect, test } from "bun:test";
import pkg from "../../package.json";

const run = (...args: string[]) =>
  Bun.spawnSync(["bash", "scripts/release-check.sh", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });

describe("release-check.sh versions", () => {
  test("accepts the tag that matches all three version files", () => {
    expect(run("versions", `v${pkg.version}`).exitCode).toBe(0);
  });

  test("rejects a tag that differs from the app version", () => {
    const r = run("versions", "v99.0.0");
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("tag is 'v99.0.0'");
  });

  test("rejects a malformed tag", () => {
    expect(run("versions", pkg.version).exitCode).toBe(1);
  });
});
