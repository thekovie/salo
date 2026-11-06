/** An error the API may show to the user: a stable code, an HTTP status and a plain sentence. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = () => new AppError(404, "NOT_FOUND", "This order doesn’t exist or has been deleted.");
export const forbidden = (message = "You can’t do that in this order.") => new AppError(403, "FORBIDDEN", message);
export const closed = () => new AppError(409, "SESSION_CLOSED", "This order has ended and can’t be changed.");
