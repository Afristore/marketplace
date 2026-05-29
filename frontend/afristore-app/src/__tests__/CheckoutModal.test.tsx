import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CheckoutModal } from '@/components/CheckoutModal';

const sampleListing = {
  listing_id: 1,
  price: 10000000n, // 1 XLM in stroops
  metadata_cid: 'QmTest',
  status: 'Active',
  artist: 'GARTIST',
} as any;

describe('CheckoutModal', () => {
  it('calls onCryptoPurchase and onClose when crypto purchase succeeds', async () => {
    const onClose = jest.fn();
    const onPurchased = jest.fn();
    const onCryptoPurchase = jest.fn().mockResolvedValue(true);

    render(
      <CheckoutModal
        isOpen={true}
        onClose={onClose}
        listing={sampleListing}
        onCryptoPurchase={onCryptoPurchase}
        onPurchased={onPurchased}
        isBuyingCrypto={false}
      />
    );

    // Click the Pay button
    const payButton = screen.getByRole('button', { name: /Pay/i });
    fireEvent.click(payButton);

    await waitFor(() => expect(onCryptoPurchase).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
