export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, msg, details) => new AppError(400, code, msg, details);
export const unauthorized = (code, msg) => new AppError(401, code, msg);
export const forbidden = (code, msg) => new AppError(403, code, msg);
export const notFound = (code, msg) => new AppError(404, code, msg);
export const conflict = (code, msg, details) => new AppError(409, code, msg, details);
export const unprocessable = (code, msg, details) => new AppError(422, code, msg, details);

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Los datos enviados no son válidos',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
