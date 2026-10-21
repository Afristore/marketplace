import { useLendingPositions } from "./useLendingPositions";

export function useLenderPositions({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  return {
    lender: walletAddress,
    ...useLendingPositions(walletAddress, "lender"),
  };
}
