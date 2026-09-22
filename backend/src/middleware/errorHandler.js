/** Convenience factory for custom HTTP errors. */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Central error handler. All thrown errors land here via next(err).
 * 5xx messages are swallowed — raw Postgres/PostgREST text names columns and
 * constraints, which turns any error into a schema-enumeration oracle.
 */
export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';

  // Deliberate AppErrors carry messages we wrote; anything else may be raw
  // Postgres/SDK text naming columns and constraints, so it is not echoed.
  const deliberate = err instanceof AppError;

  if (statusCode >= 500 && !deliberate) {
    console.error(`[error] ${req.method} ${req.path}`, err);
  } else if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.path}: ${err.message}`);
  }

  res.status(statusCode).json({
    error: deliberate || statusCode < 500 ? err.message : 'An unexpected error occurred',
    code,
  });
}

/**
 * Wraps a Supabase/PostgREST error. The driver's message names columns,
 * constraints and array-literal syntax, so it is logged, never returned —
 * echoing it turns any malformed filter into a schema-enumeration oracle.
 */
export function dbError(error) {
  console.error('[db]', error?.code, error?.message);
  return new AppError('Could not complete that request', 500, 'DB_ERROR');
}

export function notFound(req, res) {
  // The path is not echoed back — it can carry secrets from a mistyped query string.
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
}
