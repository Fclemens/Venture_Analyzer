export async function auth() { return { userId: globalThis.__testUserId ?? null, sessionClaims: {} }; }
