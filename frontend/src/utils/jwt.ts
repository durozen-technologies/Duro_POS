const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  let output = "";

  for (let index = 0; index < padded.length; index += 4) {
    const enc1 = BASE64_CHARS.indexOf(padded[index] ?? "");
    const enc2 = BASE64_CHARS.indexOf(padded[index + 1] ?? "");
    const enc3 = BASE64_CHARS.indexOf(padded[index + 2] ?? "");
    const enc4 = BASE64_CHARS.indexOf(padded[index + 3] ?? "");

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);
    if (padded[index + 2] !== "=") {
      output += String.fromCharCode(chr2);
    }
    if (padded[index + 3] !== "=") {
      output += String.fromCharCode(chr3);
    }
  }

  return output;
}

/** Decode JWT payload without verification — client-side expiry hint only. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const json = decodeBase64Url(parts[1]);
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function getJwtExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

export function isJwtExpired(token: string, skewMs = 30_000): boolean {
  const expiryMs = getJwtExpiryMs(token);
  if (expiryMs === null) {
    return false;
  }
  return Date.now() >= expiryMs - skewMs;
}

// ponytail: run with JWT_SELF_CHECK=1 npx tsx frontend/src/utils/jwt.ts
export function runJwtSelfCheck(): void {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) - 60;
  const payload = Buffer.from(JSON.stringify({ sub: "u1", exp })).toString("base64url");
  const expiredToken = `${header}.${payload}.sig`;
  if (!isJwtExpired(expiredToken)) {
    throw new Error("expired token should be detected");
  }
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const validPayload = Buffer.from(JSON.stringify({ sub: "u1", exp: futureExp })).toString("base64url");
  const validToken = `${header}.${validPayload}.sig`;
  if (isJwtExpired(validToken)) {
    throw new Error("valid token should not be expired");
  }
}

if (process.env.JWT_SELF_CHECK === "1") {
  runJwtSelfCheck();
}
