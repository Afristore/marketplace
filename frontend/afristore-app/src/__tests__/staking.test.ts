import {
  Account,
  Address,
  Keypair,
  SorobanRpc,
  StrKey,
  Transaction,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  estimateApyPercent,
  formatAnnualYieldPerNft,
  formatRewardRatePerDay,
  getSimulationAccount,
  getStakingContract,
  getStakingPoolConfig,
  isValidStellarPublicKey,
  resolveSimulationPublicKey,
} from "@/lib/staking";
import { getConnectedPublicKey } from "@/lib/freighter";
import {
  e2eMockSeedStakingPool,
  resetE2eMockStaking,
} from "@/lib/e2e-chain-mock";

jest.mock("@/lib/freighter", () => ({
  getConnectedPublicKey: jest.fn(),
  signWithFreighter: jest.fn(),
}));

const mockedGetConnectedPublicKey =
  getConnectedPublicKey as jest.MockedFunction<typeof getConnectedPublicKey>;

/**
 * The legacy hardcoded 55-character DUMMY_KEY that was previously in staking.ts.
 * It is 1 character short of a valid 56-char Stellar Ed25519 public key.
 */
const LEGACY_MALFORMED_DUMMY_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function generateContractAddress(seedByte: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seedByte));
}

describe("staking.ts — simulation account resolution & pool config", () => {
  const originalEnv = process.env;
  const validPoolContractId = generateContractAddress(0x11);
  const validNftContractId = generateContractAddress(0x22);
  const validRewardTokenId = generateContractAddress(0x33);

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT;
    delete process.env.NEXT_PUBLIC_E2E_MOCK_CHAIN;
    mockedGetConnectedPublicKey.mockResolvedValue(null);
    resetE2eMockStaking();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("isValidStellarPublicKey", () => {
    it("returns true for a valid 56-character Stellar Ed25519 public key", () => {
      const validKey = Keypair.random().publicKey();
      expect(isValidStellarPublicKey(validKey)).toBe(true);
      expect(isValidStellarPublicKey(`  ${validKey}  `)).toBe(true);
    });

    it("returns false for empty, malformed, contract (C...), or the legacy 55-char DUMMY_KEY", () => {
      expect(isValidStellarPublicKey("")).toBe(false);
      expect(isValidStellarPublicKey("   ")).toBe(false);
      expect(isValidStellarPublicKey("INVALID_KEY")).toBe(false);
      expect(isValidStellarPublicKey(LEGACY_MALFORMED_DUMMY_KEY)).toBe(false);
      expect(isValidStellarPublicKey(validPoolContractId)).toBe(false);
    });
  });

  describe("resolveSimulationPublicKey", () => {
    it("returns the explicit callerPublicKey when valid (trimmed)", async () => {
      const explicitKey = Keypair.random().publicKey();
      const resolved = await resolveSimulationPublicKey(`  ${explicitKey}  `);

      expect(resolved).toBe(explicitKey);
      expect(mockedGetConnectedPublicKey).not.toHaveBeenCalled();
    });

    it("throws a descriptive error when explicit callerPublicKey is empty or malformed", async () => {
      await expect(resolveSimulationPublicKey("")).rejects.toThrow(
        "Invalid simulation caller public key: must be a valid Stellar Ed25519 public key (G...).",
      );

      await expect(resolveSimulationPublicKey("   ")).rejects.toThrow(
        "Invalid simulation caller public key: must be a valid Stellar Ed25519 public key (G...).",
      );

      await expect(
        resolveSimulationPublicKey(LEGACY_MALFORMED_DUMMY_KEY),
      ).rejects.toThrow(
        "Invalid simulation caller public key: must be a valid Stellar Ed25519 public key (G...).",
      );
    });

    it("uses the connected wallet public key when valid and no explicit caller is passed", async () => {
      const walletKey = Keypair.random().publicKey();
      const envKey = Keypair.random().publicKey();
      mockedGetConnectedPublicKey.mockResolvedValue(walletKey);
      process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT = envKey;

      const resolved = await resolveSimulationPublicKey();

      expect(resolved).toBe(walletKey);
      expect(mockedGetConnectedPublicKey).toHaveBeenCalledTimes(1);
    });

    it("ignores connected wallet errors or invalid keys and falls back to NEXT_PUBLIC_SIMULATION_ACCOUNT", async () => {
      const envKey = Keypair.random().publicKey();
      process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT = envKey;

      mockedGetConnectedPublicKey.mockRejectedValueOnce(
        new Error("Freighter extension locked"),
      );
      expect(await resolveSimulationPublicKey()).toBe(envKey);

      mockedGetConnectedPublicKey.mockResolvedValueOnce(
        LEGACY_MALFORMED_DUMMY_KEY,
      );
      expect(await resolveSimulationPublicKey()).toBe(envKey);
    });

    it("throws a descriptive error when NEXT_PUBLIC_SIMULATION_ACCOUNT is invalid and no wallet is connected", async () => {
      mockedGetConnectedPublicKey.mockResolvedValue(null);
      process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT = "NOT_A_STELLAR_PUBLIC_KEY";

      await expect(resolveSimulationPublicKey()).rejects.toThrow(
        "Invalid NEXT_PUBLIC_SIMULATION_ACCOUNT: must be a valid Stellar Ed25519 public key (G...).",
      );
    });

    it("dynamically generates a valid ephemeral Stellar Ed25519 public key when neither wallet nor env var is configured", async () => {
      mockedGetConnectedPublicKey.mockResolvedValue(null);
      delete process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT;

      const keyA = await resolveSimulationPublicKey();
      const keyB = await resolveSimulationPublicKey();

      expect(StrKey.isValidEd25519PublicKey(keyA)).toBe(true);
      expect(StrKey.isValidEd25519PublicKey(keyB)).toBe(true);
      expect(keyA).not.toBe(LEGACY_MALFORMED_DUMMY_KEY);
      expect(keyA).not.toBe(keyB);
    });
  });

  describe("getSimulationAccount", () => {
    it("returns the on-chain Account from rpc.getAccount when the simulation account is funded", async () => {
      const fundedKey = Keypair.random().publicKey();
      const onChainAccount = new Account(fundedKey, "4200001");
      const mockRpc = {
        getAccount: jest.fn().mockResolvedValue(onChainAccount),
      } as unknown as SorobanRpc.Server;

      const result = await getSimulationAccount(mockRpc, fundedKey);

      expect(mockRpc.getAccount).toHaveBeenCalledWith(fundedKey);
      expect(result).toBe(onChainAccount);
      expect(result.accountId()).toBe(fundedKey);
      expect(result.sequenceNumber()).toBe("4200001");
    });

    it("falls back to a synthetic Account(publicKey, '0') when rpc.getAccount rejects (e.g. 404 unfunded account)", async () => {
      const unfundedKey = Keypair.random().publicKey();
      const mockRpc = {
        getAccount: jest
          .fn()
          .mockRejectedValue(new Error(`Account not found: ${unfundedKey}`)),
      } as unknown as SorobanRpc.Server;

      const result = await getSimulationAccount(mockRpc, unfundedKey);

      expect(mockRpc.getAccount).toHaveBeenCalledWith(unfundedKey);
      expect(result.accountId()).toBe(unfundedKey);
      expect(result.sequenceNumber()).toBe("0");
    });
  });

  describe("getStakingPoolConfig", () => {
    it("queries get_nft_address, get_reward_token, and get_reward_rate using the resolved simulation account", async () => {
      const connectedKey = Keypair.random().publicKey();
      mockedGetConnectedPublicKey.mockResolvedValue(connectedKey);

      const getAccountSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "getAccount")
        .mockImplementation(async (address: string) => {
          return new Account(address, "100");
        });

      const observedSourceAccounts: string[] = [];
      const simulateSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockImplementation(async (tx) => {
          const standardTx = tx as Transaction;
          observedSourceAccounts.push(standardTx.source);
          const callIndex = observedSourceAccounts.length;

          const retval =
            callIndex === 1
              ? new Address(validNftContractId).toScVal()
              : callIndex === 2
                ? new Address(validRewardTokenId).toScVal()
                : nativeToScVal(250n, { type: "i128" });

          return {
            id: `sim-${callIndex}`,
            latestLedger: 1234,
            events: [],
            result: {
              auth: [],
              retval,
            },
          } as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse;
        });

      const poolConfig = await getStakingPoolConfig(validPoolContractId);

      expect(poolConfig).toEqual({
        nftAddress: validNftContractId,
        rewardToken: validRewardTokenId,
        rewardRate: 250n,
      });
      expect(getAccountSpy).toHaveBeenCalledTimes(3);
      expect(getAccountSpy).toHaveBeenCalledWith(connectedKey);
      expect(simulateSpy).toHaveBeenCalledTimes(3);
      expect(observedSourceAccounts).toEqual([
        connectedKey,
        connectedKey,
        connectedKey,
      ]);
      expect(observedSourceAccounts).not.toContain(LEGACY_MALFORMED_DUMMY_KEY);
    });

    it("succeeds even when rpc.getAccount rejects with 404 on an unfunded ephemeral simulation account", async () => {
      mockedGetConnectedPublicKey.mockResolvedValue(null);
      delete process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT;

      const getAccountSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "getAccount")
        .mockRejectedValue(new Error("404 Not Found"));

      let callCount = 0;
      const observedSourceAccounts: string[] = [];
      jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockImplementation(async (tx) => {
          const standardTx = tx as Transaction;
          observedSourceAccounts.push(standardTx.source);
          callCount += 1;

          const retval =
            callCount === 1
              ? new Address(validNftContractId).toScVal()
              : callCount === 2
                ? new Address(validRewardTokenId).toScVal()
                : nativeToScVal(500n, { type: "i128" });

          return {
            id: `sim-${callCount}`,
            latestLedger: 5678,
            events: [],
            result: {
              auth: [],
              retval,
            },
          } as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse;
        });

      const poolConfig = await getStakingPoolConfig(validPoolContractId);

      expect(poolConfig).toEqual({
        nftAddress: validNftContractId,
        rewardToken: validRewardTokenId,
        rewardRate: 500n,
      });
      expect(getAccountSpy).toHaveBeenCalledTimes(3);
      expect(observedSourceAccounts).toHaveLength(3);
      expect(StrKey.isValidEd25519PublicKey(observedSourceAccounts[0])).toBe(
        true,
      );
      expect(observedSourceAccounts[0]).toBe(observedSourceAccounts[1]);
      expect(observedSourceAccounts[1]).toBe(observedSourceAccounts[2]);
    });

    it("returns the E2E mock staking pool config when NEXT_PUBLIC_E2E_MOCK_CHAIN=true", async () => {
      process.env.NEXT_PUBLIC_E2E_MOCK_CHAIN = "true";
      const seededPoolId = e2eMockSeedStakingPool(validNftContractId, 777n);

      const poolConfig = await getStakingPoolConfig(seededPoolId);

      expect(poolConfig.nftAddress).toBe(validNftContractId);
      expect(poolConfig.rewardRate).toBe(777n);
      expect(poolConfig.rewardToken).toBeTruthy();
    });

    it("propagates validation errors when callerPublicKey or NEXT_PUBLIC_SIMULATION_ACCOUNT is invalid", async () => {
      await expect(
        getStakingPoolConfig(validPoolContractId, "INVALID_CALLER_KEY"),
      ).rejects.toThrow(
        "Invalid simulation caller public key: must be a valid Stellar Ed25519 public key (G...).",
      );

      process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT = "INVALID_ENV_KEY";
      await expect(getStakingPoolConfig(validPoolContractId)).rejects.toThrow(
        "Invalid NEXT_PUBLIC_SIMULATION_ACCOUNT: must be a valid Stellar Ed25519 public key (G...).",
      );
    });

    it("throws when poolContractId is empty and NEXT_PUBLIC_STAKING_CONTRACT_ID is not configured", async () => {
      const callerKey = Keypair.random().publicKey();
      await expect(getStakingPoolConfig("", callerKey)).rejects.toThrow(
        "Staking pool contract ID not configured",
      );
      expect(() => getStakingContract("")).toThrow(
        "Staking pool contract ID not configured",
      );
    });

    it("maps Soroban simulation errors into readable error messages", async () => {
      const callerKey = Keypair.random().publicKey();
      jest
        .spyOn(SorobanRpc.Server.prototype, "getAccount")
        .mockResolvedValue(new Account(callerKey, "1"));
      jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockResolvedValue({
          id: "sim-err",
          latestLedger: 100,
          error: "HostError: Error(Contract, #5)",
        } as unknown as SorobanRpc.Api.SimulateTransactionErrorResponse);

      await expect(
        getStakingPoolConfig(validPoolContractId, callerKey),
      ).rejects.toThrow("You are not authorized to perform this action. (code 5)");
    });
  });

  describe("Yield & APY formatting utilities", () => {
    it("formats annual yield per NFT from 7-decimal stroops per second", () => {
      expect(formatAnnualYieldPerNft(0n)).toBe("0");
      expect(formatAnnualYieldPerNft(10_000_000n)).toBe("31536000");
      expect(formatAnnualYieldPerNft(1n)).toBe("3.1536");
    });

    it("estimates APY proxy percentage based on reward rate and staked NFT count", () => {
      expect(estimateApyPercent(0n, 0)).toBe("0");
      expect(estimateApyPercent(100n, 0)).toBe("—");
      expect(estimateApyPercent(10_000_000n, 1)).toBe(
        (31536000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      );
    });

    it("formats daily reward rate from 7-decimal stroops per second", () => {
      expect(formatRewardRatePerDay(0n)).toBe("0");
      expect(formatRewardRatePerDay(10_000_000n)).toBe("86400");
      expect(formatRewardRatePerDay(1n)).toBe("0.00864");
    });
  });
});
