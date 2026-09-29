import { act, renderHook, waitFor } from "@testing-library/react";
import { useWhitelistCurrency } from "@/hooks/mutations/useWhitelistCurrency";

const mockPushToast = jest.fn();
const mockGetLendingAdmin = jest.fn();
const mockWhitelistCurrency = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/lending", () => ({
  getLendingAdmin: (...args: unknown[]) => mockGetLendingAdmin(...args),
  whitelistCurrency: (...args: unknown[]) => mockWhitelistCurrency(...args),
}));

const ADMIN = "G_ADMIN_123";
const PROTOCOL_ADMIN = "G_PROTOCOL_ADMIN";
const CURRENCY = "CBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

async function runWhitelist(
  hook: ReturnType<typeof useWhitelistCurrency>,
  currency: string,
  symbol?: string,
): Promise<boolean> {
  let ok = false;
  await act(async () => {
    ok = await hook.whitelist(currency, symbol);
  });
  return ok;
}

describe("useWhitelistCurrency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLendingAdmin.mockResolvedValue(PROTOCOL_ADMIN);
    mockWhitelistCurrency.mockResolvedValue(undefined);
  });

  it("refuses to run without a connected admin wallet", async () => {
    const { result } = renderHook(() => useWhitelistCurrency(null));

    await expect(runWhitelist(result.current, CURRENCY)).resolves.toBe(false);
    expect(mockWhitelistCurrency).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Admin wallet not connected",
        "error",
      ),
    );
  });

  it("requires a currency address", async () => {
    const { result } = renderHook(() => useWhitelistCurrency(ADMIN));

    await expect(runWhitelist(result.current, "")).resolves.toBe(false);
    expect(mockWhitelistCurrency).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "A valid collateral currency address is required",
        "error",
      ),
    );
  });

  it("blocks non-admin wallets before simulating the transaction", async () => {
    const { result } = renderHook(() => useWhitelistCurrency(ADMIN));
    mockGetLendingAdmin.mockResolvedValue(PROTOCOL_ADMIN);

    await expect(runWhitelist(result.current, CURRENCY)).resolves.toBe(false);
    expect(mockWhitelistCurrency).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Only the protocol admin can whitelist collateral currencies",
        "error",
      ),
    );
  });

  it("whitelists the currency and emits a success toast when admin", async () => {
    mockGetLendingAdmin.mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useWhitelistCurrency(ADMIN));

    await expect(
      runWhitelist(result.current, CURRENCY, "USDC"),
    ).resolves.toBe(true);
    expect(mockWhitelistCurrency).toHaveBeenCalledWith(ADMIN, CURRENCY, "USDC");
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Collateral currency whitelisted",
        "success",
      ),
    );
  });

  it("falls back to the address as the symbol", async () => {
    mockGetLendingAdmin.mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useWhitelistCurrency(ADMIN));

    await runWhitelist(result.current, CURRENCY);
    expect(mockWhitelistCurrency).toHaveBeenCalledWith(ADMIN, CURRENCY, CURRENCY);
  });

  it("surfaces contract errors to the error toast", async () => {
    mockGetLendingAdmin.mockResolvedValue(ADMIN);
    mockWhitelistCurrency.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useWhitelistCurrency(ADMIN));

    await expect(runWhitelist(result.current, CURRENCY)).resolves.toBe(false);
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith("boom", "error"),
    );
  });
});