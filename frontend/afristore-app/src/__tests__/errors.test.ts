/**
 * Unit tests for src/lib/errors.ts.
 *
 * The module turns a raw Soroban RPC error into a message a user can read:
 * a contract error code becomes the message the contract documents, and
 * anything else keeps its own text. The tests below pin every mapped code,
 * the shapes the code is read from, and the fallbacks — so a change to the
 * table or to the patterns cannot quietly change what a user is told.
 */
import {
  SOROBAN_ERROR_MESSAGES,
  extractSorobanContractCode,
  getReadableErrorMessage,
  mapSorobanErrorMessage,
} from "@/lib/errors";

describe("extractSorobanContractCode", () => {
  it("reads the code out of the canonical contract error", () => {
    expect(extractSorobanContractCode("Error(Contract, #1)")).toBe(1);
    expect(extractSorobanContractCode("Error(Contract,#12)")).toBe(12);
    expect(extractSorobanContractCode("Error(Contract,   #7)")).toBe(7);
  });

  it("reads the code whatever the case is", () => {
    expect(extractSorobanContractCode("error(contract, #5)")).toBe(5);
    expect(extractSorobanContractCode("ERROR(CONTRACT, #6)")).toBe(6);
  });

  it("reads the code out of the other shapes an RPC error takes", () => {
    expect(extractSorobanContractCode("ContractError #4")).toBe(4);
    expect(extractSorobanContractCode("Contract error code 9")).toBe(9);
    expect(extractSorobanContractCode('{"contractCode": 11}')).toBe(11);
  });

  it("returns null when there is no code to read", () => {
    expect(extractSorobanContractCode("simulation timed out")).toBeNull();
    expect(extractSorobanContractCode("Error(Contract, #)")).toBeNull();
    expect(extractSorobanContractCode("")).toBeNull();
  });
});

describe("mapSorobanErrorMessage", () => {
  it("maps every documented contract code to its message", () => {
    Object.entries(SOROBAN_ERROR_MESSAGES).forEach(([code, message]) => {
      expect(mapSorobanErrorMessage(`Error(Contract, #${code})`)).toBe(
        `${message} (code ${code})`,
      );
    });
  });

  it("maps a code that the contract documents in any of the shapes", () => {
    expect(mapSorobanErrorMessage("Error(Contract, #5)")).toBe(
      "You are not authorized to perform this action. (code 5)",
    );
    expect(mapSorobanErrorMessage("ContractError #11")).toBe(
      "Your bid is too low for this auction. (code 11)",
    );
  });

  it("returns null for a code that is not documented", () => {
    expect(mapSorobanErrorMessage("Error(Contract, #99)")).toBeNull();
    expect(mapSorobanErrorMessage("Error(Contract, #0)")).toBeNull();
  });

  it("returns null when the error carries no code", () => {
    expect(mapSorobanErrorMessage("simulation timed out")).toBeNull();
    expect(mapSorobanErrorMessage("")).toBeNull();
  });
});

describe("getReadableErrorMessage", () => {
  it("reports a contract error with its documented message", () => {
    expect(
      getReadableErrorMessage(new Error("Error(Contract, #2)")),
    ).toBe("The price is invalid. Please enter a positive value. (code 2)");
  });

  it("keeps the own message of an error that carries no code", () => {
    expect(getReadableErrorMessage(new Error("simulation timed out"))).toBe(
      "simulation timed out",
    );
    expect(getReadableErrorMessage(new Error("auth failed"))).toBe(
      "auth failed",
    );
  });

  it("keeps the own message of a string that carries no code", () => {
    expect(getReadableErrorMessage("simulation timed out")).toBe(
      "simulation timed out",
    );
    expect(getReadableErrorMessage("auth failed")).toBe("auth failed");
  });

  it("reports a string that carries a code with its documented message", () => {
    expect(getReadableErrorMessage("Error(Contract, #22)")).toBe(
      "The contract rejected this request for safety reasons. (code 22)",
    );
  });

  it("keeps a string whose code is not documented", () => {
    expect(getReadableErrorMessage("Error(Contract, #99)")).toBe(
      "Error(Contract, #99)",
    );
  });

  it("falls back for anything that is not an error or a string", () => {
    expect(getReadableErrorMessage(undefined)).toBe(
      "Something went wrong. Please try again.",
    );
    expect(getReadableErrorMessage(null)).toBe(
      "Something went wrong. Please try again.",
    );
    expect(getReadableErrorMessage({ code: 5 })).toBe(
      "Something went wrong. Please try again.",
    );
    expect(getReadableErrorMessage(42)).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("uses the fallback it is given", () => {
    expect(getReadableErrorMessage(undefined, "Could not load the listing")).toBe(
      "Could not load the listing",
    );
    expect(
      getReadableErrorMessage({ code: 5 }, "Could not load the listing"),
    ).toBe("Could not load the listing");
  });
});
