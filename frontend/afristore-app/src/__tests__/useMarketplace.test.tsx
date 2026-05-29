import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useMarketplace } from '@/hooks/useMarketplace';

// Mock indexer and contract
jest.mock('@/lib/indexer', () => ({
  fetchListings: jest.fn().mockResolvedValue({ listings: [
    { listing_id: 1, created_at: 1, status: 'Active', metadata_cid: 'Qm1', price: 10000000n, artist: 'A' }
  ], total: 1 }),
}));

jest.mock('@/lib/contract', () => ({
  getAllListings: jest.fn().mockResolvedValue([]),
}));

function TestComponent() {
  const { listings, isLoading } = useMarketplace();
  return (
    <div>
      <span data-testid="count">{listings.length}</span>
      <span data-testid="loading">{isLoading ? '1' : '0'}</span>
    </div>
  );
}

describe('useMarketplace hook', () => {
  it('loads listings from the indexer', async () => {
    render(<TestComponent />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});
