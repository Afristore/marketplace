import {
  DEFAULT_XLM_USD_RATE,
  fetchXlmUsdRate,
  getStaticXlmUsdRate,
  __resetCache,
} from "@/lib/xlmRate";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";

describe("xlmRate.ts", () => {
  beforeEach(() => {
    __resetCache();
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_XLM_USD_RATE;
  });

  describe("DEFAULT_XLM_USD_RATE", () => {
    it("should have a valid default rate", () => {
      expect(DEFAULT_XLM_USD_RATE).toBe(0.12);
      expect(typeof DEFAULT_XLM_USD_RATE).toBe("number");
      expect(DEFAULT_XLM_USD_RATE).toBeGreaterThan(0);
    });
  });

  describe("getStaticXlmUsdRate", () => {
    it("should return default rate when no env var set", () => {
      delete process.env.NEXT_PUBLIC_XLM_USD_RATE;
      expect(getStaticXlmUsdRate()).toBe(DEFAULT_XLM_USD_RATE);
    });

    it("should return env var rate when set", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.25";
      expect(getStaticXlmUsdRate()).toBe(0.25);
    });

    it("should handle decimal rates from env var", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.15999";
      expect(getStaticXlmUsdRate()).toBeCloseTo(0.15999);
    });

    it("should ignore invalid env var and use default", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "invalid";
      expect(getStaticXlmUsdRate()).toBe(DEFAULT_XLM_USD_RATE);
    });

    it("should ignore negative rates and use default", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "-0.5";
      expect(getStaticXlmUsdRate()).toBe(DEFAULT_XLM_USD_RATE);
    });

    it("should ignore zero rate and use default", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0";
      expect(getStaticXlmUsdRate()).toBe(DEFAULT_XLM_USD_RATE);
    });

    it("should ignore empty string and use default", () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "";
      expect(getStaticXlmUsdRate()).toBe(DEFAULT_XLM_USD_RATE);
    });
  });

  describe("fetchXlmUsdRate", () => {
    it("should fetch rate from CoinGecko on first call", async () => {
      const mockRate = 0.18;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: mockRate },
            }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(mockRate);
      expect(global.fetch).toHaveBeenCalledWith(COINGECKO_URL, {
        next: { revalidate: 300 },
      });
    });

    it("should return cached rate on subsequent calls within TTL", async () => {
      const mockRate = 0.19;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: mockRate },
            }),
        } as Response)
      );

      const rate1 = await fetchXlmUsdRate();
      const rate2 = await fetchXlmUsdRate();

      expect(rate1).toBe(mockRate);
      expect(rate2).toBe(mockRate);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should respect cache TTL of 5 minutes", async () => {
      const mockRate = 0.2;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: mockRate },
            }),
        } as Response)
      );

      jest.useFakeTimers();

      const rate1 = await fetchXlmUsdRate();
      expect(rate1).toBe(mockRate);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(4 * 60 * 1000);
      const rate2 = await fetchXlmUsdRate();
      expect(rate2).toBe(mockRate);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2 * 60 * 1000);
      const rate3 = await fetchXlmUsdRate();
      expect(rate3).toBe(mockRate);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it("should fallback to env var when CoinGecko fails", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.22";
      global.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.22);
    });

    it("should fallback to default when both CoinGecko and env var fail", async () => {
      delete process.env.NEXT_PUBLIC_XLM_USD_RATE;
      global.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(DEFAULT_XLM_USD_RATE);
    });

    it("should handle HTTP error responses from CoinGecko", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.23";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.23);
    });

    it("should validate rate is a positive number", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.24";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: -0.5 },
            }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.24);
    });

    it("should handle missing stellar key in response", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.25";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ other: { usd: 100 } }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.25);
    });

    it("should handle missing usd key in response", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.26";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { eur: 0.15 },
            }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.26);
    });

    it("should handle zero rate from CoinGecko", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.27";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: 0 },
            }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.27);
    });

    it("should handle non-number rate from CoinGecko", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.28";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: "not a number" },
            }),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.28);
    });

    it("should handle invalid JSON response", async () => {
      process.env.NEXT_PUBLIC_XLM_USD_RATE = "0.29";
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("Invalid JSON")),
        } as Response)
      );

      const rate = await fetchXlmUsdRate();
      expect(rate).toBe(0.29);
    });
  });

  describe("cache reset", () => {
    it("should reset cache via __resetCache", async () => {
      const mockRate = 0.3;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stellar: { usd: mockRate },
            }),
        } as Response)
      );

      const rate1 = await fetchXlmUsdRate();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      __resetCache();

      const rate2 = await fetchXlmUsdRate();
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(rate1).toBe(rate2);
    });
  });
});
