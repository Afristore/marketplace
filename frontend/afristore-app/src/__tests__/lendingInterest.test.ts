import { computeAccruedInterestUsd } from "@/lib/lending";

const DAY = 86400;
const START = 1_700_000_000;

describe("computeAccruedInterestUsd partial-month proration", () => {
  it("multiplies before dividing instead of truncating early", () => {
    // 10.0000004 USD at 1000 bps over 26 partial days.
    // Truncating the monthly term first yields 8_666_666;
    // multiplying first and dividing once yields 8_666_667.
    expect(
      computeAccruedInterestUsd(100_000_004n, [1000], START, START + 26 * DAY)
    ).toBe(8_666_667n);
  });

  it("still charges whole months at the schedule rate", () => {
    // One full month (30 days) at 1000 bps on 100.0000000 USD = 10.0000000 USD.
    expect(
      computeAccruedInterestUsd(1_000_000_000n, [1000], START, START + 30 * DAY)
    ).toBe(100_000_000n);
  });

  it("repeats the last schedule entry once the schedule is exhausted", () => {
    // 60 days at 1000 bps on 100.0000000 USD = 20.0000000 USD.
    expect(
      computeAccruedInterestUsd(1_000_000_000n, [1000], START, START + 60 * DAY)
    ).toBe(200_000_000n);
  });
});
