import type { Expense, ExpenseMember, PlaceWeather } from "@offgrid/core";
import Dexie, { type Table } from "dexie";

export interface StoredWeather {
  placeId: string;
  data: PlaceWeather;
  savedAt: number;
}

export interface StoredPack {
  regionId: string;
  version: string;
  raw: unknown;
  savedAt: number;
}

export interface OutboxPhoto {
  id: string;
  blob: Blob;
}

/** A write made while offline (or that failed), replayed in order when the network is back. */
export interface OutboxOp {
  id: string;
  kind: "submission" | "vote" | "withdraw" | "hazard" | "sos" | "relay";
  /** Shown to the user, e.g. "Add “Hidden Waterfall Pool”". */
  label: string;
  method: "PUT" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  photos?: OutboxPhoto[];
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** The server rejected it (a 4xx); retrying won't help, so the user decides. */
  failed: boolean;
}

/**
 * A trip's shared expenses. Kept only on this device: splitting a bill shouldn't need signal or an
 * account for every friend, and the amounts never leave the phone unless the user shares the summary.
 */
export interface StoredLedger {
  tripId: string;
  members: ExpenseMember[];
  expenses: Expense[];
  updatedAt: number;
}

/** IndexedDB, because the region pack (~300 KB) and photo blobs outgrow localStorage's limits and sync API. */
class OffgridDB extends Dexie {
  packs!: Table<StoredPack, string>;
  outbox!: Table<OutboxOp, string>;
  weather!: Table<StoredWeather, string>;
  ledgers!: Table<StoredLedger, string>;

  constructor() {
    super("offgrid");
    this.version(1).stores({ packs: "regionId", outbox: "id, createdAt" });
    // v2: forecasts, saved so the last one is still there on the trail.
    this.version(2).stores({ packs: "regionId", outbox: "id, createdAt", weather: "placeId" });
    // v3: the group expense splitter.
    this.version(3).stores({ packs: "regionId", outbox: "id, createdAt", weather: "placeId", ledgers: "tripId" });
  }
}

export const db = new OffgridDB();
