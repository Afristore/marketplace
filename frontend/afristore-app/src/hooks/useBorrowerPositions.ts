import { useLendingPositions, IndexedLendingPosition } from "./useLendingPositions";

export type BorrowerPosition = IndexedLendingPosition;

export interface UseBorrowerPositionsOptions {
  page?: number;
  limit?: number;
}

export function useBorrowerPositions(
  walletAddressOrParams: { walletAddress: string | null } | string | null,
  options?: UseBorrowerPositionsOptions,
) {
  const walletAddress =
    typeof walletAddressOrParams === "object" && walletAddressOrParams !== null
      ? walletAddressOrParams.walletAddress
      : walletAddressOrParams;

  const lending = useLendingPositions(walletAddress, "borrower");

  const data =
    lending.loading || lending.error ? undefined : lending.positions;

  return {
    borrower: walletAddress,
    ...lending,
    data,
    isLoading: lending.loading,
  };
}
