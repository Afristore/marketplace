import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { parseMarketplaceEvent } from '../parser.js';

describe('parser.ts decoding NFT staking contract events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFromXDR.mockReturnValue({});
  });

  describe('StakedEvent (NFT_STAKED)', () => {
    it('decodes staked event topic and payload into DecodedEvent', () => {
      mockScValToNative
        .mockReturnValueOnce('staked')
        .mockReturnValueOnce({
          owner: 'GUSERSTAKER123',
          token_address: 'CDNFTCOLLECTION999',
          token_id: 42n,
          collection: 'AfroPunks',
          timestamp: 1720000000,
        });

      const decoded = parseMarketplaceEvent(['staked_topic_xdr'], 'value_xdr', 10500);

      expect(decoded).not.toBeNull();
      expect(decoded?.eventType).toBe('NFT_STAKED');
      expect(decoded?.actor).toBe('GUSERSTAKER123');
      expect(decoded?.ledgerSequence).toBe(10500);
      expect(decoded?.data.token_address).toBe('CDNFTCOLLECTION999');
      expect(decoded?.data.token_id).toBe('42');
      expect(decoded?.data.collection).toBe('AfroPunks');
      expect(decoded?.data.timestamp).toBe(1720000000);
    });

    it('extracts actor fallback from staker / user if owner is not present', () => {
      mockScValToNative
        .mockReturnValueOnce('staked')
        .mockReturnValueOnce({
          user: 'GSTAKERFALLBACK',
          token_address: 'CDNFTCOLLECTION999',
          token_id: 1n,
        });

      const decoded = parseMarketplaceEvent(['staked'], 'val', 10501);
      expect(decoded?.actor).toBe('GSTAKERFALLBACK');
      expect(decoded?.eventType).toBe('NFT_STAKED');
    });
  });

  describe('UnstakedEvent (NFT_UNSTAKED)', () => {
    it('decodes unstkd event topic and payload into DecodedEvent', () => {
      mockScValToNative
        .mockReturnValueOnce('unstkd')
        .mockReturnValueOnce({
          owner: 'GUSERSTAKER123',
          token_address: 'CDNFTCOLLECTION999',
          token_id: 42n,
        });

      const decoded = parseMarketplaceEvent(['unstkd_topic_xdr'], 'value_xdr', 10600);

      expect(decoded).not.toBeNull();
      expect(decoded?.eventType).toBe('NFT_UNSTAKED');
      expect(decoded?.actor).toBe('GUSERSTAKER123');
      expect(decoded?.ledgerSequence).toBe(10600);
      expect(decoded?.data.token_address).toBe('CDNFTCOLLECTION999');
      expect(decoded?.data.token_id).toBe('42');
    });
  });


  describe('RewardsClaimedEvent (REWARDS_CLAIMED)', () => {
    it('decodes reward event topic and payload into DecodedEvent', () => {
      mockScValToNative
        .mockReturnValueOnce('reward')
        .mockReturnValueOnce({
          owner: 'GUSERSTAKER123',
          amount: '5000000',
        });

      const decoded = parseMarketplaceEvent(['reward_topic_xdr'], 'value_xdr', 10700);

      expect(decoded).not.toBeNull();
      expect(decoded?.eventType).toBe('REWARDS_CLAIMED');
      expect(decoded?.actor).toBe('GUSERSTAKER123');
      expect(decoded?.ledgerSequence).toBe(10700);
      expect(decoded?.data.amount).toBe('5000000');
    });
  });
});
