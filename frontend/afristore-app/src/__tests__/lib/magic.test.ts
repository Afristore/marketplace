import {
  getMagicInstance,
  isMagicLoggedIn,
  loginWithMagicLink,
  loginWithPasskey,
  getMagicUserMetadata,
  logoutFromMagic,
  signWithMagic,
  MagicAccount,
} from "@/lib/magic";

jest.mock("magic-sdk");
jest.mock("@/lib/e2e-chain-mock", () => ({
  isE2eMockChain: jest.fn(() => false),
}));

const mockMagicUser = {
  isLoggedIn: jest.fn(),
  getInfo: jest.fn(),
  logout: jest.fn(),
};

const mockMagicAuth = {
  loginWithMagicLink: jest.fn(),
  loginWithPasskey: jest.fn(),
};

const mockMagicInstance = {
  user: mockMagicUser,
  auth: mockMagicAuth,
};

describe("magic.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    sessionStorage.clear();
    process.env.NEXT_PUBLIC_MAGIC_API_KEY = "pk_test_123456";
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getMagicInstance", () => {
    it("should throw error when MAGIC_API_KEY is not set", () => {
      process.env.NEXT_PUBLIC_MAGIC_API_KEY = undefined;
      expect(() => getMagicInstance()).toThrow(
        "Magic SDK not initialized. Please set NEXT_PUBLIC_MAGIC_API_KEY."
      );
    });

    it("should create Magic instance when API key is set", () => {
      process.env.NEXT_PUBLIC_MAGIC_API_KEY = "pk_live_abc123";
      const instance = getMagicInstance();
      expect(instance).toBeDefined();
    });
  });

  describe("isMagicLoggedIn", () => {
    it("should return true when user is logged in", async () => {
      mockMagicUser.isLoggedIn.mockResolvedValue(true);
      const result = await isMagicLoggedIn();
      expect(result).toBe(true);
      expect(mockMagicUser.isLoggedIn).toHaveBeenCalled();
    });

    it("should return false when user is not logged in", async () => {
      mockMagicUser.isLoggedIn.mockResolvedValue(false);
      const result = await isMagicLoggedIn();
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockMagicUser.isLoggedIn.mockRejectedValue(new Error("Network error"));
      const result = await isMagicLoggedIn();
      expect(result).toBe(false);
    });

    it("should use E2E mock when in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "true");
      const result = await isMagicLoggedIn();
      expect(result).toBe(true);
    });
  });

  describe("loginWithMagicLink", () => {
    it("should login user with email and return account", async () => {
      const email = "test@example.com";
      mockMagicAuth.loginWithMagicLink.mockResolvedValue(undefined);
      mockMagicUser.getInfo.mockResolvedValue({
        email,
        publicAddress: "GABC123",
      });

      const result = await loginWithMagicLink(email);

      expect(result).toEqual({
        email,
        publicAddress: "GABC123",
        isLoggedIn: true,
      });
      expect(mockMagicAuth.loginWithMagicLink).toHaveBeenCalledWith({
        email,
      });
      expect(mockMagicUser.getInfo).toHaveBeenCalled();
    });

    it("should handle various public address field names", async () => {
      const email = "test@example.com";
      mockMagicAuth.loginWithMagicLink.mockResolvedValue(undefined);
      mockMagicUser.getInfo.mockResolvedValue({
        email,
        walletAddress: "GABC123",
      });

      const result = await loginWithMagicLink(email);

      expect(result.publicAddress).toBe("GABC123");
    });

    it("should handle address field name", async () => {
      const email = "test@example.com";
      mockMagicAuth.loginWithMagicLink.mockResolvedValue(undefined);
      mockMagicUser.getInfo.mockResolvedValue({
        email,
        address: "GABC123",
      });

      const result = await loginWithMagicLink(email);

      expect(result.publicAddress).toBe("GABC123");
    });

    it("should throw error if public address is missing", async () => {
      const email = "test@example.com";
      mockMagicAuth.loginWithMagicLink.mockResolvedValue(undefined);
      mockMagicUser.getInfo.mockResolvedValue({
        email,
      });

      await expect(loginWithMagicLink(email)).rejects.toThrow(
        "Failed to get public address from Magic"
      );
    });

    it("should throw on authentication error", async () => {
      const email = "test@example.com";
      mockMagicAuth.loginWithMagicLink.mockRejectedValue(
        new Error("Authentication failed")
      );

      await expect(loginWithMagicLink(email)).rejects.toThrow(
        "Authentication failed"
      );
    });

    it("should use E2E mock when in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      const email = "test@example.com";
      const result = await loginWithMagicLink(email);

      expect(result.email).toBe(email);
      expect(result.publicAddress).toBe(
        "GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW"
      );
      expect(result.isLoggedIn).toBe(true);
      expect(sessionStorage.getItem("e2e_magic_logged_in")).toBe("true");
      expect(sessionStorage.getItem("e2e_magic_email")).toBe(email);
    });
  });

  describe("loginWithPasskey", () => {
    it("should login user with passkey and return account", async () => {
      mockMagicAuth.loginWithPasskey.mockResolvedValue("did_token");
      mockMagicUser.getInfo.mockResolvedValue({
        email: "passkey@example.com",
        publicAddress: "GABC123",
      });

      const result = await loginWithPasskey();

      expect(result).toEqual({
        email: "passkey@example.com",
        publicAddress: "GABC123",
        isLoggedIn: true,
      });
      expect(mockMagicAuth.loginWithPasskey).toHaveBeenCalled();
    });

    it("should throw error if passkey login not available", async () => {
      mockMagicAuth.loginWithPasskey = undefined;

      await expect(loginWithPasskey()).rejects.toThrow(
        "Passkey login is not available or failed"
      );
    });

    it("should throw error if public address is missing", async () => {
      mockMagicAuth.loginWithPasskey.mockResolvedValue("did_token");
      mockMagicUser.getInfo.mockResolvedValue({
        email: "passkey@example.com",
      });

      await expect(loginWithPasskey()).rejects.toThrow(
        "Failed to get public address from Magic"
      );
    });

    it("should use E2E mock when in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      const result = await loginWithPasskey();

      expect(result.email).toBe("passkey-user");
      expect(result.isLoggedIn).toBe(true);
      expect(sessionStorage.getItem("e2e_magic_logged_in")).toBe("true");
    });
  });

  describe("getMagicUserMetadata", () => {
    it("should return user metadata when logged in", async () => {
      mockMagicUser.isLoggedIn.mockResolvedValue(true);
      mockMagicUser.getInfo.mockResolvedValue({
        email: "user@example.com",
        publicAddress: "GABC123",
      });

      const result = await getMagicUserMetadata();

      expect(result).toEqual({
        email: "user@example.com",
        publicAddress: "GABC123",
        isLoggedIn: true,
      });
    });

    it("should return null when user is not logged in", async () => {
      mockMagicUser.isLoggedIn.mockResolvedValue(false);

      const result = await getMagicUserMetadata();

      expect(result).toBeNull();
    });

    it("should return null on error", async () => {
      mockMagicUser.isLoggedIn.mockRejectedValue(new Error("Error"));

      const result = await getMagicUserMetadata();

      expect(result).toBeNull();
    });

    it("should handle missing public address field", async () => {
      mockMagicUser.isLoggedIn.mockResolvedValue(true);
      mockMagicUser.getInfo.mockResolvedValue({
        email: "user@example.com",
      });

      const result = await getMagicUserMetadata();

      expect(result).toEqual({
        email: "user@example.com",
        publicAddress: "",
        isLoggedIn: true,
      });
    });

    it("should use E2E mock when in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "true");
      sessionStorage.setItem("e2e_magic_email", "e2euser@example.com");
      sessionStorage.setItem(
        "e2e_magic_public_address",
        "GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW"
      );

      const result = await getMagicUserMetadata();

      expect(result).toEqual({
        email: "e2euser@example.com",
        publicAddress:
          "GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW",
        isLoggedIn: true,
      });
    });

    it("should return null when not logged in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "false");

      const result = await getMagicUserMetadata();

      expect(result).toBeNull();
    });
  });

  describe("logoutFromMagic", () => {
    it("should call logout on Magic instance", async () => {
      await logoutFromMagic();
      expect(mockMagicUser.logout).toHaveBeenCalled();
    });

    it("should throw error on logout failure", async () => {
      mockMagicUser.logout.mockRejectedValue(new Error("Logout failed"));

      await expect(logoutFromMagic()).rejects.toThrow("Logout failed");
    });

    it("should clear session storage in E2E mode", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "true");
      sessionStorage.setItem("e2e_magic_email", "test@example.com");
      sessionStorage.setItem("e2e_magic_public_address", "GABC123");

      await logoutFromMagic();

      expect(sessionStorage.getItem("e2e_magic_logged_in")).toBeNull();
      expect(sessionStorage.getItem("e2e_magic_email")).toBeNull();
      expect(sessionStorage.getItem("e2e_magic_public_address")).toBeNull();
    });
  });

  describe("signWithMagic", () => {
    it("should throw error indicating Stellar signing not supported", async () => {
      await expect(signWithMagic("ABCD1234")).rejects.toThrow(
        "Magic wallet does not support Stellar transaction signing yet"
      );
    });

    it("should mention Freighter as alternative", async () => {
      try {
        await signWithMagic("ABCD1234");
      } catch (error: any) {
        expect(error.message).toContain("Freighter wallet");
      }
    });
  });

  describe("session persistence", () => {
    it("should persist login state in sessionStorage", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      const email = "persist@example.com";
      await loginWithMagicLink(email);

      expect(sessionStorage.getItem("e2e_magic_logged_in")).toBe("true");
      expect(sessionStorage.getItem("e2e_magic_email")).toBe(email);
    });

    it("should retrieve persisted login state from sessionStorage", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "true");

      const result = await isMagicLoggedIn();
      expect(result).toBe(true);
    });

    it("should clear session on logout", async () => {
      const { isE2eMockChain } = require("@/lib/e2e-chain-mock");
      isE2eMockChain.mockReturnValue(true);

      sessionStorage.setItem("e2e_magic_logged_in", "true");
      sessionStorage.setItem("e2e_magic_email", "test@example.com");

      await logoutFromMagic();

      expect(sessionStorage.getItem("e2e_magic_logged_in")).toBeNull();
      expect(sessionStorage.getItem("e2e_magic_email")).toBeNull();
    });
  });
});
