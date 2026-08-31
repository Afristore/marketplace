import dotenv from 'dotenv';
import prisma from './db.js';
import { resolveMetadataCategory } from './ipfs.js';

dotenv.config();

/**
 * Backfill the `category` column on listings created before category
 * denormalization existed. Resolves each distinct metadata CID once (cached
 * in-memory) and updates every listing that shares it. Best-effort — listings
 * whose metadata cannot be resolved keep `category = null`.
 */
export async function runCategoryBackfill() {
    const BATCH_SIZE = 200;

    const rows = await prisma.listing.findMany({
        where: { category: null },
        select: { listingId: true, metadataCid: true },
        orderBy: { listingId: 'asc' },
    });

    console.log({ msg: 'Category backfill: found candidates', count: rows.length });

    const categoryByCid = new Map<string, string>();
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        for (const row of batch) {
            const cid = row.metadataCid;
            if (!cid) continue;

            let category = categoryByCid.get(cid);
            if (category === undefined) {
                category = (await resolveMetadataCategory(cid)) ?? '';
                categoryByCid.set(cid, category);
            }

            if (!category) {
                failed++;
                continue;
            }

            await prisma.listing.update({
                where: { listingId: row.listingId },
                data: { category },
            });
            updated++;
        }
        console.log({
            msg: 'Category backfill: batch progress',
            processed: Math.min(i + BATCH_SIZE, rows.length),
            updated,
            failed,
        });
    }

    console.log({
        msg: 'Category backfill complete',
        candidates: rows.length,
        updated,
        unresolved: failed,
        distinctCids: categoryByCid.size,
    });
}

if (process.argv[1] && process.argv[1].includes('backfill-categories')) {
    runCategoryBackfill().catch((err) => {
        console.error({
            msg: 'Category backfill failed',
            err: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
    });
}