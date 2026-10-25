import { act, renderHook, waitFor } from "@testing-library/react";
import { useReturnNFT } from "@/hooks/mutations/useReturnNFT";

const mockPushToast = jest.fn();
const mockReturnNFT = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/lending", () => ({
  returnNFT: (...args: unknown[]) => mockReturnNFT(...args),
}));

const BORROWER = "GBORROWER";
const POSITION_ID = 101;

describe("useReturnNFT (#1104)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fails when called with disconnected wallet", async () => {
    const { result } = renderHook(() => useReturnNFT(null));
    let success = true;

    await act(async () => {
      success = await result.current.returnNFT(POSITION_ID);
    });

    expect(success).toBe(false);
    expect(mockReturnNFT).not.toHaveBeenCalled();
  });

  it("handles network failure during submission", async () => {
    mockReturnNFT.mockRejectedValueOnce(new Error("Network connection error"));
    const { result } = renderHook(() => useReturnNFT(BORROWER));
    let success = true;

    await act(async () => {
      success = await result.current.returnNFT(POSITION_ID);
    });

    expect(success).toBe(false);
    expect(mockReturnNFT).toHaveBeenCalled();
  });

  it("handles successful return NFT confirmation", async () => {
    mockReturnNFT.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useReturnNFT(BORROWER));
    let success = false;

    await act(async () => {
      success = await result.current.returnNFT(POSITION_ID);
    });

    expect(success).toBe(true);
    expect(mockReturnNFT).toHaveBeenCalledWith(BORROWER, POSITION_ID);
  });
});
