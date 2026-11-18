import "server-only";

// Protected actions pass the user returned by the authoritative server session.
export function hasVerifiedEmail<User extends { emailVerified: boolean }>(
  user: User | null | undefined,
): user is User & { emailVerified: true } {
  return user?.emailVerified === true;
}
