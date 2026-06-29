## Known Issues & Warnings

### Stellar SDK Critical Dependency Warning

When running `npm run build`, you may see warnings like:

```
Critical dependency: require function is used in a way in which dependencies cannot be statically extracted
Import trace for requested module:
...sodium-native/index.js
...@stellar/stellar-base/lib/signing.js
...@stellar/stellar-sdk/lib/index.js
```

This is due to the `@stellar/stellar-sdk` package pulling in Node.js dependencies (like `sodium-native`) even when used in client-side code. The app uses dynamic imports and only loads what is needed, but the warning may still appear. This does not affect runtime behavior in the browser, but keep this in mind if you see these warnings during build.

For more info, see: https://github.com/stellar/js-stellar-sdk/issues/922

# afristore-app

## Monorepo & Lockfile Strategy

This project is part of a monorepo. The **frontend app uses npm as the package manager** and maintains a single lockfile at `frontend/afristore-app/package-lock.json`. Do not use yarn or pnpm for this workspace. Always run install/build/lint commands from the `frontend/afristore-app` directory.

**Workspace root for Next.js output tracing is set to the monorepo root.**

### Install & Build Directory

All frontend commands (install, build, lint, test) should be run from:

```
cd frontend/afristore-app
```

This ensures consistent dependency resolution and avoids workspace root ambiguity.

---

Next.js 14 frontend for the Afristore decentralized African art marketplace.

## Tech Stack

| Layer      | Library                   |
| ---------- | ------------------------- |
| Framework  | Next.js 15 (App Router)   |
| Styling    | Tailwind CSS              |
| Blockchain | `@stellar/stellar-sdk`    |
| Wallet     | `@stellar/freighter-api`  |
| IPFS       | Pinata REST API (`axios`) |
| Icons      | `lucide-react`            |

## Design Guidelines

For open-source contributors or UI designers, please adhere to the following design system when implementing new features or components:

**Color Palette:**

- Primary Brand Color: `#E27D60` (Vibrant Terracotta)
- Secondary Brand Color: `#85DCBA` (Soft Mint Green)
- Background Color (Light): `#F8F9FA` (Off-white)
- Background Color (Dark): `#1E1E24` (Deep Charcoal)
- Text Primary (Light Mode): `#212529` (Nearly Black)
- Text Secondary (Light Mode): `#6C757D` (Muted Gray)
- Accent Error: `#E63946` (Vivid Red)
- Accent Success: `#2A9D8F` (Teal)

**Typography (Google Fonts):**

- Headings (H1-H6): `Playfair Display` (Bold, semi-bold - reflects an artistic, gallery-like feel)
- Body Text: `Inter` (Regular, Medium - ensures readability for long descriptions and numbers)
- Monospace (Wallet Addresses, code): `Fira Code` or `JetBrains Mono`

**Visual Guide**
[link to docs here](https://docs.google.com/document/d/1ABou8688S3lLqG9ZXAW9i5z8h9p2QVZdtIeEpRB4Y-M/edit?usp=sharing)

_Note: The frontend avoids Figma for the time being. Follow these styles by utilizing Tailwind utility classes properly mapped in `tailwind.config.ts`._

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout — WalletProvider + Navbar
│   ├── page.tsx                # Marketplace browse page
│   ├── dashboard/page.tsx      # Artist dashboard (list + manage)
│   └── listing/[id]/page.tsx   # Individual listing detail + buy
│
├── components/
│   ├── Navbar.tsx              # Sticky nav with wallet connect button
│   ├── ListingCard.tsx         # Artwork card with buy flow
│   └── UploadArtworkForm.tsx   # Drag-drop upload + IPFS + on-chain listing
│
├── context/
│   └── WalletContext.tsx       # Global Freighter wallet state
│
├── hooks/
│   ├── useWallet.ts            # Freighter connect / disconnect / auto-reconnect
│   └── useMarketplace.ts       # useMarketplace, useArtistListings,
│                               # useCreateListing, useBuyArtwork, useCancelListing
│
└── lib/
    ├── config.ts               # Centralised env var access
    ├── contract.ts             # Soroban contract client (all 6 functions)
    ├── freighter.ts            # Freighter sign + connect helpers
    └── ipfs.ts                 # Pinata upload (image + JSON) + fetch helpers
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

| Variable                                 | Description                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTRACT_ID`                | Deployed Soroban contract address                                           |
| `NEXT_PUBLIC_STELLAR_NETWORK`            | `testnet` or `mainnet`                                                      |
| `NEXT_PUBLIC_STELLAR_RPC_URL`            | Soroban RPC endpoint                                                        |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL`        | Horizon REST API                                                            |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase                                                  |
| `PINATA_JWT`                             | Pinata API JWT (server-side only; never expose publicly)                    |
| `NEXT_PUBLIC_PINATA_GATEWAY`             | Pinata IPFS gateway URL                                                     |
| `NEXT_PUBLIC_INDEXER_URL`                | Base URL of the Afristore indexer API (e.g. `http://localhost:4000` in dev) |

## Install & Run

Use **Node.js 20.x** (same as CI) for reliable parity with the ESLint 8 + `eslint-config-next` toolchain. Node **18+** is the minimum supported for this app.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

| Script               | Description                           |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Start dev server with hot-reload      |
| `npm run build`      | Production build                      |
| `npm run start`      | Start production server               |
| `npm run lint`       | ESLint (CLI; `next lint` is not used) |
| `npm run type-check` | TypeScript check (no emit)            |

## Wallet Setup

1. Install [Freighter](https://www.freighter.app) browser extension
2. Create or import a Stellar wallet
3. Switch to **Testnet** in Freighter settings
4. Fund your test account: [https://friendbot.stellar.org](https://friendbot.stellar.org)

## IPFS Setup

1. Sign up at [app.pinata.cloud](https://app.pinata.cloud)
2. Go to **API Keys → New Key**, select **Admin** scope
3. Copy the JWT into `.env.local` as `PINATA_JWT`

The app uploads to Pinata through internal API routes (`/api/ipfs/upload-image`, `/api/ipfs/upload-metadata`) so the JWT stays server-side.

## Artist Flow (V2)

1. Connect Freighter wallet
2. Navigate to **My Dashboard → Create Collection**
3. Deploy a new Collection contract (Freighter popup)
4. Mint an NFT into the collection — upload artwork image + metadata to IPFS via Pinata
5. List the minted NFT on the Marketplace contract (Freighter popup)

## Buyer Flow

1. Browse the marketplace at `/`
2. Click an artwork card or **Buy Now**
3. Freighter prompts for transaction signing
4. Contract transfers XLM from buyer → artist and records ownership

## IPFS Metadata Schema

```json
{
  "title": "Sunlit Savanna",
  "description": "Oil on canvas, inspired by the Serengeti at dawn.",
  "artist": "Amara Diallo",
  "image": "ipfs://QmImageCIDHere",
  "year": "2025"
}
```

## Deployment

```bash
npm run build
npm run start
```

Or deploy to [Vercel](https://vercel.com) — connect the repo and set required
environment variables in project settings (`NEXT_PUBLIC_*` for public config,
`PINATA_JWT` as a private server variable).
