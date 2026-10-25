import {
  SOROBAN_ERROR_MESSAGES,
  extractSorobanContractCode,
  mapSorobanErrorMessage,
  getReadableErrorMessage,
} from "@/lib/errors";

describe("errors.ts", () => {
  describe("SOROBAN_ERROR_MESSAGES", () => {
    it("should contain expected error codes and messages", () => {
      expect(SOROBAN_ERROR_MESSAGES[1]).toBe(
        "Invalid metadata provided for this artwork."
      );
      expect(SOROBAN_ERROR_MESSAGES[5]).toBe(
        "You are not authorized to perform this action."
      );
      expect(SOROBAN_ERROR_MESSAGES[22]).toBe(
        "The contract rejected this request for safety reasons."
      );
    });

    it("should have valid range of error codes", () => {
      const codes = Object.keys(SOROBAN_ERROR_MESSAGES).map(Number);
      expect(Math.min(...codes)).toBe(1);
      expect(Math.max(...codes)).toBe(22);
    });
  });

  describe("extractSorobanContractCode", () => {
    it("should extract code from Error(Contract, #n) format", () => {
      expect(extractSorobanContractCode("Error(Contract, #5)")).toBe(5);
      expect(extractSorobanContractCode("error(contract, #10)")).toBe(10);
    });

    it("should extract code from ContractError format", () => {
      expect(extractSorobanContractCode("ContractError #7")).toBe(7);
      expect(extractSorobanContractCode("Contract code: 15")).toBe(15);
    });

    it("should extract code from JSON contractCode format", () => {
      expect(extractSorobanContractCode('"contractCode": 3')).toBe(3);
      expect(
        extractSorobanContractCode('{"contractCode": 8, "msg": "error"}')
      ).toBe(8);
    });

    it("should return null for invalid codes", () => {
      expect(extractSorobanContractCode("Error(Contract, #abc)")).toBeNull();
      expect(extractSorobanContractCode("No error code here")).toBeNull();
      expect(extractSorobanContractCode("")).toBeNull();
    });

    it("should return null for non-finite numbers", () => {
      expect(extractSorobanContractCode("Error(Contract, #NaN)")).toBeNull();
      expect(extractSorobanContractCode("Error(Contract, #Infinity)")).toBeNull();
    });

    it("should handle various whitespace patterns", () => {
      expect(extractSorobanContractCode("Error(Contract,  #5)")).toBe(5);
      expect(extractSorobanContractCode("Error(Contract,#5)")).toBe(5);
    });
  });

  describe("mapSorobanErrorMessage", () => {
    it("should map error code to readable message", () => {
      expect(mapSorobanErrorMessage("Error(Contract, #1)")).toBe(
        "Invalid metadata provided for this artwork. (code 1)"
      );
      expect(mapSorobanErrorMessage("Error(Contract, #6)")).toBe(
        "You cannot buy your own listing. (code 6)"
      );
    });

    it("should return null for unmapped error codes", () => {
      expect(mapSorobanErrorMessage("Error(Contract, #99)")).toBeNull();
      expect(mapSorobanErrorMessage("Error(Contract, #999)")).toBeNull();
    });

    it("should return null when code cannot be extracted", () => {
      expect(mapSorobanErrorMessage("Random error message")).toBeNull();
      expect(mapSorobanErrorMessage("")).toBeNull();
    });

    it("should include error code in response", () => {
      const result = mapSorobanErrorMessage("Error(Contract, #2)");
      expect(result).toContain("(code 2)");
    });
  });

  describe("getReadableErrorMessage", () => {
    it("should handle Error objects with Soroban codes", () => {
      const error = new Error("Error(Contract, #4)");
      expect(getReadableErrorMessage(error)).toBe(
        "This listing is no longer active. (code 4)"
      );
    });

    it("should handle string errors with Soroban codes", () => {
      expect(getReadableErrorMessage("Error(Contract, #10)")).toBe(
        "This auction is no longer active. (code 10)"
      );
    });

    it("should fallback to error message when code not found", () => {
      const error = new Error("Custom error message");
      expect(getReadableErrorMessage(error)).toBe("Custom error message");
    });

    it("should fallback to string error when no code found", () => {
      expect(getReadableErrorMessage("Some random error")).toBe(
        "Some random error"
      );
    });

    it("should use default fallback for non-Error objects", () => {
      expect(getReadableErrorMessage(null)).toBe(
        "Something went wrong. Please try again."
      );
      expect(getReadableErrorMessage(undefined)).toBe(
        "Something went wrong. Please try again."
      );
      expect(getReadableErrorMessage(123)).toBe(
        "Something went wrong. Please try again."
      );
    });

    it("should use custom fallback message", () => {
      const customFallback = "Custom fallback message";
      expect(getReadableErrorMessage(null, customFallback)).toBe(
        customFallback
      );
      expect(getReadableErrorMessage({}, customFallback)).toBe(customFallback);
    });

    it("should handle Error with empty message", () => {
      const error = new Error("");
      expect(getReadableErrorMessage(error)).toBe(
        "Something went wrong. Please try again."
      );
    });

    it("should prioritize Soroban mapping over raw error message", () => {
      const error = new Error("Error(Contract, #12)");
      const result = getReadableErrorMessage(error);
      expect(result).toContain("This auction has already expired");
      expect(result).not.toBe("Error(Contract, #12)");
    });
  });
});
