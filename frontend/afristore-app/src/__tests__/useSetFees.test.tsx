import { act, renderHook } from "@testing-library/react";
import { useSetFees } from "@/hooks/mutations/useSetFees";

const mockPushToast = jest.fn();
const mockSetFees = jest.fn();
const mockGetLendingAdmin = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));
jest.mock("@/lib/lending", () => ({
  setFees: (...args: unknown[]) => mockSetFees(...args),
  getLendingAdmin: () => mockGetLendingAdmin(),
}));

describe("useSetFees", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLendingAdmin.mockResolvedValue("GADMIN");
    mockSetFees.mockResolvedValue(undefined);
  });

  it("sends admin_set_fees with numeric bps", async () => {
    const { result } = renderHook(() => useSetFees("GADMIN"));
    let ok = false;
    await act(async () => {
      ok = await result.current.saveFees({ platformFeeBps: "100", liquidatorFeeBps: "500" });
    });
    expect(ok).toBe(true);
    expect(mockSetFees).toHaveBeenCalledWith("GADMIN", 100, 500);
    expect(mockPushToast).toHaveBeenCalledWith("Protocol fees updated", "success");
  });

  it("never sends fees whose sum reaches 10000 bps", async () => {
    const { result } = renderHook(() => useSetFees("GADMIN"));
    let ok = true;
    await act(async () => {
      ok = await result.current.saveFees({ platformFeeBps: "9000", liquidatorFeeBps: "1000" });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toMatch(/together must be less than 10000/);
    expect(mockSetFees).not.toHaveBeenCalled();
  });

  it("refuses a wallet that is not the protocol admin", async () => {
    const { result } = renderHook(() => useSetFees("GSOMEONE"));
    await act(async () => {
      await result.current.saveFees({ platformFeeBps: "100", liquidatorFeeBps: "500" });
    });
    expect(result.current.error).toBe("Only the protocol admin can update the fees");
    expect(mockSetFees).not.toHaveBeenCalled();
  });
});
