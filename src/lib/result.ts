export type AppError = {
  code: ErrorCode;
  message: string;
  stage?: string;
  details?: unknown;
};

export const ErrorCode = {
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  SOURCE_PAUSED: 'SOURCE_PAUSED',
  DUPLICATE_PAYLOAD: 'DUPLICATE_PAYLOAD',
  FIELD_CREATE_FAILED: 'FIELD_CREATE_FAILED',
  RECORD_UPSERT_FAILED: 'RECORD_UPSERT_FAILED',
  NOTE_CREATE_FAILED: 'NOTE_CREATE_FAILED',
  SCHEMA_FETCH_FAILED: 'SCHEMA_FETCH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type Ok<T> = { ok: true; value: T };
export type Err<E extends AppError = AppError> = { ok: false; error: E };
export type Result<T, E extends AppError = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E extends AppError>(
  code: E['code'],
  message: string,
  details?: unknown,
): Err<E> =>
  ({ ok: false, error: { code, message, details } as E });

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok;
}

export function unwrapOr<T>(r: Result<T>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function mapResult<T, U>(
  r: Result<T>,
  fn: (v: T) => U,
): Result<U> {
  return r.ok ? ok(fn(r.value)) : r;
}
