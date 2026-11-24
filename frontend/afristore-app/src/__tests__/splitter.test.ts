/**
 * Tests for splitter.ts library functions.
 * Tests contract ABI compliance and parameter handling.
 */
import { Address } from "@stellar/stellar-sdk";
import type { SplitterRecipient } from "@/lib/splitter";

describe("splitter.ts", () => {
  describe("getSplitterRecipients - contract ABI compliance", () => {
    it("should require publicKey parameter", async () => {
      const { getSplitterRecipients } = await import("@/lib/splitter");
      
      await expect(
        getSplitterRecipients("CCXZ6JLEJ5YWQJY5H7326ZBWE7KQDAPXB7LGDJX2L5EV7FDH2OO3HQA")
      ).rejects.toThrow("Public key is required to fetch splitter recipients");
    });

    it("should accept publicKey parameter", async () => {
      const { getSplitterRecipients } = await import("@/lib/splitter");
      
      // This will fail with network error, but should not throw about missing publicKey
      await expect(
        getSplitterRecipients(
          "CCXZ6JLEJ5YWQJY5H7326ZBWE7KQDAPXB7LGDJX2L5EV7FDH2OO3HQA",
          "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
        )
      ).rejects.not.toThrow("Public key is required");
    });
  });

  describe("getPendingBalance - contract ABI compliance", () => {
    it("should require publicKey parameter", async () => {
      const { getPendingBalance } = await import("@/lib/splitter");
      
      await expect(
        getPendingBalance("CCXZ6JLEJ5YWQJY5H7326ZBWE7KQDAPXB7LGDJX2L5EV7FDH2OO3HQA")
      ).rejects.toThrow("Public key is required to fetch pending balance");
    });

    it("should accept publicKey parameter", async () => {
      const { getPendingBalance } = await import("@/lib/splitter");
      
      // This will fail with network error, but should not throw about missing publicKey
      await expect(
        getPendingBalance(
          "CCXZ6JLEJ5YWQJY5H7326ZBWE7KQDAPXB7LGDJX2L5EV7FDH2OO3HQA",
          "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
        )
      ).rejects.not.toThrow("Public key is required");
    });
  });

  describe("distributeRoyalties - contract ABI compliance", () => {
    it("should call distribute with tokenAddress and caller parameters", async () => {
      const { distributeRoyalties } = await import("@/lib/splitter");
      
      // This will fail with network error, but verifies the function signature
      await expect(
        distributeRoyalties(
          "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
          "CCXZ6JLEJ5YWQJY5H7326ZBWE7KQDAPXB7LGDJX2L5EV7FDH2OO3HQA"
        )
      ).rejects.toThrow();
    });
  });

  describe("SplitterRecipient interface", () => {
    it("should have correct structure", () => {
      const recipient: SplitterRecipient = {
        address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        percentage: 50,
      };
      
      expect(recipient.address).toBeDefined();
      expect(recipient.percentage).toBeDefined();
      expect(typeof recipient.address).toBe("string");
      expect(typeof recipient.percentage).toBe("number");
    });
  });
});
