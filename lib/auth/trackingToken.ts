/**
 * Submission Tracking Token (JWS)
 *
 * A signed, tamper-proof handle returned at KPI submission. The submitter (or a
 * machine/browserless caller) presents it to track a submission's status, and it
 * is the entry credential for the public verification portal (step 1).
 *
 * Mirrors lib/auth/jwt.ts: jose + HS256 + JWT_SECRET. Uses a distinct audience
 * ("submission-tracking") so it can never be interchanged with auth access
 * tokens. Symmetric signing is sufficient because only the exchange layer
 * verifies it (the verification portal calls the exchange layer, it does not
 * verify the JWS itself). Production may move this to a dedicated asymmetric key.
 */

import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { authConfig } from "./config";

const TRACKING_AUDIENCE = "submission-tracking";

// ~10 years by default — aligned to EPC/attestation validity so a token stays
// usable for as long as tracking makes sense. Override via env (seconds).
const TRACKING_EXPIRY_SECONDS = Number(
  process.env.TRACKING_TOKEN_EXPIRY_SECONDS ?? 315_360_000,
);

function getSecretKey(): Uint8Array {
  const secret = authConfig.jwt.secret;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret);
}

export interface TrackingTokenClaims {
  submissionId: string;
  organizationId: string;
  // Optional hints — everything is resolvable from submissionId (sub) server-side,
  // so these can be omitted when re-minting from a list row.
  assetId?: string;
  externalId?: string | null;
  dataVersion?: number;
}

const TrackingTokenPayloadSchema = z.object({
  sub: z.string(), // submissionId
  orgId: z.string(),
  assetId: z.string().optional(),
  externalId: z.string().nullish(),
  dataVersion: z.number().optional(),
  // standard claims (added by jose)
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  iss: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type TrackingTokenPayload = z.infer<typeof TrackingTokenPayloadSchema>;

/**
 * Mint a compact JWS tracking token from a submission's reference claims.
 * Deterministic enough to be re-minted on read (e.g. in GET /api/submissions).
 */
export async function mintTrackingToken(
  claims: TrackingTokenClaims,
): Promise<string> {
  return new SignJWT({
    orgId: claims.organizationId,
    ...(claims.assetId && { assetId: claims.assetId }),
    ...(claims.externalId != null && { externalId: claims.externalId }),
    ...(claims.dataVersion != null && { dataVersion: claims.dataVersion }),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.submissionId)
    .setIssuedAt()
    .setIssuer(authConfig.jwt.issuer)
    .setAudience(TRACKING_AUDIENCE)
    .setExpirationTime(`${TRACKING_EXPIRY_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Verify + decode a tracking token. Throws (jose) on invalid signature,
 * wrong audience/issuer, or expiry; throws (zod) on unexpected shape.
 */
export async function verifyTrackingToken(
  jws: string,
): Promise<TrackingTokenPayload> {
  const { payload } = await jwtVerify(jws, getSecretKey(), {
    issuer: authConfig.jwt.issuer,
    audience: TRACKING_AUDIENCE,
  });
  return TrackingTokenPayloadSchema.parse(payload);
}
