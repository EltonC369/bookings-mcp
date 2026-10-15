/**
 * Domain types for the demo booking operations exposed over MCP.
 * All data is fictional. Swap the store for a real database in production.
 */

export interface Customer {
  id: number;
  name: string;
  phone: string;
  createdAt: string;
}

export type BookingStatus = "confirmed" | "cancelled";

export interface Booking {
  id: number;
  customerId: number;
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** 24h time, HH:MM */
  time: string;
  service: string;
  status: BookingStatus;
  createdAt: string;
}

export interface Availability {
  date: string;
  time: string;
  available: boolean;
}
