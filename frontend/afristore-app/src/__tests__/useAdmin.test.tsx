/**
 * Unit tests for useAdmin.ts hooks.
 *
 * Error handling contract covered here (issue #1038):
 *   • every async interaction is awaited inside a try/catch, so a rejected
 *     contract call can never escape as an unhandled promise rejection and
 *     take the React tree down;
 *   • a failure is surfaced to the user through the hook's `error` state
 *     and never silently swallowed: the tests assert the message, not just
 *     that something happened;
 *   • a global `unhandledRejection` listener fails the suite if any promise
 *     is ever left unhandled.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetTotalListings = jest.fn();
const mockGetAllListings = jest.fn();
const mockGetTreasury = jest.fn();
const mockGetProtocolFee = jest.fn();
const mockGetAdmin = jest.fn();
const mockRevokeArtist = jest.fn();
const mockReinstateArtist = jest.fn();
const mockIsArtistRevoked = jest.fn();
const mockAddTokenToWhitelist = jest.fn();
const mockRemoveTokenFromWhitelist = jest.fn();
const mockGetTokenWhitelist = jest.fn();

jest.mock("@/lib/contract", () => ({
  getTotalListings: (...args: unknown[]) => mockGetTotalListings(...args),
  getAllListings: (...args: unknown[]) => mockGetAllListings(...args),
  getTreasury: (...args: unknown[]) => mockGetTreasury(...args),
  getProtocolFee: (...args: unknown[]) => mockGetProtocolFee(...args),
  getAdmin: (...args: unknown[]) => mockGetAdmin(...args),
  revokeArtist: (...args: unknown[]) => mockRevokeArtist(...args),
  reinstateArtist: (...args: unknown[]) => mockReinstateArtist(...args),
  isArtistRevoked: (...args: unknown[]) => mockIsArtistRevoked(...args),
  addTokenToWhitelist: (...args: unknown[]) => mockAddTokenToWhitelist(...args),
  removeTokenFromWhitelist: (...args: unknown[]) =>
    mockRemoveTokenFromWhitelist(...args),
  getTokenWhitelist: (...args: unknown[]) => mockGetTokenWhitelist(...args),
}));

// Horizon.Server mock — not needed for these tests
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn().mockResolvedValue({ balances: [] }),
    })),
  },
}));

jest.mock("@/lib/config", () => ({
  config: { horizonUrl: "https://horizon-testnet.stellar.org" },
}));

import {
  useAdminStats,
  useModeration,
  useTokenManagement,
  useAdminCheck,
} from "@/hooks/useAdmin";

// ── Unhandled rejection guard ────────────────────────────────────────────────

const unhandledRejections: unknown[] = [];

function trackUnhandledRejection(reason: unknown) {
  unhandledRejections.push(reason);
}

beforeAll(() => {
  process.on("unhandledRejection", trackUnhandledRejection);
});

afterAll(() => {
  process.off("unhandledRejection", trackUnhandledRejection);
});

afterEach(async () => {
  // Give the microtask queue a chance to surface a late rejection before
  // the next test starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unhandledRejections).toEqual([]);
  unhandledRejections.length = 0;
});

// ── useAdminStats ─────────────────────────────────────────────────────────────

describe("useAdminStats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads stats successfully", async () => {
    try {
      mockGetTotalListings.mockResolvedValueOnce(10);
      mockGetAllListings.mockResolvedValueOnce([
        { artist: "GA" },
        { artist: "GB" },
        { artist: "GA" }, // duplicate — unique count = 2
      ]);
      mockGetProtocolFee.mockResolvedValueOnce(250);
      mockGetTreasury.mockResolvedValueOnce("GTREASURY");

      function Comp() {
        const { stats, isLoading } = useAdminStats();
        if (isLoading || !stats) return <span data-testid="loading">yes</span>;
        return (
          <div>
            <span data-testid="listings">{stats.totalListings}</span>
            <span data-testid="users">{stats.totalUsers}</span>
            <span data-testid="fee">{stats.protocolFeeBps}</span>
            <span data-testid="treasury">{stats.treasuryAddress}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.queryByTestId("loading")).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("listings").textContent).toBe("10");
      expect(screen.getByTestId("users").textContent).toBe("2");
      expect(screen.getByTestId("fee").textContent).toBe("250");
      expect(screen.getByTestId("treasury").textContent).toBe("GTREASURY");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("sets error when contract call fails", async () => {
    try {
      mockGetTotalListings.mockRejectedValueOnce(new Error("chain down"));

      function Comp() {
        const { error } = useAdminStats();
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).not.toBe("none"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces the failure message when the contract call fails", async () => {
    try {
      mockGetTotalListings.mockRejectedValueOnce(new Error("chain down"));

      function Comp() {
        const { error, isLoading } = useAdminStats();
        if (isLoading) return <span data-testid="loading">yes</span>;
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("chain down"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to a readable message when the failure is not an Error", async () => {
    try {
      mockGetTotalListings.mockRejectedValueOnce("boom");

      function Comp() {
        const { error } = useAdminStats();
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe(
          "Failed to load admin stats",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useModeration ─────────────────────────────────────────────────────────────

describe("useModeration", () => {
  beforeEach(() => jest.clearAllMocks());

  it("revoke does nothing when adminPublicKey is null", async () => {
    try {
      function Comp() {
        const { revoke } = useModeration(null);
        const [done, setDone] = React.useState(false);
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  await revoke("GARTIST");
                  setDone(true);
                } catch (error) {
                  console.error("revoke failed:", error);
                }
              }}
            >
              r
            </button>
            <span data-testid="done">{String(done)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("done").textContent).toBe("true"),
      );
      expect(mockRevokeArtist).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls revokeArtist with correct args", async () => {
    try {
      mockRevokeArtist.mockResolvedValueOnce(undefined);
      function Comp() {
        const { revoke } = useModeration("GADMIN");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setResult((await revoke("GARTIST")) as boolean);
                } catch (error) {
                  console.error("revoke failed:", error);
                }
              }}
            >
              r
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockRevokeArtist).toHaveBeenCalledWith("GADMIN", "GARTIST");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("calls reinstateArtist with correct args", async () => {
    try {
      mockReinstateArtist.mockResolvedValueOnce(undefined);
      function Comp() {
        const { reinstate } = useModeration("GADMIN");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setResult((await reinstate("GARTIST")) as boolean);
                } catch (error) {
                  console.error("reinstate failed:", error);
                }
              }}
            >
              re
            </button>
            <span data-testid="result">{String(result)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("true"),
      );
      expect(mockReinstateArtist).toHaveBeenCalledWith("GADMIN", "GARTIST");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces the error and reports false when revoking fails", async () => {
    try {
      mockRevokeArtist.mockRejectedValueOnce(new Error("revoke rejected"));
      function Comp() {
        const { revoke, error } = useModeration("GADMIN");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setResult((await revoke("GARTIST")) as boolean);
                } catch (error) {
                  console.error("revoke failed:", error);
                }
              }}
            >
              r
            </button>
            <span data-testid="result">{String(result)}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
      expect(screen.getByTestId("error").textContent).toBe("revoke rejected");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces the error and reports false when reinstating fails", async () => {
    try {
      mockReinstateArtist.mockRejectedValueOnce(new Error("reinstate rejected"));
      function Comp() {
        const { reinstate, error } = useModeration("GADMIN");
        const [result, setResult] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setResult((await reinstate("GARTIST")) as boolean);
                } catch (error) {
                  console.error("reinstate failed:", error);
                }
              }}
            >
              re
            </button>
            <span data-testid="result">{String(result)}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("result").textContent).toBe("false"),
      );
      expect(screen.getByTestId("error").textContent).toBe("reinstate rejected");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("checkStatus returns revoked flag from contract", async () => {
    try {
      mockIsArtistRevoked.mockResolvedValueOnce(true);
      function Comp() {
        const { checkStatus } = useModeration("GADMIN");
        const [status, setStatus] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setStatus(await checkStatus("GARTIST"));
                } catch (error) {
                  console.error("checkStatus failed:", error);
                }
              }}
            >
              c
            </button>
            <span data-testid="status">{String(status)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("status").textContent).toBe("true"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("checkStatus reports false when the contract call fails", async () => {
    try {
      mockIsArtistRevoked.mockRejectedValueOnce(new Error("rpc down"));
      function Comp() {
        const { checkStatus } = useModeration("GADMIN");
        const [status, setStatus] = React.useState<boolean | undefined>(
          undefined,
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  setStatus(await checkStatus("GARTIST"));
                } catch (error) {
                  console.error("checkStatus failed:", error);
                }
              }}
            >
              c
            </button>
            <span data-testid="status">{String(status)}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("status").textContent).toBe("false"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useTokenManagement ────────────────────────────────────────────────────────

describe("useTokenManagement", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads the token whitelist on mount", async () => {
    try {
      mockGetTokenWhitelist.mockResolvedValueOnce(["CTOKENA", "CTOKENB"]);

      function Comp() {
        const { whitelistedTokens } = useTokenManagement("GADMIN");
        return <span data-testid="tokens">{whitelistedTokens.join(",")}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CTOKENA,CTOKENB"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces the error when the whitelist cannot be loaded", async () => {
    try {
      mockGetTokenWhitelist.mockRejectedValueOnce(new Error("whitelist down"));

      function Comp() {
        const { whitelistedTokens, error } = useTokenManagement("GADMIN");
        return (
          <div>
            <span data-testid="tokens">{whitelistedTokens.join(",")}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).toBe("whitelist down"),
      );
      expect(screen.getByTestId("tokens").textContent).toBe("");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("adds a token optimistically and confirms on success", async () => {
    try {
      mockGetTokenWhitelist.mockResolvedValueOnce([]);
      mockAddTokenToWhitelist.mockResolvedValueOnce(undefined);

      function Comp() {
        const { whitelistedTokens, whitelist } = useTokenManagement("GADMIN");
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  await whitelist("CNEWTOKEN");
                } catch (error) {
                  console.error("whitelist failed:", error);
                }
              }}
            >
              add
            </button>
            <span data-testid="tokens">{whitelistedTokens.join(",")}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe(""),
      );
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CNEWTOKEN"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("rolls back token addition on contract failure", async () => {
    try {
      mockGetTokenWhitelist.mockResolvedValueOnce(["CEXISTING"]);
      mockAddTokenToWhitelist.mockRejectedValueOnce(new Error("failed"));

      function Comp() {
        const { whitelistedTokens, whitelist, error } = useTokenManagement(
          "GADMIN",
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  await whitelist("CFAIL");
                } catch (error) {
                  console.error("whitelist failed:", error);
                }
              }}
            >
              add
            </button>
            <span data-testid="tokens">{whitelistedTokens.join(",")}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CEXISTING"),
      );
      await user.click(screen.getByRole("button"));
      // After rollback, should revert to the original list
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CEXISTING"),
      );
      expect(screen.getByTestId("error").textContent).toBe("failed");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("removes a token and confirms on success", async () => {
    try {
      mockGetTokenWhitelist.mockResolvedValueOnce(["CTOKENA", "CTOKENB"]);
      mockRemoveTokenFromWhitelist.mockResolvedValueOnce(undefined);

      function Comp() {
        const { whitelistedTokens, unwhitelist } = useTokenManagement("GADMIN");
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  await unwhitelist("CTOKENA");
                } catch (error) {
                  console.error("unwhitelist failed:", error);
                }
              }}
            >
              remove
            </button>
            <span data-testid="tokens">{whitelistedTokens.join(",")}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CTOKENA,CTOKENB"),
      );
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CTOKENB"),
      );
      expect(mockRemoveTokenFromWhitelist).toHaveBeenCalledWith(
        "GADMIN",
        "CTOKENA",
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("rolls back token removal on contract failure", async () => {
    try {
      mockGetTokenWhitelist.mockResolvedValueOnce(["CTOKENA", "CTOKENB"]);
      mockRemoveTokenFromWhitelist.mockRejectedValueOnce(new Error("failed"));

      function Comp() {
        const { whitelistedTokens, unwhitelist, error } = useTokenManagement(
          "GADMIN",
        );
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  await unwhitelist("CTOKENA");
                } catch (error) {
                  console.error("unwhitelist failed:", error);
                }
              }}
            >
              remove
            </button>
            <span data-testid="tokens">{whitelistedTokens.join(",")}</span>
            <span data-testid="error">{error ?? "none"}</span>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CTOKENA,CTOKENB"),
      );
      await user.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByTestId("tokens").textContent).toBe("CTOKENA,CTOKENB"),
      );
      expect(screen.getByTestId("error").textContent).toBe("failed");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useAdminCheck ─────────────────────────────────────────────────────────────

describe("useAdminCheck", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns isAdmin=false when publicKey is null", async () => {
    try {
      function Comp() {
        const { isAdmin, isLoading } = useAdminCheck(null);
        return (
          <div>
            <span data-testid="admin">{String(isAdmin)}</span>
            <span data-testid="loading">{String(isLoading)}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("loading").textContent).toBe("false"),
      );
      expect(screen.getByTestId("admin").textContent).toBe("false");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns isAdmin=true when publicKey matches admin address", async () => {
    try {
      mockGetAdmin.mockResolvedValueOnce("GADMIN");
      function Comp() {
        const { isAdmin, isLoading } = useAdminCheck("GADMIN");
        return (
          <div>
            <span data-testid="admin">{String(isAdmin)}</span>
            <span data-testid="loading">{String(isLoading)}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("loading").textContent).toBe("false"),
      );
      expect(screen.getByTestId("admin").textContent).toBe("true");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns isAdmin=false when publicKey does not match", async () => {
    try {
      mockGetAdmin.mockResolvedValueOnce("GADMIN");
      function Comp() {
        const { isAdmin } = useAdminCheck("GNOTADMIN");
        return <span data-testid="admin">{String(isAdmin)}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("admin").textContent).toBe("false"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns isAdmin=false when the admin lookup fails", async () => {
    try {
      mockGetAdmin.mockRejectedValueOnce(new Error("rpc down"));
      function Comp() {
        const { isAdmin, isLoading } = useAdminCheck("GADMIN");
        return (
          <div>
            <span data-testid="admin">{String(isAdmin)}</span>
            <span data-testid="loading">{String(isLoading)}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("loading").textContent).toBe("false"),
      );
      expect(screen.getByTestId("admin").textContent).toBe("false");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
