import { eq, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { aiObservationProducts } from "@/db/schema";

type ProductInsert = typeof aiObservationProducts.$inferInsert;

/** Replaces the product cards saved for one answer. */
async function replaceForObservation(
  observationId: string,
  products: ProductInsert[],
) {
  await runBatch((tx) => [
    tx
      .delete(aiObservationProducts)
      .where(eq(aiObservationProducts.observationId, observationId)),
    // D1 allows 100 bound parameters per statement: 8 columns per product.
    ...chunk(products, 12).map((rows) =>
      tx.insert(aiObservationProducts).values(rows),
    ),
  ]);
}

async function listForObservations(observationIds: string[]) {
  const pages = await Promise.all(
    chunk(observationIds, 90).map((ids) =>
      db
        .select()
        .from(aiObservationProducts)
        .where(inArray(aiObservationProducts.observationId, ids)),
    ),
  );
  return pages.flat();
}

export const AiObservationProductRepository = {
  replaceForObservation,
  listForObservations,
};
