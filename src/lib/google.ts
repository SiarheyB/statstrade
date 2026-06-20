import { createRemoteJWKSet, jwtVerify } from "jose";

// Verifies Google Identity Services id_tokens against Google's public keys.
// Shared by the Google login route and the "link Google" settings route.

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export type GoogleIdentity = { email: string; googleId: string; name: string | null };

export class GoogleAuthError extends Error {}

// Throws GoogleAuthError("not-configured") when GOOGLE_CLIENT_ID is unset, or a
// generic GoogleAuthError when the token is invalid / email not verified.
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new GoogleAuthError("not-configured");

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    }));
  } catch {
    throw new GoogleAuthError("invalid-token");
  }

  if (!payload.email || payload.email_verified === false) {
    throw new GoogleAuthError("email-not-verified");
  }
  return {
    email: String(payload.email).toLowerCase(),
    googleId: String(payload.sub),
    name: payload.name ? String(payload.name) : null,
  };
}
