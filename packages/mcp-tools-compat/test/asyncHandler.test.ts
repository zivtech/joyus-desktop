import { describe, expect, it, vi } from "vitest";
import { wrapAsyncHandler } from "../src/asyncHandler";

describe("wrapAsyncHandler", () => {
  it("returns the resolved value of the inner handler", async () => {
    const handler = wrapAsyncHandler(async () => 42);
    await expect(handler({})).resolves.toBe(42);
  });

  it("passes args through to the inner handler", async () => {
    const inner = vi.fn(async (args: unknown) => args);
    const handler = wrapAsyncHandler(inner);
    const input = { foo: "bar" };
    const result = await handler(input);
    expect(inner).toHaveBeenCalledWith(input);
    expect(result).toEqual(input);
  });

  it("re-throws errors from the inner handler", async () => {
    const handler = wrapAsyncHandler(async () => {
      throw new Error("boom");
    });
    await expect(handler({})).rejects.toThrow("boom");
  });

  it("calls onError when the inner handler rejects", async () => {
    const onError = vi.fn();
    const err = new Error("fail");
    const handler = wrapAsyncHandler(async () => {
      throw err;
    }, { onError });
    await expect(handler({})).rejects.toThrow("fail");
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("does not call onError when the inner handler succeeds", async () => {
    const onError = vi.fn();
    const handler = wrapAsyncHandler(async () => "ok", { onError });
    await expect(handler({})).resolves.toBe("ok");
    expect(onError).not.toHaveBeenCalled();
  });

  it("works without options", async () => {
    const handler = wrapAsyncHandler(async () => "no-opts");
    await expect(handler(null)).resolves.toBe("no-opts");
  });

  it("propagates non-Error rejections", async () => {
    const onError = vi.fn();
    const handler = wrapAsyncHandler(async () => {
      throw "string-error";
    }, { onError });
    await expect(handler({})).rejects.toBe("string-error");
    expect(onError).toHaveBeenCalledWith("string-error");
  });
});
