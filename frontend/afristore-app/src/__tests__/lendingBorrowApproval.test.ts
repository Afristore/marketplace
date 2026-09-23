/**
 * Unit tests for the collateral approval flow in lib/lending.ts borrow().
 *
 * The borrow flow must reuse an existing on-chain allowance instead of
 * requesting a fresh approval (and an extra signature + gas) every time.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAccount = jest.fn().mockResolvedValue({ accountId: "GBORROWER" });
const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest
  .fn()
  .mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
const mockGetTransaction = jest
  .fn()
  .mockResolvedValue({ status: "SUCCESS", returnValue: null });
const mockSignWithFreighter = jest.fn().mockResolvedValue("signed-xdr");

jest.mock("@stellar/stellar-sdk", () => {
  class Contract {
    constructor(public contractId: string) {}
    call(...args: unknown[]) {
      return { contractId: this.contractId, args };
    }
  }

  class TransactionBuilder {
    constructor(public account: unknown, public opts: unknown) {}
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { toXDR: () => "unsigned-xdr" };
    }
    static fromXDR() {
      return { toXDR: () => "signed-xdr" };
    }
  }

  class Address {
    constructor(public address: string) {}
    toScVal() {
      return this.address;
    }
  }

  return {
    Contract,
    TransactionBuilder,
    Address,
    BASE_FEE: "100",
    xdr: {},
    nativeToScVal: (value: unknown) => value,
    scValToNative: (value: unknown) => value,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: (...args: unknown[]) => mockGetAccount(...args),
        simulateTransaction: (...args: unknown[]) =>
          mockSimulateTransaction(...args),
        sendTransaction: (...args: unknown[]) => mockSendTransaction(...args),
        getTransaction: (...args: unknown[]) => mockGetTransaction(...args),
      })),
      assembleTransaction: (tx: unknown) => ({ build: () => tx }),
      Api: {
        isSimulationError: () => false,
        GetTransactionStatus: {
          NOT_FOUND: "NOT_FOUND",
          FAILED: "FAILED",
          SUCCESS: "SUCCESS",
        },
      },
    },
  };
});

jest.mock("@/lib/config", () => ({
  config: {
    lendingContractId: "CLENDINGCONTRACT",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

jest.mock("@/lib/freighter", () => ({
  getConnectedPublicKey: jest.fn().mockResolvedValue("GBORROWER"),
  signWithFreighter: (...args: unknown[]) => mockSignWithFreighter(...args),
}));

jest.mock("@/lib/contract", () => ({
  invokeContract: jest.fn(),
}));

jest.mock("@/lib/errors", () => ({
  mapSorobanErrorMessage: () => null,
}));

jest.mock("@/lib/e2e-chain-mock", () => ({
  isE2eMockChain: () => false,
  e2eMockWhitelistCurrency: jest.fn(),
  e2eMockUpdateBounds: jest.fn(),
  e2eMockLendingAdmin: jest.fn(),
}));

import { borrow } from "@/lib/lending";

const COLLATERAL = "GCOLLATERALTOKEN";

/** Queue simulateTransaction retvals in the order the flow reads them. */
function queueSimulations(...retvals: unknown[]) {
  mockSimulateTransaction.mockReset();
  for (const retval of retvals) {
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval } });
  }
}

describe("lib/lending borrow() collateral approval", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue({ accountId: "GBORROWER" });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "tx-hash",
    });
    mockGetTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: null,
    });
    mockSignWithFreighter.mockResolvedValue("signed-xdr");
  });

  it("skips the approval transaction when the current allowance already covers the collateral", async () => {
    // balance 1000n, allowance 500n, borrowing 300n → approval not needed,
    // then the borrow simulation.
    queueSimulations(1000n, 500n, null);

    const result = await borrow("GBORROWER", 7n, COLLATERAL, 300n);

    expect(result).toBe(101);
    // Only the borrow transaction is signed — no approval signature/transaction.
    expect(mockSignWithFreighter).toHaveBeenCalledTimes(1);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    // balance + allowance + borrow simulation.
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
  });

  it("requests an approval when the current allowance is below the collateral amount", async () => {
    // balance 1000n, allowance 100n, borrowing 300n → approval required.
    queueSimulations(1000n, 100n, null, null);

    const result = await borrow("GBORROWER", 7n, COLLATERAL, 300n);

    expect(result).toBe(101);
    // Approval + borrow transactions are both signed and sent.
    expect(mockSignWithFreighter).toHaveBeenCalledTimes(2);
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });
});
