import type { AxiomIngestClient } from "./AxiomTransport.js";
import { isReportEvent } from "./reportTags.js";

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
/** Most events in one request, so a backlog built up while offline never arrives as a body the server refuses for size. */
const MAX_EVENTS_PER_REQUEST = 500;
/** A request that has not answered by now is abandoned and retried; without it one stalled connection holds every later flush behind it. */
const REQUEST_TIMEOUT_MS = 20_000;

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
    this.trim();
  }

  /** Keeps the newest `maxPending` events, and never evicts a report while an ordinary event is waiting. */
  private trim(): void {
    let excess = this.pending.length - this.maxPending;
    if (excess <= 0) return;
    this.pending = this.pending.filter((p) => {
      if (excess > 0 && !isReportEvent(p.event)) {
        excess--;
        return false;
      }
      return true;
    });
    if (this.pending.length > this.maxPending) {
      this.pending = this.pending.slice(-this.maxPending);
    }
  }

  async flush(options?: { keepalive?: boolean }): Promise<void> {
    const sending = this.pending;
    if (sending.length === 0) return;
    this.pending = [];
    const settled = new Set<(typeof sending)[number]>();
    try {
      for (const dataset of new Set(sending.map((p) => p.dataset))) {
        const all = sending.filter((p) => p.dataset === dataset);
        /* Reports go first and in requests of their own, so a chunk the server refuses or part-rejects cannot take one down with it. */
        const reports = all.filter((p) => isReportEvent(p.event));
        const rest = all.filter((p) => !isReportEvent(p.event));
        const chunks: (typeof sending)[] = [];
        for (const group of [reports, rest]) {
          for (let i = 0; i < group.length; i += MAX_EVENTS_PER_REQUEST) {
            chunks.push(group.slice(i, i + MAX_EVENTS_PER_REQUEST));
          }
        }
        for (const chunk of chunks) {
          try {
            await this.post(
              dataset,
              JSON.stringify(chunk.map((p) => p.event)),
              options?.keepalive === true,
            );
          } catch (error) {
            if (
              error instanceof RefusedBatchError ||
              error instanceof RejectedEventsError
            ) {
              for (const p of chunk) settled.add(p);
            }
            throw error;
          }
          for (const p of chunk) settled.add(p);
        }
      }
    } catch (error) {
      /* Events in requests that succeeded, or that the server refused outright, are not resent; the rest go again with whatever arrived meanwhile. */
      this.pending = [
        ...sending.filter((p) => !settled.has(p)),
        ...this.pending,
      ];
      this.trim();
      throw error;
    }
  }

  private async post(
    dataset: string,
    body: string,
    keepalive: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(
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
          signal: controller.signal,
          keepalive: keepalive && body.length < KEEPALIVE_LIMIT_BYTES,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) {
      await rejectedEvents(response);
      return;
    }
    const retryable =
      response.status >= 500 ||
      response.status === 429 ||
      response.status === 408;
    if (retryable) throw new Error(`Axiom ingest ${response.status}`);
    throw new RefusedBatchError(`Axiom ingest ${response.status}`);
  }
}

/**
 * Axiom answers 200 even when it turned some events away (a field over the
 * dataset's limit, an oversized event): the body carries `failed` and
 * `failures`. Resending the same events cannot change that, so they are not
 * kept, but the flush must still report it.
 */
async function rejectedEvents(response: Response): Promise<void> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return;
  }
  if (typeof body !== "object" || body === null) return;
  const failed = "failed" in body ? body.failed : undefined;
  if (typeof failed !== "number" || failed <= 0) return;
  const failures = "failures" in body ? body.failures : undefined;
  const firstFailure = Array.isArray(failures) ? failures[0] : undefined;
  const first =
    typeof firstFailure === "object" &&
    firstFailure !== null &&
    "error" in firstFailure
      ? firstFailure.error
      : undefined;
  throw new RejectedEventsError(
    `Axiom ingest rejected ${failed} events${typeof first === "string" ? `: ${first}` : ""}`,
  );
}

class RefusedBatchError extends Error {}

class RejectedEventsError extends Error {}
