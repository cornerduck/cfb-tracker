// Verifies the GitHub Actions identity token that the manual Supabase
// workflow sends, so only that workflow on main can trigger imports.

import { asObject, type JsonObject } from "./cfbd.ts";

const GITHUB_REPOSITORY = "cornerduck/cfb-tracker";
const GITHUB_WORKFLOW_REF = "cornerduck/cfb-tracker/.github/workflows/supabase.yml@refs/heads/main";
const GITHUB_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

type GithubSigningKey = JsonWebKey & { kid: string };
let githubKeys: Promise<GithubSigningKey[]> | undefined;

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const decodeJwtPart = (value: string): JsonObject =>
  asObject(JSON.parse(new TextDecoder().decode(decodeBase64Url(value))), "GitHub token");

const getGithubKeys = async (refresh = false) => {
  if (refresh || !githubKeys) {
    githubKeys = fetch(GITHUB_JWKS_URL).then(async (result) => {
      if (!result.ok) throw new Error(`GitHub JWKS request failed with HTTP ${result.status}`);
      const payload = asObject(await result.json(), "GitHub JWKS");
      if (!Array.isArray(payload.keys)) throw new Error("GitHub JWKS did not contain signing keys");
      return payload.keys.map((key) => {
        const signingKey = asObject(key, "GitHub signing key");
        if (
          typeof signingKey.kid !== "string" || signingKey.kty !== "RSA" ||
          typeof signingKey.n !== "string" || typeof signingKey.e !== "string"
        ) {
          throw new Error("GitHub signing key is missing required RSA fields");
        }
        return { kid: signingKey.kid, kty: "RSA", n: signingKey.n, e: signingKey.e };
      });
    });
  }
  try {
    return await githubKeys;
  } catch (error) {
    githubKeys = undefined;
    throw error;
  }
};

export const validateWorkflowToken = async (token: string, audienceName: string) => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed GitHub Actions identity token");
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported GitHub token signing algorithm");
  }
  let signingKey = (await getGithubKeys()).find((key) => key.kid === header.kid);
  if (!signingKey) signingKey = (await getGithubKeys(true)).find((key) => key.kid === header.kid);
  if (!signingKey) throw new Error("GitHub token signing key was not found");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    signingKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!isValid) throw new Error("Invalid GitHub token signature");
  const audience = payload.aud;
  const hasAudience = Array.isArray(audience) ? audience.includes(audienceName) : audience === audienceName;
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== "https://token.actions.githubusercontent.com" || !hasAudience ||
    typeof payload.exp !== "number" || payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now)
  ) {
    throw new Error("GitHub token issuer, audience, or validity period is invalid");
  }
  if (
    payload.repository !== GITHUB_REPOSITORY || payload.event_name !== "workflow_dispatch" ||
    payload.ref !== "refs/heads/main" || payload.workflow_ref !== GITHUB_WORKFLOW_REF
  ) {
    throw new Error("The GitHub token is not from the authorized manual workflow on main");
  }
};
