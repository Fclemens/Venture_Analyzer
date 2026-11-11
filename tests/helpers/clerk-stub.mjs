export async function auth() {
  return { userId: globalThis.__testUserId ?? null, orgId: globalThis.__testOrgId ?? null, sessionClaims: {} };
}
export async function clerkClient() {
  return { users: { getUser: async (id) => ({ firstName: globalThis.__testNames?.[id] ?? "", lastName: "", emailAddresses: [{ emailAddress: `${id}@example.com` }] }) } };
}
