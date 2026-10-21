import type { OrderStatus } from "../../domain/order.ts";

export type CustomerOrderListItem = Readonly<{
  id: string;
  categoryId: string;
  locationId: string;
  title: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  status: OrderStatus;
  createdAt: Date;
  publishedAt: Date | null;
}>;

export type CustomerOrderPage = Readonly<{
  items: readonly CustomerOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}>;

export interface CustomerOrderReadRepository {
  listByCustomer(
    customerId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<CustomerOrderPage>;
}
