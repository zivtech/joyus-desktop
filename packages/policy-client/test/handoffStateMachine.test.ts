import { describe, it, expect } from "vitest";
import { HandoffStateMachine, createHandoffStateMachine } from "../src/handoffStateMachine";
import { HandoffError, type HandoffState } from "../src/handoffTypes";

describe("HandoffStateMachine - happy path", () => {
  it("walks the full success path: initiated → authorizing → encrypting → transferring → completed", () => {
    const sm = new HandoffStateMachine();
    expect(sm.getState()).toBe("initiated");

    sm.transition("authorizing");
    expect(sm.getState()).toBe("authorizing");

    sm.transition("encrypting");
    expect(sm.getState()).toBe("encrypting");

    sm.transition("transferring");
    expect(sm.getState()).toBe("transferring");

    sm.transition("completed");
    expect(sm.getState()).toBe("completed");
  });
});

describe("HandoffStateMachine - valid transitions individually", () => {
  it("initiated → authorizing", () => {
    const sm = new HandoffStateMachine("initiated");
    sm.transition("authorizing");
    expect(sm.getState()).toBe("authorizing");
  });

  it("initiated → failed", () => {
    const sm = new HandoffStateMachine("initiated");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("authorizing → encrypting", () => {
    const sm = new HandoffStateMachine("authorizing");
    sm.transition("encrypting");
    expect(sm.getState()).toBe("encrypting");
  });

  it("authorizing → failed", () => {
    const sm = new HandoffStateMachine("authorizing");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("encrypting → transferring", () => {
    const sm = new HandoffStateMachine("encrypting");
    sm.transition("transferring");
    expect(sm.getState()).toBe("transferring");
  });

  it("encrypting → failed", () => {
    const sm = new HandoffStateMachine("encrypting");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("transferring → completed", () => {
    const sm = new HandoffStateMachine("transferring");
    sm.transition("completed");
    expect(sm.getState()).toBe("completed");
  });

  it("transferring → failed", () => {
    const sm = new HandoffStateMachine("transferring");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });
});

describe("HandoffStateMachine - invalid transitions", () => {
  it("initiated → encrypting throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(() => sm.transition("encrypting")).toThrow(HandoffError);
    expect(() => new HandoffStateMachine("initiated").transition("encrypting")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("initiated → completed throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(() => sm.transition("completed")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("initiated → transferring throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(() => sm.transition("transferring")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("authorizing → initiated throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("authorizing");
    expect(() => sm.transition("initiated")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("authorizing → transferring throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("authorizing");
    expect(() => sm.transition("transferring")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("authorizing → completed throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("authorizing");
    expect(() => sm.transition("completed")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("encrypting → initiated throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("encrypting");
    expect(() => sm.transition("initiated")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("encrypting → authorizing throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("encrypting");
    expect(() => sm.transition("authorizing")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("encrypting → completed throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("encrypting");
    expect(() => sm.transition("completed")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("transferring → initiated throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("transferring");
    expect(() => sm.transition("initiated")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("transferring → authorizing throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("transferring");
    expect(() => sm.transition("authorizing")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("transferring → encrypting throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("transferring");
    expect(() => sm.transition("encrypting")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });
});

describe("HandoffStateMachine - final state behavior", () => {
  it("completed → authorizing throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("completed");
    expect(() => sm.transition("authorizing")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("completed → failed throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("completed");
    expect(() => sm.transition("failed")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("failed → authorizing throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("failed");
    expect(() => sm.transition("authorizing")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });

  it("failed → completed throws INVALID_TRANSITION", () => {
    const sm = new HandoffStateMachine("failed");
    expect(() => sm.transition("completed")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" })
    );
  });
});

describe("HandoffStateMachine - self-transitions throw", () => {
  const allStates: HandoffState[] = [
    "initiated",
    "authorizing",
    "encrypting",
    "transferring",
    "completed",
    "failed",
  ];

  for (const state of allStates) {
    it(`${state} → ${state} throws INVALID_TRANSITION`, () => {
      const sm = new HandoffStateMachine(state);
      expect(() => sm.transition(state)).toThrowError(
        expect.objectContaining({ code: "INVALID_TRANSITION" })
      );
    });
  }
});

describe("HandoffStateMachine - any non-final → failed", () => {
  it("initiated → failed succeeds", () => {
    const sm = new HandoffStateMachine("initiated");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("authorizing → failed succeeds", () => {
    const sm = new HandoffStateMachine("authorizing");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("encrypting → failed succeeds", () => {
    const sm = new HandoffStateMachine("encrypting");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });

  it("transferring → failed succeeds", () => {
    const sm = new HandoffStateMachine("transferring");
    sm.transition("failed");
    expect(sm.getState()).toBe("failed");
  });
});

describe("HandoffStateMachine - canTransitionTo", () => {
  it("returns true for valid transitions", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(sm.canTransitionTo("authorizing")).toBe(true);
    expect(sm.canTransitionTo("failed")).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(sm.canTransitionTo("encrypting")).toBe(false);
    expect(sm.canTransitionTo("transferring")).toBe(false);
    expect(sm.canTransitionTo("completed")).toBe(false);
    expect(sm.canTransitionTo("initiated")).toBe(false);
  });

  it("returns false for all transitions from completed", () => {
    const sm = new HandoffStateMachine("completed");
    expect(sm.canTransitionTo("initiated")).toBe(false);
    expect(sm.canTransitionTo("authorizing")).toBe(false);
    expect(sm.canTransitionTo("encrypting")).toBe(false);
    expect(sm.canTransitionTo("transferring")).toBe(false);
    expect(sm.canTransitionTo("completed")).toBe(false);
    expect(sm.canTransitionTo("failed")).toBe(false);
  });

  it("returns false for all transitions from failed", () => {
    const sm = new HandoffStateMachine("failed");
    expect(sm.canTransitionTo("initiated")).toBe(false);
    expect(sm.canTransitionTo("authorizing")).toBe(false);
    expect(sm.canTransitionTo("encrypting")).toBe(false);
    expect(sm.canTransitionTo("transferring")).toBe(false);
    expect(sm.canTransitionTo("completed")).toBe(false);
    expect(sm.canTransitionTo("failed")).toBe(false);
  });
});

describe("HandoffStateMachine - isFinal", () => {
  it("returns true for completed", () => {
    const sm = new HandoffStateMachine("completed");
    expect(sm.isFinal()).toBe(true);
  });

  it("returns true for failed", () => {
    const sm = new HandoffStateMachine("failed");
    expect(sm.isFinal()).toBe(true);
  });

  it("returns false for initiated", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(sm.isFinal()).toBe(false);
  });

  it("returns false for authorizing", () => {
    const sm = new HandoffStateMachine("authorizing");
    expect(sm.isFinal()).toBe(false);
  });

  it("returns false for encrypting", () => {
    const sm = new HandoffStateMachine("encrypting");
    expect(sm.isFinal()).toBe(false);
  });

  it("returns false for transferring", () => {
    const sm = new HandoffStateMachine("transferring");
    expect(sm.isFinal()).toBe(false);
  });

  it("becomes final after reaching completed", () => {
    const sm = new HandoffStateMachine("transferring");
    expect(sm.isFinal()).toBe(false);
    sm.transition("completed");
    expect(sm.isFinal()).toBe(true);
  });

  it("becomes final after reaching failed", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(sm.isFinal()).toBe(false);
    sm.transition("failed");
    expect(sm.isFinal()).toBe(true);
  });
});

describe("createHandoffStateMachine factory", () => {
  it("creates with default state initiated when no argument given", () => {
    const sm = createHandoffStateMachine();
    expect(sm.getState()).toBe("initiated");
  });

  it("creates with custom initial state", () => {
    const sm = createHandoffStateMachine("authorizing");
    expect(sm.getState()).toBe("authorizing");
  });

  it("creates with encrypting initial state", () => {
    const sm = createHandoffStateMachine("encrypting");
    expect(sm.getState()).toBe("encrypting");
  });

  it("creates with completed initial state", () => {
    const sm = createHandoffStateMachine("completed");
    expect(sm.getState()).toBe("completed");
    expect(sm.isFinal()).toBe(true);
  });

  it("returns a HandoffStateMachine instance", () => {
    const sm = createHandoffStateMachine();
    expect(sm).toBeInstanceOf(HandoffStateMachine);
  });
});

describe("HandoffStateMachine - getState", () => {
  it("returns initial state correctly", () => {
    const sm = new HandoffStateMachine("encrypting");
    expect(sm.getState()).toBe("encrypting");
  });

  it("returns updated state after transition", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(sm.getState()).toBe("initiated");
    sm.transition("authorizing");
    expect(sm.getState()).toBe("authorizing");
    sm.transition("encrypting");
    expect(sm.getState()).toBe("encrypting");
  });

  it("state does not change after failed transition attempt", () => {
    const sm = new HandoffStateMachine("initiated");
    expect(() => sm.transition("completed")).toThrow();
    expect(sm.getState()).toBe("initiated");
  });
});
