/**
 * Tests for the indexer API client functions in lib/indexer.ts.
 * These are currently stub implementations that resolve with fixed data,
 * so the tests verify the returned shape/types rather than live API calls.
 */
import {
  getWalletActivity,
  getRoyaltyStats,
  getListingActivity,
  ActivityEvent,
} from '@/lib/indexer';

describe('getWalletActivity', () => {
  it('resolves to an array of ActivityEvent objects', async () => {
    const result = await getWalletActivity('GPUBLIC_KEY_123');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('each event has the required fields', async () => {
    const events = await getWalletActivity('GPUBLIC_KEY_123');
    for (const ev of events) {
      expect(typeof ev.id).toBe('string');
      expect(['PURCHASE', 'LISTED', 'CANCELLED', 'SALE', 'ROYALTY']).toContain(ev.type);
      expect(typeof ev.listing_id).toBe('number');
      expect(typeof ev.price).toBe('string');
      expect(typeof ev.timestamp).toBe('number');
      expect(typeof ev.from).toBe('string');
      expect(typeof ev.to).toBe('string');
      expect(typeof ev.tx_hash).toBe('string');
    }
  });

  it('returns events relevant to the provided public key', async () => {
    const pk = 'GPUBLIC_KEY_UNIQUE';
    const events = await getWalletActivity(pk);
    const relevant = events.filter((ev) => ev.from === pk || ev.to === pk);
    expect(relevant.length).toBeGreaterThan(0);
  });
});

describe('getRoyaltyStats', () => {
  it('resolves with totalEarned, payoutCount and lastPayout', async () => {
    const stats = await getRoyaltyStats('GPUBLIC_KEY_123');
    expect(typeof stats.totalEarned).toBe('string');
    expect(typeof stats.payoutCount).toBe('number');
    expect(typeof stats.lastPayout).toBe('number');
  });

  it('totalEarned is a valid numeric string', async () => {
    const stats = await getRoyaltyStats('GPUBLIC_KEY_123');
    expect(Number.isNaN(parseFloat(stats.totalEarned))).toBe(false);
  });

  it('payoutCount is a non-negative integer', async () => {
    const stats = await getRoyaltyStats('GPUBLIC_KEY_123');
    expect(stats.payoutCount).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(stats.payoutCount)).toBe(true);
  });
});

describe('getListingActivity', () => {
  it('resolves to an array of ActivityEvent objects for the given listingId', async () => {
    const listingId = 42;
    const events = await getListingActivity(listingId);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('all returned events reference the queried listing_id', async () => {
    const listingId = 7;
    const events = await getListingActivity(listingId);
    for (const ev of events) {
      expect(ev.listing_id).toBe(listingId);
    }
  });

  it('event IDs include the listing_id in their identifier', async () => {
    const listingId = 55;
    const events = await getListingActivity(listingId);
    for (const ev of events) {
      expect(ev.id).toContain(String(listingId));
    }
  });

  it('first event is a LISTED type (creation), last is a PURCHASE', async () => {
    const events = await getListingActivity(1);
    expect(events[0].type).toBe('LISTED');
    expect(events[events.length - 1].type).toBe('PURCHASE');
  });
});
