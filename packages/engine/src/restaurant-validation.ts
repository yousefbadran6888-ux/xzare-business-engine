import { z } from 'zod'
import { id, text, amount, note } from './validation.js'
const command = { clientTxnId: id }
const order = { orderId: id, version: z.number().int().nonnegative(), ...command }
export const restaurantSchemas = {
  'restaurant.state': z.object({}).strict(),
  'restaurant.table.save': z
    .object({
      id: id.optional(),
      name: text,
      zone: z.string().trim().max(80).default(''),
      seats: z.number().int().min(1).max(100),
      active: z.boolean().default(true),
    })
    .strict(),
  'restaurant.driver.save': z
    .object({
      id: id.optional(),
      name: text,
      phone: z.string().trim().max(40),
      active: z.boolean().default(true),
    })
    .strict(),
  'restaurant.config.save': z.object({ deliveryFee: amount }).strict(),
  'restaurant.menu.save': z
    .object({
      id: id.optional(),
      name: text,
      category: z.string().trim().max(80).default(''),
      price: amount,
      station: z.enum(['kitchen', 'bar']).default('kitchen'),
      kind: z.enum(['prepared', 'stocked', 'service']).default('prepared'),
      components: z
        .array(
          z.object({ variantId: id, qty: z.number().int().positive().max(1000000000) }).strict(),
        )
        .max(40)
        .default([]),
      active: z.boolean().default(true),
    })
    .strict(),
  'restaurant.order.create': z
    .object({
      ...command,
      kind: z.enum(['dinein', 'takeaway', 'delivery']),
      tableId: id.optional(),
      customerName: z.string().trim().max(160).default(''),
      phone: z.string().trim().max(40).default(''),
      address: z.string().trim().max(250).default(''),
      note,
    })
    .strict(),
  'restaurant.order.add': z
    .object({
      ...order,
      menuId: id,
      qty: z.number().int().min(1000).max(1000000).multipleOf(1000),
      note,
    })
    .strict(),
  'restaurant.order.send': z.object(order).strict(),
  'restaurant.order.move': z.object({ ...order, tableId: id }).strict(),
  'restaurant.line.advance': z
    .object({ ...order, lineId: id, status: z.enum(['preparing', 'ready', 'served']) })
    .strict(),
  'restaurant.line.cancel': z.object({ ...order, lineId: id, reason: text }).strict(),
  'restaurant.order.cancel': z.object({ ...order, reason: text }).strict(),
  'restaurant.delivery.dispatch': z.object({ ...order, driverId: id }).strict(),
  'restaurant.checkout': z
    .object({
      ...order,
      cash: amount.default(0),
      card: amount.default(0),
      transfer: amount.default(0),
      discount: amount.default(0),
    })
    .strict(),
  'restaurant.refund': z
    .object({ ...command, orderId: id, reason: text, method: z.enum(['cash', 'card', 'transfer']) })
    .strict(),
  'restaurant.reservation.save': z
    .object({
      ...command,
      tableId: id,
      name: text,
      phone: z.string().trim().max(40).default(''),
      guests: z.number().int().min(1).max(100),
      startsAt: z.number().int().positive(),
      endsAt: z.number().int().positive(),
    })
    .strict(),
  'restaurant.reservation.seat': z.object({ ...command, reservationId: id }).strict(),
  'restaurant.reservation.cancel': z.object({ ...command, reservationId: id }).strict(),
}
export type RestaurantAction = keyof typeof restaurantSchemas
export const restaurantActions = new Set(Object.keys(restaurantSchemas))
