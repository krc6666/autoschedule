import { createDefaultState } from "../../src/defaults";
import type { AppState } from "../../src/model";

export function createOrdinaryStaffDefaultState(): AppState {
  const state = createDefaultState();
  state.staff.forEach((person) => {
    person.teamLeader = false;
  });
  return state;
}
