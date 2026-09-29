import { rpc } from '@stellar/stellar-sdk';
import { parseMarketplaceEvent, parseLendingEvent, type DecodedEvent } from './parser.js';

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
  endLedger: number
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
        const decoded = decodeRpcEvent(event);
        if (decoded) decodedEvents.push(decoded);
      }

      paginationToken = response.paginationToken ?? null;
    } while (paginationToken);
  }

  return decodedEvents;
}