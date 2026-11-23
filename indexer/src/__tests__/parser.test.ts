import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock factories so they are available inside vi.mock() closures
const { mockScValToNative, mockFromXDR } = vi.hoisted(() => ({
  mockScValToNative: vi.fn(),
  mockFromXDR: vi.fn(() => ({})),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  xdr: {
    ScVal: {
      fromXDR: mockFromXDR,
    },
  },
  Address: class {},
  scValToNative: mockScValToNative,
}));

import { parseMarketplaceEvent, parseLendingEvent, DecodedEvent } from '../parser';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Sets up mocks for a single parseMarketplaceEvent call.
 * - topicSymbol: the symbol the XDR topic decodes to (e.g. 'lst_crtd')
 * - valueData:   the plain object returned by scValToNative for the value XDR
 */
function setupMocks(topicSymbol: string, valueData: Record<string, any>) {
  // First scValToNative call → topic symbol
  // Second scValToNative call → event value data
  mockScValToNative
    .mockReturnValueOnce(topicSymbol)
    .mockReturnValueOnce(valueData);
}

// ── topic → eventType mapping ─────────────────────────────────────────────────

describe('parseMarketplaceEvent — topic mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  const cases: [string, string][] = [
    ['lst_crtd', 'LISTING_CREATED'],
    ['art_sold', 'ARTWORK_SOLD'],
    ['lst_cncl', 'LISTING_CANCELLED'],
    ['lst_updt', 'LISTING_UPDATED'],
    ['bid_plcd', 'BID_PLACED'],
    ['auc_rslv', 'AUCTION_RESOLVED'],
    ['auc_cncl', 'AUCTION_CANCELLED'],
    ['ofr_made', 'OFFER_MADE'],
    ['ofr_accp', 'OFFER_ACCEPTED'],
    ['ofr_rjct', 'OFFER_REJECTED'],
    ['ofr_wdrn', 'OFFER_WITHDRAWN'],
    ['auc_crtd', 'AUCTION_CREATED'],
    ['pos_liq', 'POSITION_LIQUIDATED'],
    ['Liquidated', 'POSITION_LIQUIDATED'],
    ['cur_wl', 'CURRENCY_WHITELISTED'],
    ['CurrencyWhitelisted', 'CURRENCY_WHITELISTED'],
    ['cur_rmv', 'CURRENCY_REMOVED'],
    ['CurrencyRemoved', 'CURRENCY_REMOVED'],
  ];

  for (const [symbol, expectedType] of cases) {
    it(`maps '${symbol}' → '${expectedType}'`, () => {
      setupMocks(symbol, { listing_id: 1n, artist: 'GA1' });

      const result = parseMarketplaceEvent(['topic_xdr'], 'value_xdr', 42);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe(expectedType);
    });
  }

  it('returns null for an unknown topic symbol', () => {
    setupMocks('unknown_sym', {});
    expect(parseMarketplaceEvent(['topic_xdr'], 'value_xdr', 1)).toBeNull();
  });
});

// ── fallback path (raw string topic) ─────────────────────────────────────────

describe('parseMarketplaceEvent — XDR fallback', () => {
  beforeEach(() => vi.resetAllMocks());

  it('falls back to the raw topic string when XDR parsing throws', () => {
    // First fromXDR call (for topic) throws; second call (for value) succeeds.
    mockFromXDR
      .mockImplementationOnce(() => { throw new Error('bad XDR'); })
      .mockReturnValueOnce({});
    // Only one scValToNative call (for the value) because topic path errored
    mockScValToNative.mockReturnValueOnce({ listing_id: 99n, artist: 'GFALLBACK' });

    const result = parseMarketplaceEvent(['lst_crtd'], 'value_xdr', 10);

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('LISTING_CREATED');
    expect(result!.actor).toBe('GFALLBACK');
  });

  it('returns null when raw fallback topic is not in TOPIC_MAP', () => {
    mockFromXDR.mockImplementationOnce(() => { throw new Error('bad XDR'); });

    const result = parseMarketplaceEvent(['not_a_topic'], 'value_xdr', 10);
    expect(result).toBeNull();
  });
});

// ── listingId extraction ──────────────────────────────────────────────────────

describe('parseMarketplaceEvent — listingId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('extracts listing_id as BigInt', () => {
    setupMocks('lst_crtd', { listing_id: 5n, artist: 'GA' });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    expect(result.listingId).toBe(5n);
  });

  it('extracts auction_id as listingId for auction events', () => {
    setupMocks('auc_crtd', { auction_id: 7n, creator: 'GA_CREATOR' });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    expect(result.listingId).toBe(7n);
  });

  it('sets listingId to null when neither listing_id nor auction_id present', () => {
    setupMocks('ofr_made', { offerer: 'GA_OFFERER' });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    expect(result.listingId).toBeNull();
  });
});

// ── actor extraction ──────────────────────────────────────────────────────────

describe('parseMarketplaceEvent — actor priority', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('picks artist when present', () => {
    setupMocks('lst_crtd', { listing_id: 1n, artist: 'GA_ARTIST' });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('GA_ARTIST');
  });

  it('picks creator when artist is absent', () => {
    setupMocks('auc_crtd', { auction_id: 1n, creator: 'GA_CREATOR' });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('GA_CREATOR');
  });

  it('picks offerer when artist and creator are absent', () => {
    setupMocks('ofr_made', { offerer: 'GA_OFFERER' });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('GA_OFFERER');
  });

  it('picks bidder when others are absent', () => {
    setupMocks('bid_plcd', { bidder: 'GA_BIDDER' });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('GA_BIDDER');
  });

  it('picks buyer when others are absent', () => {
    setupMocks('art_sold', { listing_id: 1n, buyer: 'GA_BUYER' });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('GA_BUYER');
  });

  it('leaves actor as empty string when no known actor field present', () => {
    setupMocks('lst_updt', { listing_id: 1n, new_price: 500n });
    expect(parseMarketplaceEvent(['t'], 'v', 1)!.actor).toBe('');
  });
});

// ── malformed / unrecognized events ──────────────────────────────────────────

describe('parseMarketplaceEvent — malformed / unrecognized events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('returns null when topics array is empty', () => {
    // topics[0] is undefined → XDR parse fails → raw fallback is undefined
    // → not in TOPIC_MAP → returns null
    expect(parseMarketplaceEvent([], 'value_xdr', 1)).toBeNull();
  });

  it('returns null when topics[0] is undefined', () => {
    expect(parseMarketplaceEvent([undefined as unknown as string], 'value_xdr', 1)).toBeNull();
  });

  it('returns null when value XDR is malformed (fromXDR throws)', () => {
    // Topic parsing succeeds
    mockFromXDR
      .mockImplementationOnce(() => ({}))   // topic XDR
      .mockImplementationOnce(() => { throw new Error('bad value XDR'); }); // value XDR
    mockScValToNative.mockReturnValueOnce('lst_crtd'); // topic only, value never reached

    expect(parseMarketplaceEvent(['topic_xdr'], 'BAD_VALUE_XDR', 1)).toBeNull();
  });

  it('returns null when value XDR is an empty string', () => {
    mockFromXDR
      .mockImplementationOnce(() => ({}))   // topic XDR
      .mockImplementationOnce(() => { throw new Error('empty value XDR'); }); // value XDR
    mockScValToNative.mockReturnValueOnce('lst_crtd');

    expect(parseMarketplaceEvent(['topic_xdr'], '', 1)).toBeNull();
  });

  it('returns null when scValToNative throws on value parsing', () => {
    mockFromXDR.mockReturnValueOnce({});   // topic XDR
    mockScValToNative
      .mockReturnValueOnce('lst_crtd')     // topic symbol
      .mockImplementationOnce(() => { throw new Error('scValToNative failed'); }); // value

    expect(parseMarketplaceEvent(['topic_xdr'], 'value_xdr', 1)).toBeNull();
  });

  it('returns null when topic XDR fails and raw fallback is unrecognized', () => {
    mockFromXDR.mockImplementationOnce(() => { throw new Error('bad topic XDR'); });
    // No scValToNative call for topic because the catch block uses raw fallback

    expect(parseMarketplaceEvent(['unknown_raw_topic'], 'value_xdr', 1)).toBeNull();
  });
});

// ── ledgerSequence passthrough ────────────────────────────────────────────────

describe('parseMarketplaceEvent — ledgerSequence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('preserves the supplied ledger sequence number', () => {
    setupMocks('lst_crtd', { listing_id: 1n, artist: 'GA' });
    expect(parseMarketplaceEvent(['t'], 'v', 12345)!.ledgerSequence).toBe(12345);
  });
});

// ── convertBigInts (via data field) ──────────────────────────────────────────

describe('parseMarketplaceEvent — BigInt serialisation in data', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('converts top-level BigInt values to strings in the data payload', () => {
    setupMocks('lst_crtd', { listing_id: 1n, price: 10_000_000n, artist: 'GA' });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    // BigInts in data must be strings (safe for JSON)
    expect(typeof result.data.listing_id).toBe('string');
    expect(result.data.listing_id).toBe('1');
    expect(result.data.price).toBe('10000000');
  });

  it('converts nested BigInt values to strings', () => {
    setupMocks('bid_plcd', {
      listing_id: 2n,
      nested: { amount: 999n },
    });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    expect(result.data.nested.amount).toBe('999');
  });

  it('converts BigInt values inside arrays to strings', () => {
    setupMocks('ofr_made', {
      amounts: [100n, 200n],
    });

    const result = parseMarketplaceEvent(['t'], 'v', 1)!;
    expect(result.data.amounts).toEqual(['100', '200']);
  });
});

// ── LENDING_LISTING_CANCELLED subtopic alignment (#1227) ─────────────────────

describe('parseMarketplaceEvent & parseLendingEvent — LENDING_LISTING_CANCELLED', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('maps lending lst_cncl subtopic to LENDING_LISTING_CANCELLED in parseMarketplaceEvent', () => {
    mockScValToNative
      .mockReturnValueOnce('lending')
      .mockReturnValueOnce('lst_cncl')
      .mockReturnValueOnce({ listing_id: 12n, lender: 'G_LENDER' });

    const result = parseMarketplaceEvent(['t0', 't1'], 'v', 100);
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('LENDING_LISTING_CANCELLED');
    expect(result!.listingId).toBe(12n);
  });

  it('maps lst_cncl to LENDING_LISTING_CANCELLED in parseLendingEvent', () => {
    mockScValToNative
      .mockReturnValueOnce('lending')
      .mockReturnValueOnce('lst_cncl')
      .mockReturnValueOnce({ listing_id: 12n, lender: 'G_LENDER' });

    const result = parseLendingEvent(['t0', 't1'], 'v', 100);
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('LENDING_LISTING_CANCELLED');
    expect(result!.listingId).toBe(12n);
  });
});

// ── DEPLOY_STAKING_POOL topic decoding (#1231) ─────────────────────────────────

describe('parseMarketplaceEvent — publish_staking_deploy (#1231)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  it('decodes (stake, pool) topics to DEPLOY_STAKING_POOL with creator, nft, and pool addresses', () => {
    mockScValToNative
      .mockReturnValueOnce('stake')
      .mockReturnValueOnce('pool')
      .mockReturnValueOnce(['G_CREATOR_ADDR', 'C_NFT_ADDR', 'C_POOL_ADDR']);

    const result = parseMarketplaceEvent(['topic0_xdr', 'topic1_xdr'], 'val_xdr', 500);
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('DEPLOY_STAKING_POOL');
    expect(result!.actor).toBe('G_CREATOR_ADDR');
    expect(result!.ledgerSequence).toBe(500);
    expect(result!.data).toEqual(['G_CREATOR_ADDR', 'C_NFT_ADDR', 'C_POOL_ADDR']);
  });

  it('handles fallback raw strings for ["stake", "pool"]', () => {
    mockFromXDR
      .mockImplementationOnce(() => { throw new Error('bad XDR'); })
      .mockImplementationOnce(() => { throw new Error('bad XDR'); })
      .mockReturnValueOnce({});
    mockScValToNative.mockReturnValueOnce(['G_CREATOR_RAW', 'C_NFT_RAW', 'C_POOL_RAW']);

    const result = parseMarketplaceEvent(['stake', 'pool'], 'val_xdr', 501);
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('DEPLOY_STAKING_POOL');
    expect(result!.actor).toBe('G_CREATOR_RAW');
    expect(result!.ledgerSequence).toBe(501);
    expect(result!.data).toEqual(['G_CREATOR_RAW', 'C_NFT_RAW', 'C_POOL_RAW']);
  });
});
