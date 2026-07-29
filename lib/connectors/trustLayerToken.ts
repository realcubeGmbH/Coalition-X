import { SignJWT, importJWK, type JWK } from "jose";
import { Logger } from "../core/Logger";

/**
 * Connector 3 bearer tokens.
 *
 * The Trust Layer only ever verifies these, so nothing is registered there and
 * nothing needs re-issuing after a restart on either side. We mint them here,
 * short-lived, from a private JWK held in Secrets Manager — so no long-lived
 * credential exists anywhere, and there is no annual expiry to remember.
 *
 * `TRUST_LAYER_TOKEN` remains supported as a static fallback for local
 * development, but is not used when a signing key is configured.
 */

const TOKEN_TTL_SECONDS = 600;
/** Re-mint this far before expiry so an in-flight request never uses a dead token. */
const REFRESH_MARGIN_SECONDS = 60;
const DEFAULT_SCOPE = "data:read data:write";

const logger = new Logger({ connector: "TrustLayerToken" });

let cached: { token: string; expiresAt: number } | undefined;
let signingKeyPromise: Promise<{ key: CryptoKey | Uint8Array; jwk: JWK }> | undefined;

function parseJwk(raw: string): JWK {
  // Raw JSON or base64-encoded JSON — the latter survives env plumbing without
  // escaping headaches.
  const text = raw.trimStart().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text) as JWK;
}

function loadSigningKey() {
  signingKeyPromise ??= (async () => {
    const raw = process.env.CONNECTOR_TOKEN_PRIVATE_JWK!;
    const jwk = parseJwk(raw);
    const alg = jwk.alg ?? "ES256";
    return { key: await importJWK(jwk, alg), jwk };
  })();
  return signingKeyPromise;
}

/**
 * A currently-valid bearer token, minted on demand and cached in memory.
 * Returns undefined when neither a signing key nor a static token is configured
 * (signing is then skipped entirely by the caller).
 */
export async function getTrustLayerToken(): Promise<string | undefined> {
  if (!process.env.CONNECTOR_TOKEN_PRIVATE_JWK) {
    return process.env.TRUST_LAYER_TOKEN || undefined;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - REFRESH_MARGIN_SECONDS > now) {
    return cached.token;
  }

  try {
    const { key, jwk } = await loadSigningKey();
    const alg = jwk.alg ?? "ES256";
    const expiresAt = now + TOKEN_TTL_SECONDS;

    const token = await new SignJWT({ scope: DEFAULT_SCOPE })
      .setProtectedHeader({ alg, ...(jwk.kid ? { kid: jwk.kid } : {}) })
      .setSubject(
        process.env.TRUST_LAYER_SYSTEM_DID ??
          "did:web:coalitionx.org:systems:exchange-layer",
      )
      .setIssuer(process.env.CONNECTOR_TOKEN_ISSUER ?? "coalition-x-exchange-layer")
      .setAudience(
        process.env.CONNECTOR_TOKEN_AUDIENCE ?? "coalition-x-trust-layer",
      )
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(key);

    cached = { token, expiresAt };
    return token;
  } catch (err) {
    logger.error("Could not mint a Trust Layer token", {
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    // Fall back to a static token if one is configured; otherwise the caller
    // gets no Authorization header and the Trust Layer answers 401 — a clear
    // failure rather than a silent unsigned submission.
    return process.env.TRUST_LAYER_TOKEN || undefined;
  }
}

/** Drops the cached token. Exposed for tests. */
export function resetTrustLayerToken(): void {
  cached = undefined;
  signingKeyPromise = undefined;
}
