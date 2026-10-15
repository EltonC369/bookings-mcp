import type { Availability, Booking, Customer } from "./types.js";

/**
 * In-memory store backed by plain Maps. Intentionally simple: the point of
 * this server is the MCP tool surface and its read/write policy, not the
 * persistence layer. Replace with Postgres/SQLite for production use —
 * the interface is small on purpose.
 *
 * All seed data is fictional.
 */
export class BookingStore {
  private customers = new Map<number, Customer>();
  private bookings = new Map<number, Booking>();
  private nextCustomerId = 1;
  private nextBookingId = 1;

  constructor(seed = true) {
    if (seed) this.seed();
  }

  private seed(): void {
    const seedCustomers: Array<Omit<Customer, "id" | "createdAt">> = [
      { name: "Ada Miranda", phone: "+595-971-000-001" },
      { name: "Bruno Salas", phone: "+595-971-000-002" },
      { name: "Carla Vera", phone: "+595-971-000-003" },
    ];
    for (const c of seedCustomers) {
      const id = this.nextCustomerId++;
      this.customers.set(id, { ...c, id, createdAt: new Date().toISOString() });
    }

    const d = new Date();
    const iso = (offsetDays: number): string => {
      const dt = new Date(d);
      dt.setDate(dt.getDate() + offsetDays);
      return dt.toISOString().slice(0, 10);
    };

    const seedBookings: Array<Omit<Booking, "id" | "createdAt" | "status">> = [
      { customerId: 1, date: iso(1), time: "09:00", service: "consultation" },
      { customerId: 2, date: iso(1), time: "10:30", service: "follow-up" },
      { customerId: 3, date: iso(2), time: "14:00", service: "consultation" },
    ];
    for (const b of seedBookings) {
      const id = this.nextBookingId++;
      this.bookings.set(id, { ...b, id, status: "confirmed", createdAt: new Date().toISOString() });
    }
  }

  listCustomers(): Customer[] {
    return [...this.customers.values()];
  }

  getCustomer(id: number): Customer | undefined {
    return this.customers.get(id);
  }

  listBookings(): Booking[] {
    return [...this.bookings.values()];
  }

  getBooking(id: number): Booking | undefined {
    return this.bookings.get(id);
  }

  isSlotTaken(date: string, time: string): boolean {
    for (const b of this.bookings.values()) {
      if (b.date === date && b.time === time && b.status === "confirmed") return true;
    }
    return false;
  }

  checkAvailability(date: string, times: string[]): Availability[] {
    return times.map((time) => ({ date, time, available: !this.isSlotTaken(date, time) }));
  }

  /** Business-day validation: slots are 09:00–16:30 in 30-minute steps. */
  static isValidSlot(time: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(time)) return false;
    const parts = time.split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return false;
    if (m !== 0 && m !== 30) return false;
    return h >= 9 && (h < 16 || (h === 16 && m === 30));
  }

  static isValidDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    return !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime());
  }

  createBooking(input: { customerId: number; date: string; time: string; service: string }): Booking | { error: string } {
    if (!this.customers.has(input.customerId)) return { error: `Customer ${input.customerId} does not exist` };
    if (!BookingStore.isValidDate(input.date)) return { error: `Invalid date: ${input.date} (expected YYYY-MM-DD)` };
    if (!BookingStore.isValidSlot(input.time)) return { error: `Invalid time: ${input.time} (30-min slots between 09:00 and 16:30)` };
    if (this.isSlotTaken(input.date, input.time)) return { error: `Slot ${input.date} ${input.time} is already taken` };

    const id = this.nextBookingId++;
    const booking: Booking = {
      id,
      customerId: input.customerId,
      date: input.date,
      time: input.time,
      service: input.service,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    this.bookings.set(id, booking);
    return booking;
  }

  cancelBooking(id: number): Booking | { error: string } {
    const booking = this.bookings.get(id);
    if (!booking) return { error: `Booking ${id} does not exist` };
    if (booking.status === "cancelled") return { error: `Booking ${id} is already cancelled` };
    booking.status = "cancelled";
    return booking;
  }
}
