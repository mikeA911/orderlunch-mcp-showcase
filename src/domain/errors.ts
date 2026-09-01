export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details?: Record<string, unknown>) {
    super(message)
  }
}
export const errors = {
  forbidden: (message = 'This action is not permitted') => new DomainError('FORBIDDEN', message, 403),
  notFound: (entity: string) => new DomainError('NOT_FOUND', `${entity} was not found`, 404),
  conflict: (message: string) => new DomainError('CONFLICT', message, 409),
  expired: (entity: string) => new DomainError('EXPIRED', `${entity} has expired`, 410),
  invalid: (message: string) => new DomainError('INVALID_REQUEST', message, 422),
}
