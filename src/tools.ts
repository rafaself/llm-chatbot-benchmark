import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { tool } from 'ai';
import { z } from 'zod';
import { searchPolicy, type PolicyDocument } from './retrieval.ts';

const databasePath = fileURLToPath(
  new URL('../datasets/sonora_store_database.sqlite', import.meta.url),
);
let database: DatabaseSync | undefined;
const getDatabase = () => (database ??= new DatabaseSync(databasePath, { readOnly: true }));

export interface ExecutionTrace {
  searches: Array<{ query: string; documents: PolicyDocument[] }>;
  observations: Array<{ tool: string; result: unknown }>;
}

export const createTrace = (): ExecutionTrace => ({ searches: [], observations: [] });

export function createTools(trace: ExecutionTrace) {
  return {
    search_policy: tool({
      description: 'Search Sonora store policies for return rights, payments, shipping, discounts, warranties and other store rules. Search before answering store-policy questions. Results include section IDs.',
      inputSchema: z.strictObject({ query: z.string().trim().min(2) }),
      execute: async ({ query }) => {
        const documents = searchPolicy(query);
        trace.searches.push({ query, documents });
        return { documents };
      },
    }),
    lookup_order: tool({
      description: 'Look up the status of an order by its exact Sonora order ID, such as SON-1044. Ask for the ID if absent. Never reveal customer identities or private details.',
      inputSchema: z.strictObject({ order_id: z.string().regex(/^SON-\d{4}$/) }),
      execute: async ({ order_id }) => {
        const row = getDatabase()
          .prepare('SELECT order_id, order_status, estimated_delivery, tracking_code FROM orders WHERE order_id = ?')
          .get(order_id);
        const result = row
          ? {
              order_id: String(row.order_id),
              status: String(row.order_status),
              estimated_delivery: row.estimated_delivery,
              tracking_code: row.tracking_code,
            }
          : { error: 'order_not_found' };
        trace.observations.push({ tool: 'lookup_order', result });
        return result;
      },
    }),
    lookup_product: tool({
      description: 'Look up a product using its exact Sonora SKU, such as SON-AUD-014, to retrieve published specifications and price. Ask for the SKU when needed.',
      inputSchema: z.strictObject({ sku: z.string().trim().min(3) }),
      execute: async ({ sku }) => {
        const row = getDatabase()
          .prepare('SELECT sku, product_name, unit_price, product_status, specifications FROM products WHERE sku = ?')
          .get(sku.toUpperCase());
        const result = row
          ? {
              sku: String(row.sku),
              name: String(row.product_name),
              price: Number(row.unit_price),
              status: String(row.product_status),
              specifications: String(row.specifications),
            }
          : { error: 'product_not_found' };
        trace.observations.push({ tool: 'lookup_product', result });
        return result;
      },
    }),
  };
}
