import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useUpdateBounds,
  validateBounds,
} from "@/hooks/mutations/useUpdateBounds";
import type { LendingBounds } from "@/lib/lending";

const mockPushToast = jest.fn();
const mockGetLendingAdmin = jest.fn();
const mockUpdateBounds = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/lending", () => ({
  getLendingAdmin: (...args: unknown[]) => mockGetLendingAdmin(...args),
  updateBounds: (...args: unknown[]) => mockUpdateBounds(...args),
}));

const ADMIN = "G_ADMIN_123";
const PROTOCOL_ADMIN = "G_PROTOCOL_ADMIN";

const VALID_BOUNDS: LendingBounds = {
  minBufferBps: 12000,
  maxBufferBps: 20000,
  minLiqThresholdBps: 10500,
  maxLiqThresholdBps: 11000,
};

async function runUpdate(
  hook: ReturnType<typeof useUpdateBounds>,
  bounds: LendingBounds,
): Promise<boolean> {
  let ok = false;
  try {
    await act(async () => {
      ok = await hook.update(bounds);
    });
  } catch (error) {
    console.error("Update bounds error:", error);
    ok = false;
  }
  return ok;
}

describe("validateBounds", () => {
  it("accepts ordered, threshold-below-buffer bounds", () => {
    expect(validateBounds(VALID_BOUNDS)).toEqual({ valid: true });
  });

  it("rejects a reversed min/max buffer pair", () => {
    const result = validateBounds({
      ...VALID_BOUNDS,
      minBufferBps: 20000,
      maxBufferBps: 12000,
    });
    expect(result).toEqual({
      valid: false,
      error: "Minimum collateral buffer cannot exceed the maximum buffer",
    });
  });

  it("rejects a reversed min/max threshold pair", () => {
    const result = validateBounds({
      ...VALID_BOUNDS,
      minLiqThresholdBps: 11000,
      maxLiqThresholdBps: 10500,
    });
    expect(result).toEqual({
      valid: false,
      error:
        "Minimum liquidation threshold cannot exceed the maximum threshold",
    });
  });

  it("rejects thresholds that are not strictly below the buffer", () => {
    const result = validateBounds({
      ...VALID_BOUNDS,
      maxLiqThresholdBps: 12000, // equal to minBufferBps → invalid
    });
    expect(result).toEqual({
      valid: false,
      error: "Liquidation threshold must be lower than the collateral buffer",
    });
  });

  it("rejects non-positive bounds", () => {
    const result = validateBounds({ ...VALID_BOUNDS, minBufferBps: 0 });
    expect(result).toEqual({
      valid: false,
      error: "All bounds must be positive",
    });
  });

  it("rejects non-whole bounds", () => {
    const result = validateBounds({ ...VALID_BOUNDS, maxBufferBps: 12000.5 });
    expect(result).toEqual({
      valid: false,
      error: "All bounds must be whole basis-point values",
    });
  });
});

describe("useUpdateBounds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLendingAdmin.mockResolvedValue(PROTOCOL_ADMIN);
    mockUpdateBounds.mockResolvedValue(undefined);
  });

  it("refuses to run without a connected admin wallet", async () => {
    try {
      const { result } = renderHook(() => useUpdateBounds(null));

      await expect(runUpdate(result.current, VALID_BOUNDS)).resolves.toBe(
        false,
      );
      expect(mockUpdateBounds).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith(
          "Admin wallet not connected",
          "error",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("rejects invalid bounds locally without contacting the network", async () => {
    try {
      const { result } = renderHook(() => useUpdateBounds(ADMIN));

      await expect(
        runUpdate(result.current, {
          ...VALID_BOUNDS,
          maxLiqThresholdBps: 20000,
        }),
      ).resolves.toBe(false);
      expect(mockGetLendingAdmin).not.toHaveBeenCalled();
      expect(mockUpdateBounds).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith(
          "Liquidation threshold must be lower than the collateral buffer",
          "error",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("blocks non-admin wallets before simulating the transaction", async () => {
    try {
      const { result } = renderHook(() => useUpdateBounds(ADMIN));
      mockGetLendingAdmin.mockResolvedValue(PROTOCOL_ADMIN);

      await expect(runUpdate(result.current, VALID_BOUNDS)).resolves.toBe(
        false,
      );
      expect(mockUpdateBounds).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith(
          "Only the protocol admin can update the global bounds",
          "error",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("updates the bounds and emits a success toast when admin", async () => {
    try {
      mockGetLendingAdmin.mockResolvedValue(ADMIN);
      const { result } = renderHook(() => useUpdateBounds(ADMIN));

      await expect(runUpdate(result.current, VALID_BOUNDS)).resolves.toBe(true);
      expect(mockUpdateBounds).toHaveBeenCalledWith(ADMIN, VALID_BOUNDS);
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith(
          "Protocol bounds updated",
          "success",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces contract errors to the error toast", async () => {
    try {
      mockGetLendingAdmin.mockResolvedValue(ADMIN);
      mockUpdateBounds.mockRejectedValue(new Error("boom"));
      const { result } = renderHook(() => useUpdateBounds(ADMIN));

      await expect(runUpdate(result.current, VALID_BOUNDS)).resolves.toBe(
        false,
      );
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith("boom", "error"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
