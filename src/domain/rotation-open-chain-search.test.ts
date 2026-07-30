import { describe, expect, it } from "vitest";

import type { Assignment } from "../model";
import { findShortestOpenRotationChain } from "./rotation-open-chain-search";
import type { RotationRole } from "./rotation-cycle-search";

function role(id: string, staffId: string): RotationRole {
  return {
    id,
    staffId,
    staffName: staffId,
    assignments: [{ id } as Assignment],
  };
}

describe("open rotation chain search", () => {
  it("uses the fifth participant when four people cannot complete the chain", () => {
    const primary = role("target", "worker-a");
    const second = role("second", "worker-b");
    const third = role("third", "worker-c");
    const fourth = role("fourth", "worker-d");
    const roles = [primary, second, third, fourth];
    const allowedIncoming = new Map([
      [primary.id, second.staffId],
      [second.id, third.staffId],
      [third.id, fourth.staffId],
      [fourth.id, "worker-e"],
    ]);
    const search = (maxParticipants: number) =>
      findShortestOpenRotationChain({
        primary,
        roles,
        endpointStaffIds: ["worker-e"],
        eligibilityReason: (target, incomingStaffId) =>
          allowedIncoming.get(target.id) === incomingStaffId
            ? null
            : "not qualified",
        safetyReasons: () => [],
        maxParticipants,
      });

    expect(search(4).chain).toBeNull();
    expect(search(5).chain).toMatchObject({
      roles: [
        { id: "target" },
        { id: "second" },
        { id: "third" },
        { id: "fourth" },
      ],
      endpointStaffId: "worker-e",
    });
  });
});
