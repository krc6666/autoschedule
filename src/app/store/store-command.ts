import type { AppState } from "../../model";

export type StateCommand = <T>(command: (state: AppState) => T) => T;
