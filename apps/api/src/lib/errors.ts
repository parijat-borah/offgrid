import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, "VALIDATION_FAILED", message, fields);
export const unauthorized = (message = "Please log in again.") => new HttpError(401, "UNAUTHORIZED", message);
// 404 rather than 403 for other people's resources, so ids can't be probed.
export const notFound = (what = "Not found") => new HttpError(404, "NOT_FOUND", what);
export const conflict = (message: string) => new HttpError(409, "CONFLICT", message);

/** Parse with zod and turn failures into a 400 with a message per field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw badRequest("Some fields need fixing.", fields);
}
