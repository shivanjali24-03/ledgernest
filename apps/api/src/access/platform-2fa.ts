/**
 * Whether a Super Admin must have two-factor sign-in on to use the platform console or support access.
 * One password-only account could otherwise read and change every organisation's books. On by default in
 * production; PLATFORM_REQUIRE_2FA overrides it either way.
 */
export const platformTwoFactorRequired = () =>
  process.env.PLATFORM_REQUIRE_2FA
    ? process.env.PLATFORM_REQUIRE_2FA === 'true'
    : process.env.NODE_ENV === 'production';
