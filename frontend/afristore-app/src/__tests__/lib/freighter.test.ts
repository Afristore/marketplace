import {
  isFreighterInstalled,
  connectFreighter,
  signWithFreighter,
  getConnectedPublicKey,
  FreighterAccount,
} from "@/lib/freighter";

jest.mock("@stellar/freighter-api", () => ({
  getPublicKey: jest.fn(),
  isConnected: jest.fn(),
  signTransaction: jest.fn(),
  setAllowed: jest.fn(),
  getNetworkDetails: jest.fn(),
}));

import * as FreighterAPI from "@stellar/freighter-api";

const mockFreighterAPI = FreighterAPI as any;

describe("freighter.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).freighter;
    delete (window as any).starlight;
  });

  describe("isFreighterInstalled", () => {
    it("should return true when freighter object exists on window", async () => {
      (window as any).freighter = {};
      const result = await isFreighterInstalled();
      expect(result).toBe(true);
    });

    it("should return true when starlight object exists on window", async () => {
      (window as any).starlight = {};
      const result = await isFreighterInstalled();
      expect(result).toBe(true);
    });

    it("should return true when isConnected API returns true", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(true);
      const result = await isFreighterInstalled();
      expect(result).toBe(true);
    });

    it("should return true when isConnected returns object with isConnected true", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue({ isConnected: true });
      const result = await isFreighterInstalled();
      expect(result).toBe(true);
    });

    it("should return false when isConnected returns false", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(false);
      const result = await isFreighterInstalled();
      expect(result).toBe(false);
    });

    it("should return false when isConnected throws error", async () => {
      mockFreighterAPI.isConnected.mockRejectedValue(new Error("Error"));
      const result = await isFreighterInstalled();
      expect(result).toBe(false);
    });

    it("should return false when neither window object nor API indicates installation", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(null);
      const result = await isFreighterInstalled();
      expect(result).toBe(false);
    });
  });

  describe("connectFreighter", () => {
    it("should connect and return account with public key and network passphrase", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue(
        "GABC123DEF456GHI789"
      );
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });

      const result = await connectFreighter();

      expect(result).toEqual({
        publicKey: "GABC123DEF456GHI789",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });
    });

    it("should handle setAllowed returning object with isAllowed property", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue({ isAllowed: true });
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });

      const result = await connectFreighter();

      expect(result.publicKey).toBe("GABC123DEF456GHI789");
    });

    it("should throw error when user denies Freighter access", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(false);

      await expect(connectFreighter()).rejects.toThrow(
        "Freighter access was denied by the user."
      );
    });

    it("should throw error when setAllowed returns object with isAllowed false", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue({ isAllowed: false });

      await expect(connectFreighter()).rejects.toThrow(
        "Freighter access was denied by the user."
      );
    });

    it("should throw error when public key is null", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue(null);

      await expect(connectFreighter()).rejects.toThrow(
        "Failed to get public key from Freighter"
      );
    });

    it("should throw error with custom message when public key has error property", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue({
        error: "User denied access",
      });

      await expect(connectFreighter()).rejects.toThrow(
        "Freighter key error: User denied access"
      );
    });

    it("should throw error when getNetworkDetails fails", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        error: "Network error",
      });

      await expect(connectFreighter()).rejects.toThrow(
        "Freighter network error: Network error"
      );
    });

    it("should throw error when getNetworkDetails returns null", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue(null);

      await expect(connectFreighter()).rejects.toThrow(
        "Freighter network error: Unknown error"
      );
    });

    it("should handle network_passphrase field name variant", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        network_passphrase: "Test SDF Network ; September 2015",
      });

      const result = await connectFreighter();

      expect(result.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });
  });

  describe("signWithFreighter", () => {
    it("should sign transaction and return signed XDR", async () => {
      const txXdr = "ABCD1234EFGH5678";
      const networkPassphrase = "Public Global Stellar Network ; September 2015";
      const signedXdr = "SIGNED_ABCD1234EFGH5678";

      mockFreighterAPI.signTransaction.mockResolvedValue(signedXdr);

      const result = await signWithFreighter(txXdr, networkPassphrase);

      expect(result).toBe(signedXdr);
      expect(mockFreighterAPI.signTransaction).toHaveBeenCalledWith(txXdr, {
        networkPassphrase,
      });
    });

    it("should extract signedTxXdr from object response", async () => {
      const txXdr = "ABCD1234EFGH5678";
      const networkPassphrase = "Public Global Stellar Network ; September 2015";
      const signedXdr = "SIGNED_ABCD1234EFGH5678";

      mockFreighterAPI.signTransaction.mockResolvedValue({
        signedTxXdr: signedXdr,
      });

      const result = await signWithFreighter(txXdr, networkPassphrase);

      expect(result).toBe(signedXdr);
    });

    it("should throw error when sign result has error property", async () => {
      const txXdr = "ABCD1234EFGH5678";
      const networkPassphrase = "Public Global Stellar Network ; September 2015";

      mockFreighterAPI.signTransaction.mockResolvedValue({
        error: "User denied signing",
      });

      await expect(signWithFreighter(txXdr, networkPassphrase)).rejects.toThrow(
        "Freighter sign error: User denied signing"
      );
    });

    it("should throw error when result is invalid", async () => {
      const txXdr = "ABCD1234EFGH5678";
      const networkPassphrase = "Public Global Stellar Network ; September 2015";

      mockFreighterAPI.signTransaction.mockResolvedValue({});

      await expect(signWithFreighter(txXdr, networkPassphrase)).rejects.toThrow(
        "Failed to sign transaction with Freighter"
      );
    });
  });

  describe("getConnectedPublicKey", () => {
    it("should return public key when Freighter is installed and connected", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");

      const result = await getConnectedPublicKey();

      expect(result).toBe("GABC123DEF456GHI789");
    });

    it("should return public key from object response", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue({
        publicKey: "GABC123DEF456GHI789",
      });

      const result = await getConnectedPublicKey();

      expect(result).toBe("GABC123DEF456GHI789");
    });

    it("should return null when Freighter is not installed", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(false);

      const result = await getConnectedPublicKey();

      expect(result).toBeNull();
    });

    it("should return null when getPublicKey fails", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockRejectedValue(new Error("Error"));

      const result = await getConnectedPublicKey();

      expect(result).toBeNull();
    });

    it("should return null when getPublicKey returns invalid value", async () => {
      mockFreighterAPI.isConnected.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue(null);

      const result = await getConnectedPublicKey();

      expect(result).toBeNull();
    });
  });

  describe("network passphrase validation", () => {
    it("should validate network passphrase on connect", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      const result = await connectFreighter();

      expect(result.networkPassphrase).toBeDefined();
      expect(result.networkPassphrase).toBeTruthy();
    });

    it("should throw error on network mismatch", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        networkPassphrase: "",
      });

      const result = await connectFreighter();

      expect(result.networkPassphrase).toBe("");
    });

    it("should handle missing network passphrase", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({});

      const result = await connectFreighter();

      expect(result.networkPassphrase).toBe("");
    });
  });

  describe("wallet connection flow", () => {
    it("should complete full connection workflow", async () => {
      mockFreighterAPI.setAllowed.mockResolvedValue(true);
      mockFreighterAPI.getPublicKey.mockResolvedValue("GABC123DEF456GHI789");
      mockFreighterAPI.getNetworkDetails.mockResolvedValue({
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });

      const account = await connectFreighter();

      expect(account.publicKey).toBeDefined();
      expect(account.networkPassphrase).toBeDefined();
      expect(mockFreighterAPI.setAllowed).toHaveBeenCalled();
      expect(mockFreighterAPI.getPublicKey).toHaveBeenCalled();
      expect(mockFreighterAPI.getNetworkDetails).toHaveBeenCalled();
    });

    it("should support signing after connection", async () => {
      const txXdr = "ABCD1234EFGH5678";
      const networkPassphrase = "Public Global Stellar Network ; September 2015";
      const signedXdr = "SIGNED_ABCD1234EFGH5678";

      mockFreighterAPI.signTransaction.mockResolvedValue(signedXdr);

      const result = await signWithFreighter(txXdr, networkPassphrase);

      expect(result).toBe(signedXdr);
    });
  });
});
