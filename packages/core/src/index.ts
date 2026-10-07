/**
 * Domain layer. Framework-independent on purpose (AD-1): nothing here imports
 * Next.js, React or a database driver, so it can be lifted into a standalone
 * API later without rewriting the business rules.
 *
 * Built in Phase 2 onwards. Phase 0 exports only what the shell needs: the
 * corridor configuration and the nav presets.
 */

export * from './domain'