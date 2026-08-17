import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { buildOperationalScheduleFeedback } from "./schedule-operational-feedback";
import { buildRuleScheduleFeedback } from "./schedule-rule-feedback";

export type {
  ScheduleFeedbackGroup,
  ScheduleFeedbackItem,
  ScheduleFeedbackLevel,
  ScheduleFeedbackStatus,
} from "./schedule-feedback-model";

export function buildScheduleFeedback(
  state: ScheduleGenerationFacts,
  date: string
) {
  return [
    ...buildOperationalScheduleFeedback(state, date),
    ...buildRuleScheduleFeedback(state, date),
  ];
}
