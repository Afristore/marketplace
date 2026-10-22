/**
 * Unit tests for useLendingStats: successful responses, offline-indexer
 * failure handling, refresh, polling and unmount cleanup.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { useLendingStats } from "@/hooks/useLendingStats";

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

const fetchMock = jest.fn();

const okResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

const SAMPLE = {
  tvl: "1000.5",
  volume24h: "500.25",
  activeLoans: 42,
  updatedAt: "2025-10-21T12:00:00Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useLendingStats", () => {
  it("is loading before the first response resolves", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLendingStats());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.stats).toBeNull();
  });

  it("returns parsed stats on a successful response", async () => {
    fetchMock.mockResolvedValue(okResponse(SAMPLE));
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(fetchMock).toHaveBeenCalledWith("/api/lending/stats", {
      headers: { Accept: "application/json" },
    });
    expect(result.current.stats).toEqual({
      tvl: 1000.5,
      volume24h: 500.25,
      activeLoans: 42,
      updatedAt: "2025-10-21T12:00:00Z",
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("defaults missing fields to zero", async () => {
    fetchMock.mockResolvedValue(okResponse({ tvl: "500" }));
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(result.current.stats).toEqual({
      tvl: 500,
      volume24h: 0,
      activeLoans: 0,
      updatedAt: null,
    });
  });

  it("does not crash and exposes an error when the indexer is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("surfaces an error on a non-OK HTTP response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("refresh() re-fetches and replaces the stats", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(SAMPLE))
      .mockResolvedValueOnce(okResponse({ ...SAMPLE, tvl: "2000" }));
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.stats?.tvl).toBe(1000.5));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.stats?.tvl).toBe(2000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers and clears the error after a failed fetch", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(okResponse(SAMPLE));
    const { result } = renderHook(() => useLendingStats());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.stats?.activeLoans).toBe(42));
    expect(result.current.error).toBeNull();
  });

  it("polls every 30 seconds and stops after unmount", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(okResponse(SAMPLE));
    const { unmount } = renderHook(() => useLendingStats());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(29_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
