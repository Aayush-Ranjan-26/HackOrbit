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
  let code = err.code || 'INTERNAL_ERROR';

  // Deliberate AppErrors carry messages we wrote; anything else may be raw
  // Postgres/SDK text naming columns and constraints, so it is not echoed.
  const deliberate = err instanceof AppError;

  /*
   * express.json() rejects a malformed or oversized body before any route
   * runs, and its own message was being echoed verbatim under the wrong code
   * (`{bad` → 400 INTERNAL_ERROR, 200KB → 413 INTERNAL_ERROR). Restate both in
   * our own vocabulary; the sub-500 branch below would otherwise pass third
   * party text through.
   */
  if (!deliberate && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (!deliberate && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' });
  }

  // A driver-specific code on an unexpected 500 is itself a hint about the stack.
  if (statusCode >= 500 && !deliberate) code = 'INTERNAL_ERROR';

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
