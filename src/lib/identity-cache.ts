const IDENTITY_CHECK_TTL_MS = 60 * 60 * 1000; // 1 hour
const identityCache = new Map<string, { status: string; timestamp: number }>();

export function getCachedIdentityStatus(username: string): string | undefined {
  const cached = identityCache.get(username);
  if (cached && Date.now() - cached.timestamp < IDENTITY_CHECK_TTL_MS) {
    return cached.status;
  }
  return undefined;
}

export function setCachedIdentityStatus(username: string, status: string): void {
  identityCache.set(username, { status, timestamp: Date.now() });
}

export function clearIdentityCache(username: string): void {
  identityCache.delete(username);
}
