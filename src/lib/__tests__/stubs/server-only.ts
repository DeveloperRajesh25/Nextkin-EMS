/**
 * No-op stand-in for the `server-only` package under Vitest.
 *
 * The real package throws when imported outside a server context, which is
 * exactly what makes it useful as a build-time guard against a secret leaking
 * into a client bundle. Under test we import those modules directly to exercise
 * their pure logic, so the guard is aliased away here rather than weakened in
 * the modules themselves.
 */
export {}
