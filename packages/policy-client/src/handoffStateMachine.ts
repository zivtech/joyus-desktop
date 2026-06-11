import { HandoffError, type HandoffState } from "./handoffTypes";

const VALID_TRANSITIONS: Record<HandoffState, readonly HandoffState[]> = {
  initiated: ["authorizing", "failed"],
  authorizing: ["encrypting", "failed"],
  encrypting: ["transferring", "failed"],
  transferring: ["completed", "failed"],
  completed: [],
  failed: [],
};

const FINAL_STATES: ReadonlySet<HandoffState> = new Set(["completed", "failed"]);

export class HandoffStateMachine {
  private state: HandoffState;

  constructor(initialState: HandoffState = "initiated") {
    this.state = initialState;
  }

  getState(): HandoffState {
    return this.state;
  }

  isFinal(): boolean {
    return FINAL_STATES.has(this.state);
  }

  canTransitionTo(to: HandoffState): boolean {
    return VALID_TRANSITIONS[this.state].includes(to);
  }

  transition(to: HandoffState): void {
    if (to === this.state) {
      throw new HandoffError(
        "INVALID_TRANSITION",
        `Cannot transition from '${this.state}' to itself`
      );
    }

    if (!this.canTransitionTo(to)) {
      throw new HandoffError(
        "INVALID_TRANSITION",
        `Invalid transition from '${this.state}' to '${to}'`
      );
    }

    this.state = to;
  }
}

export function createHandoffStateMachine(initialState?: HandoffState): HandoffStateMachine {
  return new HandoffStateMachine(initialState);
}
