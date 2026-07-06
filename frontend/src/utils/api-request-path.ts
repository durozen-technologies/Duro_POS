export const HEALTHCHECK_PATH = "/api/v1/health";

export function normalizeRequestPath(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const withoutQuery = value.split("?")[0] ?? value;
  const apiIndex = withoutQuery.indexOf("/api/v1/");
  if (apiIndex >= 0) {
    return withoutQuery.slice(apiIndex);
  }
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

export function isLoginRequestPath(path: string): boolean {
  return path === "/api/v1/auth/login" || path.endsWith("/api/v1/auth/login");
}

export function isPublicRequestPath(path: string): boolean {
  return (
    isLoginRequestPath(path) ||
    path === "/api/v1/auth/register" ||
    path.endsWith("/api/v1/auth/register") ||
    path === HEALTHCHECK_PATH ||
    path.endsWith(HEALTHCHECK_PATH)
  );
}

// ponytail: run with AUTH_UTILS_SELF_CHECK=1 npx tsx frontend/src/utils/api-request-path.ts
export function runApiRequestPathSelfCheck(): void {
  const cases: Array<[unknown, string]> = [
    ["/api/v1/auth/login", "/api/v1/auth/login"],
    ["https://api.example.com/api/v1/auth/login", "/api/v1/auth/login"],
    ["auth/login", "/auth/login"],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    const actual = normalizeRequestPath(input);
    if (actual !== expected) {
      throw new Error(`normalizeRequestPath(${String(input)}) = ${actual}, want ${expected}`);
    }
  }
  if (!isPublicRequestPath("/api/v1/auth/login")) {
    throw new Error("login path should be public");
  }
  if (isPublicRequestPath("/api/v1/auth/me")) {
    throw new Error("/me should not be public");
  }
}

if (process.env.AUTH_UTILS_SELF_CHECK === "1") {
  runApiRequestPathSelfCheck();
}
