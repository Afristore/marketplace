import { Page } from "@playwright/test";

export interface WalletMockOptions {
  publicKey?: string;
  shouldFail?: boolean;
  errorMessage?: string;
  shouldFailConnect?: boolean;
  shouldFailSign?: boolean;
}

export async function mockFreighterWallet(
  page: Page,
  optionsOrPublicKey: string | WalletMockOptions = "GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I",
) {
  const options: WalletMockOptions =
    typeof optionsOrPublicKey === "string"
      ? { publicKey: optionsOrPublicKey }
      : {
          publicKey: "GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I",
          ...optionsOrPublicKey,
        };

  try {
    await page.addInitScript((config) => {
      const {
        publicKey: mockPublicKey,
        shouldFail,
        errorMessage,
        shouldFailConnect,
        shouldFailSign,
      } = config;

      /**
       * Helper to dispatch UI error events and render error notification DOM elements.
       * Informs the user/UI of wallet errors and prevents unhandled promise rejections.
       */
      const renderUiErrorState = (msg: string) => {
        try {
          console.error(`[WalletMock Error]: ${msg}`);

          // 1. Dispatch custom event for React components or test listeners
          if (typeof window !== "undefined") {
            const errorEvent = new CustomEvent("wallet-mock-error", {
              detail: { message: msg, timestamp: Date.now() },
            });
            window.dispatchEvent(errorEvent);

            // Trigger global error handler callback if attached
            if (typeof (window as any).onWalletMockError === "function") {
              (window as any).onWalletMockError(msg);
            }

            // 2. Render visible UI error toast/banner element if DOM is available
            if (typeof document !== "undefined" && document.body) {
              let toastContainer = document.getElementById(
                "wallet-mock-toast-container",
              );
              if (!toastContainer) {
                toastContainer = document.createElement("div");
                toastContainer.id = "wallet-mock-toast-container";
                toastContainer.setAttribute(
                  "style",
                  "position: fixed; bottom: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; max-width: 380px; pointer-events: none;",
                );
                document.body.appendChild(toastContainer);
              }

              const toast = document.createElement("div");
              toast.className = "wallet-mock-error-toast";
              toast.setAttribute("role", "alert");
              toast.setAttribute("aria-live", "assertive");
              toast.setAttribute(
                "style",
                "background-color: #fee2e2; border: 1px solid #f87171; color: #991b1b; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-family: sans-serif; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); pointer-events: auto; display: flex; align-items: center; justify-content: space-between;",
              );

              toast.innerHTML = `<span><strong>Wallet Error:</strong> ${msg}</span>`;

              toastContainer.appendChild(toast);

              setTimeout(() => {
                try {
                  toast.remove();
                } catch {
                  // ignore cleanup error
                }
              }, 5000);
            }
          }
        } catch (uiErr) {
          console.error("[WalletMock] Failed to render UI error state:", uiErr);
        }
      };

      // Mock the freighter API exposed on window with try/catch wrapping on all async operations
      (window as any).freighterApi = {
        isConnected: async () => {
          try {
            if (shouldFail) {
              throw new Error(
                errorMessage || "Freighter connection check failed.",
              );
            }
            return true;
          } catch (err: any) {
            const msg =
              err?.message || "Failed to check wallet connection status";
            renderUiErrorState(msg);
            return false;
          }
        },

        getPublicKey: async () => {
          try {
            if (shouldFail) {
              throw new Error(
                errorMessage || "Failed to retrieve public key from Freighter.",
              );
            }
            if (!mockPublicKey) {
              throw new Error("No public key configured in mock wallet.");
            }
            return mockPublicKey;
          } catch (err: any) {
            const msg = err?.message || "Failed to get wallet public key";
            renderUiErrorState(msg);
            return { error: msg };
          }
        },

        signTransaction: async (tx: string) => {
          try {
            if (shouldFail || shouldFailSign) {
              throw new Error(
                errorMessage || "Transaction signing rejected by user.",
              );
            }
            if (!tx || typeof tx !== "string") {
              throw new Error(
                "Invalid transaction XDR format provided for signing.",
              );
            }
            return `mock-signature-for-${tx.substring(0, 10)}`;
          } catch (err: any) {
            const msg = err?.message || "Failed to sign transaction";
            renderUiErrorState(msg);
            return { error: msg };
          }
        },

        getAddress: async () => {
          try {
            if (shouldFail) {
              throw new Error(
                errorMessage || "Failed to get address from Freighter.",
              );
            }
            if (!mockPublicKey) {
              throw new Error("No public key configured in mock wallet.");
            }
            return mockPublicKey;
          } catch (err: any) {
            const msg = err?.message || "Failed to get wallet address";
            renderUiErrorState(msg);
            return { error: msg };
          }
        },

        connect: async () => {
          try {
            if (shouldFail || shouldFailConnect) {
              throw new Error(
                errorMessage || "User rejected wallet connection request.",
              );
            }
            return true;
          } catch (err: any) {
            const msg = err?.message || "Failed to connect to wallet";
            renderUiErrorState(msg);
            return { error: msg };
          }
        },
      };

      // Safely set sessionStorage
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("e2e_freighter_installed", "true");
          sessionStorage.setItem("e2e_wallet_public_key", mockPublicKey || "");
        }
      } catch (storageErr: any) {
        renderUiErrorState(
          `Failed to update wallet session storage: ${storageErr?.message || storageErr}`,
        );
      }
    }, options);
  } catch (initErr) {
    console.error(
      "[mockFreighterWallet] Failed to inject init script into Playwright page:",
      initErr,
    );
    throw initErr;
  }
}

