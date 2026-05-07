function captureStackTrace(target: object) {
  const E = Error as ErrorConstructor & {
    captureStackTrace?: (
      targetObject: object,
      constructorOpt?: abstract new (...args: unknown[]) => unknown,
    ) => void;
  };

  const ctor = target.constructor as abstract new (
    ...args: unknown[]
  ) => unknown;

  E.captureStackTrace?.(target, ctor);
}

export class AppError extends Error {
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      isOperational?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });

    this.name = this.constructor.name;
    this.code = options?.code;
    this.statusCode = options?.statusCode;
    this.isOperational = options?.isOperational ?? true;

    captureStackTrace(this);
  }
}
