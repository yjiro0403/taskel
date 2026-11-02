import { describe, expect, it } from "vitest";
import { resolveDataPath, DATA_DIR } from "@/lib/server/store";

describe("resolveDataPath", () => {
  it("keeps paths inside the data dir", () => {
    expect(resolveDataPath("images/a/b.png").startsWith(DATA_DIR)).toBe(true);
  });
  it("rejects traversal", () => {
    expect(() => resolveDataPath("../secrets.txt")).toThrow();
    expect(() => resolveDataPath("images/../../x")).toThrow();
  });
});
