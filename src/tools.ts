import { tool } from 'ai';
import { z } from 'zod';

// Scenario-specific behavior; validation and execution are handled by AI SDK.
export const tools = {
  get_weather: tool({
    description:
      'Look up current weather for a specified city. Ask for the city if missing.',
    inputSchema: z.strictObject({ city: z.string().min(1) }),
    execute: async ({ city }) =>
      city.trim().toLowerCase() === 'boston'
        ? { city: 'Boston', temperature_c: 18, conditions: 'sunny' }
        : { error: 'city_not_found' },
  }),
  lookup_order: tool({
    description:
      "Look up an order's current delivery status by its order ID. Ask for the ID if missing.",
    inputSchema: z.strictObject({ order_id: z.string() }),
    execute: async ({ order_id }) => {
      const orders: Record<string, string> = { A100: 'delivered', A200: 'in_transit' };
      return Object.hasOwn(orders, order_id)
        ? { order_id, status: orders[order_id] }
        : { error: 'order_not_found' };
    },
  }),
};
