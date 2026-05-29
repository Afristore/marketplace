/**
 * Component tests for ListingCard.
 * All external dependencies (wallet context, blockchain hooks, IPFS, Next.js
 * primitives) are mocked so the suite runs without any network access.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Dependency mocks ──────────────────────────────────────────────────────────

// Next.js Link — render as a plain <a>
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Next.js Image — render as a plain <img>, stripping Next-only props that
// are not valid DOM attributes (fill, unoptimized, priority, sizes, quality).
jest.mock('next/image', () => ({
  __esModule: true,
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & {
      fill?: boolean;
      unoptimized?: boolean;
      priority?: boolean;
      quality?: number;
    }
  ) => {
    const { fill: _fill, unoptimized: _unoptimized, priority: _priority, quality: _quality, alt, ...rest } = props;
    return <img alt={alt || ''} {...rest} />;
  },
}));

// WalletContext
jest.mock('@/context/WalletContext', () => ({
  useWalletContext: () => ({
    publicKey: 'GBUYER123',
    status: 'connected',
  }),
}));

// useBuyArtwork hook
const mockBuy = jest.fn().mockResolvedValue(true);
jest.mock('@/hooks/useMarketplace', () => ({
  useBuyArtwork: () => ({
    buy: mockBuy,
    isBuying: false,
    error: null,
  }),
}));

// IPFS helpers
jest.mock('@/lib/ipfs', () => ({
  fetchMetadata: jest.fn().mockResolvedValue({
    title: 'Test Artwork',
    description: 'A beautiful test piece',
    image: 'QmImageCid',
    year: 2024,
  }),
  cidToGatewayUrl: (cid: string) => `https://ipfs.io/ipfs/${cid}`,
}));

// WalletGuard — render children directly
jest.mock('@/components/WalletGuard', () => ({
  GuardButton: ({
    children,
    onAction,
    disabled,
    className,
    title,
  }: {
    children: React.ReactNode;
    onAction: () => void;
    disabled?: boolean;
    className?: string;
    title?: string;
  }) => (
    <button onClick={onAction} disabled={disabled} className={className} title={title}>
      {children}
    </button>
  ),
}));

// CheckoutModal — call onCryptoPurchase immediately when opened so tests
// that click "Buy Now" can still assert buy() was invoked without rendering
// the full modal UI.
jest.mock('@/components/CheckoutModal', () => ({
  CheckoutModal: ({
    isOpen,
    onCryptoPurchase,
  }: {
    isOpen: boolean;
    onCryptoPurchase: () => Promise<boolean>;
    onClose: () => void;
    onPurchased?: () => void;
    isBuyingCrypto: boolean;
    listing: unknown;
  }) => {
    if (!isOpen) return null;
    // Render a confirm button so the test can trigger the purchase
    return (
      <button
        data-testid="checkout-confirm"
        onClick={() => onCryptoPurchase()}
      >
        Confirm Purchase
      </button>
    );
  },
}));

import { ListingCard } from '@/components/ListingCard';
import type { Listing } from '@/lib/contract';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    listing_id: 1,
    artist: 'GARTIST123',
    metadata_cid: 'QmTestCid',
    price: 10_000_000n, // 1 XLM
    currency: 'XLM',
    token: 'CTOKEN',
    recipients: [{ address: 'GARTIST123', percentage: 100 }],
    status: 'Active',
    owner: null,
    created_at: 1000,
    original_creator: 'GARTIST123',
    royalty_bps: 500,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ListingCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the listing price in XLM', async () => {
    render(<ListingCard listing={makeListing()} />);
    // 10_000_000 stroops = 1 XLM
    await waitFor(() => {
      expect(screen.getByText(/1\s*XLM/i)).toBeInTheDocument();
    });
  });

  it('renders the Active status badge for active listings', async () => {
    render(<ListingCard listing={makeListing({ status: 'Active' })} />);
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('renders the Sold status badge for sold listings', async () => {
    render(<ListingCard listing={makeListing({ status: 'Sold' })} />);
    await waitFor(() => {
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });
  });

  it('renders the Cancelled status badge for cancelled listings', async () => {
    render(<ListingCard listing={makeListing({ status: 'Cancelled' })} />);
    await waitFor(() => {
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });
  });

  it('shows the artwork title from IPFS metadata', async () => {
    render(<ListingCard listing={makeListing()} />);
    await waitFor(() => {
      expect(screen.getByText('Test Artwork')).toBeInTheDocument();
    });
  });

  it('shows the artwork description from IPFS metadata', async () => {
    render(<ListingCard listing={makeListing()} />);
    await waitFor(() => {
      expect(screen.getByText('A beautiful test piece')).toBeInTheDocument();
    });
  });

  it('shows a truncated artist address', async () => {
    render(<ListingCard listing={makeListing({ artist: 'GARTIST1234567890' })} />);
    await waitFor(() => {
      // Component truncates: first 8 chars + ellipsis + last 4 chars
      expect(screen.getByText(/GARTIST1…7890/)).toBeInTheDocument();
    });
  });

  it('shows a Buy Now button for Active listings when viewer is not the artist', async () => {
    // Buyer public key (GBUYER123) ≠ artist (GARTIST123)
    render(<ListingCard listing={makeListing()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument();
    });
  });

  it('disables the buy button when viewer is the listing artist', async () => {
    // Override artist to match the mocked wallet public key
    render(<ListingCard listing={makeListing({ artist: 'GBUYER123' })} />);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /yours/i });
      expect(btn).toBeDisabled();
    });
  });

  it('does not render a Buy button for Sold listings', async () => {
    render(<ListingCard listing={makeListing({ status: 'Sold' })} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /buy/i })).not.toBeInTheDocument();
    });
  });

  it('calls buy with the listing id when Buy Now is clicked through checkout modal', async () => {
    const user = userEvent.setup();
    render(<ListingCard listing={makeListing({ listing_id: 7 })} />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /buy now/i })).toBeInTheDocument()
    );

    // Click "Buy Now" — this opens the CheckoutModal
    await user.click(screen.getByRole('button', { name: /buy now/i }));

    // Confirm purchase through the mocked modal
    await waitFor(() =>
      expect(screen.getByTestId('checkout-confirm')).toBeInTheDocument()
    );
    await user.click(screen.getByTestId('checkout-confirm'));

    await waitFor(() => expect(mockBuy).toHaveBeenCalledWith(7));
  });

  it('links the image to the listing detail page', async () => {
    render(<ListingCard listing={makeListing({ listing_id: 3 })} />);
    await waitFor(() => {
      const links = screen.getAllByRole('link');
      expect(links.some((l) => l.getAttribute('href') === '/listings/3')).toBe(true);
    });
  });

  it('shows a fallback title when IPFS metadata is unavailable', async () => {
    const { fetchMetadata } = jest.requireMock('@/lib/ipfs');
    fetchMetadata.mockRejectedValueOnce(new Error('IPFS down'));

    render(<ListingCard listing={makeListing({ listing_id: 99 })} />);
    await waitFor(() => {
      expect(screen.getByText('Artwork #99')).toBeInTheDocument();
    });
  });

  it('renders a loading state initially', async () => {
    const { fetchMetadata } = jest.requireMock('@/lib/ipfs');
    let resolvePromise: any;
    fetchMetadata.mockReturnValueOnce(new Promise((resolve) => { resolvePromise = resolve; }));
    
    render(<ListingCard listing={makeListing()} />);
    expect(screen.getByTestId('artwork-loading')).toBeInTheDocument();
    
    resolvePromise({ title: 'Delayed Title' });
    await waitFor(() => {
      expect(screen.queryByTestId('artwork-loading')).not.toBeInTheDocument();
    });
  });

  it('renders the missing artwork fallback when metadata lacks an image', async () => {
    const { fetchMetadata } = jest.requireMock('@/lib/ipfs');
    fetchMetadata.mockResolvedValueOnce({ title: 'No Image', description: 'desc' });
    
    render(<ListingCard listing={makeListing()} />);
    await waitFor(() => {
      expect(screen.getByTestId('artwork-missing')).toBeInTheDocument();
    });
  });

  it('renders the missing artwork fallback when metadata fetch fails', async () => {
    const { fetchMetadata } = jest.requireMock('@/lib/ipfs');
    fetchMetadata.mockRejectedValueOnce(new Error('IPFS down'));
    
    render(<ListingCard listing={makeListing()} />);
    await waitFor(() => {
      expect(screen.getByTestId('artwork-missing')).toBeInTheDocument();
    });
  });
});

// ── Image mock regression (#105) ──────────────────────────────────────────────

describe('next/image mock', () => {
  const NextImage = jest.requireMock('next/image').default as React.FC<Record<string, unknown>>;

  it('does not forward unoptimized to the DOM element', () => {
    const { container } = render(
      <NextImage src="/test.png" alt="test" unoptimized width={100} height={100} />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.hasAttribute('unoptimized')).toBe(false);
  });

  it('does not forward fill to the DOM element', () => {
    const { container } = render(
      <NextImage src="/test.png" alt="test" fill />
    );
    const img = container.querySelector('img');
    expect(img!.hasAttribute('fill')).toBe(false);
  });

  it('preserves alt and src attributes', () => {
    const { container } = render(
      <NextImage src="/test.png" alt="my image" unoptimized width={80} height={80} />
    );
    const img = container.querySelector('img');
    expect(img!.getAttribute('alt')).toBe('my image');
    expect(img!.getAttribute('src')).toBe('/test.png');
  });
});
