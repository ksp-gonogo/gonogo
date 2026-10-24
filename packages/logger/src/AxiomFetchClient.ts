import type { AxiomIngestClient } from "./AxiomTransport.js";

export interface AxiomFetchClientOptions {
  token: string;
  /** Defaults to Axiom's cloud API. */
  url?: string;
  /** Org id for personal tokens. */
  orgId?: string;
  /** Replaces the global `fetch`, for tests. */
  fetch?: typeof fetch;
  /** Most events held while delivery is failing; the oldest go first. Defaults to 5000. */
  maxPending?: number;
}

const DEFAULT_URL = "https://api.axiom.co";
const DEFAULT_MAX_PENDING = 5000;
/** A keepalive request body may not exceed 64 KiB, so a larger flush goes without it. */
const KEEPALIVE_LIMIT_BYTES = 60_000;

/**
 * Delivers events to Axiom's ingest endpoint and keeps every event until a
 * request carrying it succeeds. A failed flush rejects and leaves the events
 * for the next one; only a refusal that resending cannot fix (a rejected
 * token, a malformed batch) drops them.
 */
export class AxiomFetchClient implements AxiomIngestClient {
  private pending: { dataset: string; event: object }[] = [];
  private readonly baseUrl: string;
  private readonly maxPending: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AxiomFetchClientOptions) {
    this.baseUrl = (options.url ?? DEFAULT_URL).replace(/\/$/, "");
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  ingest(dataset: string, events: object | readonly object[]): void {
    const list = Array.isArray(events) ? events : [events];
    for (const event of list) this.pending.push({ dataset, event });
    if (this.pending.length > this.maxPending) {
      this.pending = this.pending.slice(-this.maxPending);
    }
  }

  async flush(options?: { keepalive?: boolean }): Promise<void> {
    const sending = this.pending;
    if (sending.length === 0) return;
    this.pending = [];
    try {
      for (const dataset of new Set(sending.map((p) => p.dataset))) {
        const body = JSON.stringify(
          sending.filter((p) => p.dataset === dataset).map((p) => p.event),
        );
        await this.post(dataset, body, options?.keepalive === true);
      }
    } catch (error) {
      /* Events sent ahead of the failure go again with the rest: ingest is at-least-once, and a duplicate line costs less than a lost one. */
      this.pending = [...sending, ...this.pending].slice(-this.maxPending);
      if (error instanceof RefusedBatchError) {
        this.pending = this.pending.filter((p) => !sending.includes(p));
      }
      throw error;
    }
  }

  private async post(
    dataset: string,
    body: string,
    keepalive: boolean,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/datasets/${encodeURIComponent(dataset)}/ingest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
          ...(this.options.orgId
            ? { "X-Axiom-Org-ID": this.options.orgId }
            : {}),
        },
        body,
        cache: "no-store",
        keepalive: keepalive && body.length < KEEPALIVE_LIMIT_BYTES,
      },
    );
    if (response.ok) return;
    const retryable =
      response.status >= 500 ||
      response.status === 429 ||
      response.status === 408;
    if (retryable) throw new Error(`Axiom ingest ${response.status}`);
    throw new RefusedBatchError(`Axiom ingest ${response.status}`);
  }
}

class RefusedBatchError extends Error {}
