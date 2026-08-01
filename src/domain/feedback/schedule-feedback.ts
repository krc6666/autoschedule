import type { AppState } from "../../model";
import { buildOperationalScheduleFeedback } from "./schedule-operational-feedback";
import { buildRuleScheduleFeedback } from "./schedule-rule-feedback";

export type {
  ScheduleFeedbackGroup,
  ScheduleFeedbackItem,
  ScheduleFeedbackLevel,
  ScheduleFeedbackStatus,
} from "./schedule-feedback-model";

export function buildScheduleFeedback(state: AppState, date: string) {
  return [
    ...buildOperationalScheduleFeedback(state, date),
    ...buildRuleScheduleFeedback(state, date),
  ];
}
