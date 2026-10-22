import { useLendingPositions } from "./useLendingPositions";

export function useBorrowerPositions({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  return {
    borrower: walletAddress,
    ...useLendingPositions(walletAddress, "borrower"),
  };
}
