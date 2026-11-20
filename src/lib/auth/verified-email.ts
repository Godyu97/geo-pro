import "server-only";

export function isEmailVerificationMocked(env: Record<string, string | undefined> = process.env) {
  const value = env.GEO_AUTH_EMAIL_VERIFIED_MOCK?.trim().toLowerCase();
  return value === "true" || value === "1";
}

// Protected actions pass the user returned by the authoritative server session.
export function hasVerifiedEmail<User extends { emailVerified: boolean }>(
  user: User | null | undefined,
): user is User & { emailVerified: true } {
  if (!user) return false;
  return user.emailVerified === true || isEmailVerificationMocked();
}
