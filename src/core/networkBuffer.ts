import type { NetworkRequestEntry } from "../types/api.js";

export interface NetworkQueryOptions {
  sinceCursor?: number;
  limit?: number;
  predicate?: (entry: NetworkRequestEntry) => boolean;
}

export class NetworkBuffer {
  private readonly maxEntries: number;
  private readonly entries: NetworkRequestEntry[] = [];
  private nextCursor = 1;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  append(entry: Omit<NetworkRequestEntry, "cursor">): NetworkRequestEntry {
    const next: NetworkRequestEntry = {
      ...entry,
      cursor: this.nextCursor,
    };

    this.nextCursor += 1;
    this.entries.push(next);

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    return next;
  }

  query(options: NetworkQueryOptions = {}): { items: NetworkRequestEntry[]; nextCursor: number } {
    const sinceCursor = options.sinceCursor ?? 0;
    const limit = Math.max(1, options.limit ?? 200);

    const newEntries = this.entries.filter((entry) => entry.cursor > sinceCursor);
    const filtered = options.predicate ? newEntries.filter(options.predicate) : newEntries;

    if (filtered.length === 0) {
      const latest = newEntries.length > 0 ? newEntries[newEntries.length - 1].cursor : sinceCursor;
      return {
        items: [],
        nextCursor: latest,
      };
    }

    const items = filtered.slice(0, limit);

    return {
      items,
      nextCursor: items[items.length - 1].cursor,
    };
  }

  clear(): void {
    this.entries.length = 0;
    this.nextCursor = 1;
  }

  size(): number {
    return this.entries.length;
  }
}
