export class ManualInterventionError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export class IndeterminateResultError extends Error {
  constructor(message = "RESULTADO_INDETERMINADO") {
    super(message);
  }
}

export class ReprocessableAutomationError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
