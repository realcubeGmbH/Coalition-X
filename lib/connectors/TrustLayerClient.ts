import { Logger } from "../core/Logger";
import { getTrustLayerToken } from "./trustLayerToken";

// =============================================================================
// Types — mirror the Trust Layer's seal/verify response shapes
// =============================================================================

export interface KpiSignatureDetail {
  kpi_id: string;
  signature_id: string;
  previous_signature_id: string | null;
  submitter_did: string;
  jws: string;
  combined?: string[];
}

export interface EnvelopeSignatureDetail {
  signature_id: string;
  previous_signature_id: string | null;
  submitter_did: string;
  jws: string;
  kpi_signature_hashes: string[];
}

export interface SigningResponse {
  transaction_id: string;
  org_did: string;
  system_did: string;
  timestamp: string;
  status: "SIGNED";
  kpi_signatures: KpiSignatureDetail[];
  envelope_signature: EnvelopeSignatureDetail;
  dataset_signature?: string;
}

export interface SigningRequest {
  data: Record<string, Record<string, unknown>>;
  identity: {
    submitter_did: string;
    asset_id: string;
  };
  metadata: {
    transaction_id: string;
    schema_version: string;
    merging_info?: Record<string, unknown>;
  };
  kid?: string;
}

export interface VerifyRequest {
  mode: "kpi" | "full";
  jws?: string;
  kpi_element?: unknown;
  seal_response?: SigningResponse;
  kpi_data?: Record<string, Record<string, unknown>>;
}

export interface VerifyResponse {
  status: "VERIFIED" | "FAILED";
  reason?: string;
  payload?: Record<string, unknown>;
  transaction_id?: string;
  org_did?: string;
  kpi_count?: number;
}

// =============================================================================
// Errors
// =============================================================================

export class TrustLayerError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "TrustLayerError";
  }

  get isRetryable(): boolean {
    return this.statusCode >= 500;
  }
}

// =============================================================================
// Client
// =============================================================================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * C3 runs inline in the submission path, so an unresponsive Trust Layer would
 * otherwise hold the user's request open across all three retries. Kept above
 * the ~5s target for POST /seal so a healthy-but-slow seal isn't cut off.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export class TrustLayerClient {
  private baseUrl: string;
  /** Set only to pin a static token; otherwise one is minted per request. */
  private token?: string;
  private timeoutMs: number;
  private logger: Logger;

  constructor(config?: {
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
    logger?: Logger;
  }) {
    this.baseUrl = config?.baseUrl ?? process.env.TRUST_LAYER_URL ?? "";
    this.token = config?.token;
    const envTimeout = parseInt(process.env.TRUST_LAYER_TIMEOUT_MS ?? "", 10);
    this.timeoutMs =
      config?.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : DEFAULT_TIMEOUT_MS);
    this.logger =
      config?.logger ?? new Logger({ connector: "TrustLayerClient" });

    if (!this.baseUrl) {
      throw new Error(
        "TRUST_LAYER_URL is required — set it via env or constructor config",
      );
    }
  }

  async signAndEncrypt(request: SigningRequest): Promise<SigningResponse> {
    const response = await this.postWithRetry<SigningResponse>(
      "/seal",
      request,
    );

    this.logger.info("KPI signing completed", {
      data: {
        transaction_id: response.transaction_id,
        kpi_count: response.kpi_signatures.length,
        org_did: response.org_did,
      },
    });

    return response;
  }

  async verifySignature(request: VerifyRequest): Promise<VerifyResponse> {
    const response = await this.postWithRetry<VerifyResponse>(
      "/verify",
      request,
    );
    return response;
  }

  private async postWithRetry<T>(path: string, body: unknown): Promise<T> {
    let lastError: TrustLayerError | Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.post<T>(path, body);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (err instanceof TrustLayerError && !err.isRetryable) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Trust Layer request failed, retrying (${attempt}/${MAX_RETRIES})`,
            {
              data: {
                path,
                attempt,
                delay_ms: delay,
                error: lastError.message,
              },
            },
          );
          await sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Short-lived and minted on demand — see lib/connectors/trustLayerToken.ts.
    const token = this.token ?? (await getTrustLayerToken());
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // 504 so postWithRetry treats it as transient. A timeout is not proof the
      // Trust Layer didn't sign — a retry can produce a second signature, which
      // the ledger chains rather than corrupting.
      if (
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        throw new TrustLayerError(
          `Trust Layer ${path} timed out after ${this.timeoutMs}ms`,
          504,
        );
      }
      throw err;
    }

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      throw new TrustLayerError(
        `Trust Layer ${path} returned ${res.status}: ${responseBody}`,
        res.status,
        responseBody,
      );
    }

    return (await res.json()) as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
