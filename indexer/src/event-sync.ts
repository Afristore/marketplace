import { rpc } from '@stellar/stellar-sdk';
import { parseMarketplaceEvent, parseLendingEvent, type DecodedEvent } from './parser.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'event-sync' });

export const MAX_LEDGER_WINDOW = 17_000;
export const EVENT_PAGE_LIMIT = 100;

type RpcEvent = {
  topic: unknown[];
  value: unknown;
  ledger: number;
};

function toBase64(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    'toXDR' in value &&
    typeof (value as { toXDR: (format: string) => string }).toXDR === 'function'
  ) {
    return (value as { toXDR: (format: string) => string }).toXDR('base64');
  }
  return String(value);
}

function decodeRpcEvent(event: RpcEvent): DecodedEvent | null {
  const topicStrings = event.topic.map((topic) => toBase64(topic));
  const marketplaceEvent = parseMarketplaceEvent(topicStrings, toBase64(event.value), event.ledger);
  if (marketplaceEvent) return marketplaceEvent;
  return parseLendingEvent(topicStrings, toBase64(event.value), event.ledger);
}

export async function collectMarketplaceEvents(
  server: rpc.Server,
  contractIds: string[],
  startLedger: number,
  endLedger: number,
  onDecodeError?: (rawEvent: unknown, err: unknown) => Promise<void> | void
): Promise<DecodedEvent[]> {
  if (contractIds.length === 0 || startLedger > endLedger) {
    return [];
  }

  const decodedEvents: DecodedEvent[] = [];

  for (let windowStart = startLedger; windowStart <= endLedger; windowStart += MAX_LEDGER_WINDOW) {
    const windowEnd = Math.min(windowStart + MAX_LEDGER_WINDOW - 1, endLedger);
    let paginationToken: string | null = null;

    do {
      const response: any = await server.getEvents({
        startLedger: windowStart,
        endLedger: windowEnd,
        filters: [
          {
            type: 'contract',
            contractIds,
          },
        ],
        limit: EVENT_PAGE_LIMIT,
        ...(paginationToken ? { cursor: paginationToken } : {}),
      } as any);

      for (const event of response.events ?? []) {
        try {
          const decoded = decodeRpcEvent(event);
          if (decoded) decodedEvents.push(decoded);
        } catch (err) {
          log.error('Failed to decode RPC event; skipping and routing to dead-letter handler', {
            ledger: (event as any)?.ledger,
            error: err instanceof Error ? err.message : String(err),
          });
          if (onDecodeError) {
            try {
              await onDecodeError(event, err);
            } catch (dlErr) {
              log.error('Dead-letter handler failed for malformed RPC event', {
                ledger: (event as any)?.ledger,
                error: dlErr instanceof Error ? dlErr.message : String(dlErr),
              });
            }
          }
        }
      }

      paginationToken = response.paginationToken ?? null;
    } while (paginationToken);
  }

  return decodedEvents;
}
const COLLATERAL_EVENT_TYPES = ['COLLATERAL_ADDED', 'LENDING_COLLATERAL_ADDED'];

/** The part of the Prisma transaction client that the lending rollback uses. */
export interface LendingRollbackClient {
  marketplaceEvent: {
    findMany(args: any): Promise<Array<{ listingId: bigint | null; data: unknown }>>;
  };
  lendingListing: {
    deleteMany(args: any): Promise<unknown>;
    findMany(args: any): Promise<Array<{ listingId: bigint }>>;
    update(args: any): Promise<unknown>;
  };
  lendingPosition: {
    deleteMany(args: any): Promise<unknown>;
    findMany(args: any): Promise<Array<{ positionId: bigint; collateralAmount: unknown }>>;
    count(args: any): Promise<number>;
    update(args: any): Promise<unknown>;
  };
}

/**
 * Collateral added past `safeAtLedger`, per position, read from the events that
 * are about to be rolled back. Must run before those events are deleted.
 */
export async function collateralAddedAfter(
  tx: LendingRollbackClient,
  safeAtLedger: number,
): Promise<Map<bigint, bigint>> {
  const events = await tx.marketplaceEvent.findMany({
    where: { eventType: { in: COLLATERAL_EVENT_TYPES }, ledgerSequence: { gt: safeAtLedger } },
    select: { listingId: true, data: true },
  });
  const added = new Map<bigint, bigint>();
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const rawId = data.position_id ?? event.listingId;
    if (rawId === undefined || rawId === null) continue;
    try {
      const positionId = BigInt(rawId as string | number | bigint);
      const amount = BigInt((data.amount ?? 0) as string | number | bigint);
      added.set(positionId, (added.get(positionId) ?? 0n) + amount);
    } catch {
      // A malformed payload cannot be reverted; the position still gets its status reset.
    }
  }
  return added;
}

/**
 * Rolls the lending tables back to `safeAtLedger` during a ledger reorganization:
 * - listings and positions first seen past the safe ledger are deleted;
 * - positions changed past it go back to Active, with settlement fields cleared
 *   and collateral added past it subtracted again;
 * - listings changed past it go back to Filled if a position for them survives,
 *   otherwise to Open.
 * Replaying events from `safeAtLedger + 1` then rebuilds the canonical state.
 */
export async function revertLendingState(
  tx: LendingRollbackClient,
  safeAtLedger: number,
  collateralAdded: Map<bigint, bigint> = new Map(),
): Promise<void> {
  await tx.lendingPosition.deleteMany({ where: { createdAtLedger: { gt: safeAtLedger } } });
  await tx.lendingListing.deleteMany({ where: { createdAtLedger: { gt: safeAtLedger } } });

  const dirtyPositions = await tx.lendingPosition.findMany({
    where: { updatedAtLedger: { gt: safeAtLedger } },
    select: { positionId: true, collateralAmount: true },
  });
  for (const position of dirtyPositions) {
    const added = collateralAdded.get(position.positionId) ?? 0n;
    let collateralAmount: string | undefined;
    if (added > 0n) {
      // Decimal columns hold whole smallest-unit amounts; drop any ".0000000".
      const current = BigInt(String(position.collateralAmount).split('.')[0] || '0');
      const reverted = current - added;
      collateralAmount = (reverted > 0n ? reverted : 0n).toString();
    }
    await tx.lendingPosition.update({
      where: { positionId: position.positionId },
      data: {
        status: 'Active',
        liquidator: null,
        liquidatorBounty: null,
        lenderPayout: null,
        platformFee: null,
        borrowerRefund: null,
        // Stale after any rollback; the crank recomputes it on its next pass.
        healthFactor: null,
        ...(collateralAmount !== undefined ? { collateralAmount } : {}),
        updatedAtLedger: safeAtLedger,
      },
    });
  }

  const dirtyListings = await tx.lendingListing.findMany({
    where: { updatedAtLedger: { gt: safeAtLedger } },
    select: { listingId: true },
  });
  for (const { listingId } of dirtyListings) {
    const openPositions = await tx.lendingPosition.count({ where: { listingId } });
    await tx.lendingListing.update({
      where: { listingId },
      data: { status: openPositions > 0 ? 'Filled' : 'Open', updatedAtLedger: safeAtLedger },
    });
  }
}
