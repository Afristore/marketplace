/**
 * @jest-environment node
 */
import { PATCH } from "@/app/api/notifications/read/route";

function makeRequest(url: string) {
  return new Request(url, { method: "PATCH" });
}

describe("PATCH /api/notifications/read", () => {
  it("acknowledges the request for a valid address", async () => {
    const res = await PATCH(
      makeRequest("http://localhost/api/notifications/read?address=GPUBKEY"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      updated_count: 0,
    });
  });

  it("returns a 400 JSON error when the address is missing", async () => {
    const res = await PATCH(
      makeRequest("http://localhost/api/notifications/read"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Missing address parameter",
    });
  });

  it("returns a 500 JSON error instead of throwing when the request is malformed", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const malformed = {
      get url(): string {
        throw new Error("boom");
      },
    } as unknown as Request;

    const res = await PATCH(malformed);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Failed to mark notifications as read",
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
