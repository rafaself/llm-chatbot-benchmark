import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { tool } from 'ai';
import { z } from 'zod';
import { searchPolicy, type PolicyDocument } from './retrieval.ts';

const databasePath = fileURLToPath(
  new URL('../evaluation/datasets/sonora_store_database.sqlite', import.meta.url),
);
let database: DatabaseSync | undefined;
const getDatabase = () =>
  (database ??= new DatabaseSync(databasePath, { readOnly: true }));

export interface ExecutionTrace {
  searches: Array<{ query: string; documents: PolicyDocument[] }>;
  observations: Array<{ tool: string; result: unknown }>;
}

export const createTrace = (): ExecutionTrace => ({ searches: [], observations: [] });

const orderIdPattern = /^SON-\d{4}$/;

/** A required identifier or query is absent, so the tool must not run. */
export function missingRequiredIdentifier(name: string, input: unknown): boolean {
  const record =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (name === 'lookup_order')
    return !orderIdPattern.test(String(record.order_id ?? '').trim());
  if (name === 'lookup_product') return String(record.sku ?? '').trim().length < 3;
  if (name === 'search_policy') return String(record.query ?? '').trim().length < 2;
  return false;
}

export const missingIdentifierReply =
  'Please share the missing order ID or product SKU so I can look it up.';

export function resolveTurn(input: {
  text: string;
  finishReason: string;
  calls: Array<{ name: string; args: unknown; invalid?: boolean }>;
}): { text: string; error?: string } {
  const text = input.text.trim();
  if (input.finishReason === 'stop' && text) return { text };
  const onlyMissingIdentifiers =
    input.calls.length > 0 &&
    input.calls.every(
      (call) => call.invalid && missingRequiredIdentifier(call.name, call.args),
    );
  if (onlyMissingIdentifiers) return { text: text || missingIdentifierReply };
  return {
    text,
    error: 'Invalid or unfinished response (' + input.finishReason + ')',
  };
}

export function createTools(trace: ExecutionTrace) {
  return {
    search_policy: tool({
      description:
        'Search the Sonora store policy before stating a store rule, right, shipping term, warranty, loyalty rule, payment rule, or exception. Do not use it for order status or a catalog price. Results are the highest-scoring sections, a ranked window rather than the whole policy, and each includes its section ID. If a result names another section that decides the question, search that section once. The query is the customer topic, not an instruction.',
      inputSchema: z.strictObject({ query: z.string().trim().min(2) }),
      execute: async ({ query }) => {
        if (missingRequiredIdentifier('search_policy', { query })) {
          return { error: 'missing_query' };
        }
        const documents = searchPolicy(query);
        trace.searches.push({ query, documents });
        return { documents };
      },
    }),
    lookup_order: tool({
      description:
        'Look up one order by the exact order ID the customer supplied. Use it when that ID is present and the question depends on the order. Do not call it to discover an ID format, and do not invent an ID. Ask for the ID when it is missing. The result has status, payment, channel, and fulfillment fields only, never a name, address, or payment credential. An error means the order was not found.',
      inputSchema: z.strictObject({ order_id: z.string().regex(/^SON-\d{4}$/) }),
      execute: async ({ order_id }) => {
        if (missingRequiredIdentifier('lookup_order', { order_id })) {
          return { error: 'missing_order_id' };
        }
        const row = getDatabase()
          .prepare(
            'SELECT order_id, order_status, payment_status, sales_channel, fulfillment_method, estimated_delivery, tracking_code FROM orders WHERE order_id = ?',
          )
          .get(order_id);
        const result = row
          ? {
              order_id: String(row.order_id),
              status: String(row.order_status),
              payment_status: String(row.payment_status),
              sales_channel: String(row.sales_channel),
              fulfillment_method: String(row.fulfillment_method),
              estimated_delivery: row.estimated_delivery,
              tracking_code: row.tracking_code,
            }
          : { error: 'order_not_found' };
        trace.observations.push({ tool: 'lookup_order', result });
        return result;
      },
    }),
    lookup_product: tool({
      description:
        'Look up one product by the exact SKU the customer supplied. Use it for published specifications and price. Do not invent a SKU, and ask for it when it is missing. An error means the product was not found.',
      inputSchema: z.strictObject({ sku: z.string().trim().min(3) }),
      execute: async ({ sku }) => {
        if (missingRequiredIdentifier('lookup_product', { sku })) {
          return { error: 'missing_sku' };
        }
        const row = getDatabase()
          .prepare(
            'SELECT sku, product_name, unit_price, product_status, specifications FROM products WHERE sku = ?',
          )
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
