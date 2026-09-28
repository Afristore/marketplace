import { mockFreighterWallet, WalletMockOptions } from "../../tests/e2e/wallet-mock";

describe("mockFreighterWallet error handling and UI state tests", () => {
  let mockPage: any;
  let initScriptCallback: (config: any) => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).freighterApi;
    delete (window as any).onWalletMockError;

    mockPage = {
      addInitScript: jest.fn().mockImplementation(async (fn: any, arg: any) => {
        initScriptCallback = fn;
        fn(arg);
      }),
    };
  });

  it("should initialize default wallet mock without errors", async () => {
    await mockFreighterWallet(mockPage);

    expect(mockPage.addInitScript).toHaveBeenCalledTimes(1);
    expect((window as any).freighterApi).toBeDefined();

    const isConnected = await (window as any).freighterApi.isConnected();
    expect(isConnected).toBe(true);

    const pk = await (window as any).freighterApi.getPublicKey();
    expect(pk).toBe("GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I");

    const sig = await (window as any).freighterApi.signTransaction("1234567890ABCDEF");
    expect(sig).toBe("mock-signature-for-1234567890");
  });

  it("should handle signTransaction errors gracefully when tx is invalid", async () => {
    await mockFreighterWallet(mockPage);

    const errorHandler = jest.fn();
    window.addEventListener("wallet-mock-error", errorHandler);

    const result = await (window as any).freighterApi.signTransaction(null as any);

    expect(result).toEqual({
      error: "Invalid transaction XDR format provided for signing.",
    });
    expect(errorHandler).toHaveBeenCalled();

    const toast = document.querySelector(".wallet-mock-error-toast");
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("Invalid transaction XDR format");
  });

  it("should handle failed connect simulation with UI error state", async () => {
    const options: WalletMockOptions = {
      shouldFailConnect: true,
      errorMessage: "User rejected connection modal",
    };

    await mockFreighterWallet(mockPage, options);

    const result = await (window as any).freighterApi.connect();

    expect(result).toEqual({
      error: "User rejected connection modal",
    });

    const toast = document.querySelector(".wallet-mock-error-toast");
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("User rejected connection modal");
  });

  it("should handle general failure mode gracefully across methods", async () => {
    await mockFreighterWallet(mockPage, {
      shouldFail: true,
      errorMessage: "Hardware wallet disconnected",
    });

    const isConnected = await (window as any).freighterApi.isConnected();
    expect(isConnected).toBe(false);

    const pkResult = await (window as any).freighterApi.getPublicKey();
    expect(pkResult).toEqual({ error: "Hardware wallet disconnected" });

    const addrResult = await (window as any).freighterApi.getAddress();
    expect(addrResult).toEqual({ error: "Hardware wallet disconnected" });
  });

  it("should catch and log page.addInitScript error cleanly", async () => {
    const errorPage = {
      addInitScript: jest.fn().mockRejectedValue(new Error("Target page closed")),
    };

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(mockFreighterWallet(errorPage as any)).rejects.toThrow(
      "Target page closed",
    );

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
