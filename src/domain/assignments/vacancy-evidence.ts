import type { Assignment } from "../../model";

export type AutomaticVacancyReason =
  "daily-flight-count-balance" | "no-qualified-candidate";

export interface AutomaticVacancyEvidence {
  reason: AutomaticVacancyReason;
  blockers: string[];
}

export const DAILY_FLIGHT_COUNT_BALANCE_VACANCY_NOTE = "航班数均衡回退";
export const NO_QUALIFIED_CANDIDATE_VACANCY_NOTE = "真实无候选人员";

export function setAutomaticVacancyEvidence(
  assignment: Assignment,
  evidence: AutomaticVacancyEvidence
): void {
  assignment.vacancyEvidence = {
    reason: evidence.reason,
    blockers: [...evidence.blockers],
  };
  const reasonNote =
    evidence.reason === "daily-flight-count-balance"
      ? DAILY_FLIGHT_COUNT_BALANCE_VACANCY_NOTE
      : NO_QUALIFIED_CANDIDATE_VACANCY_NOTE;
  assignment.systemNotes = [
    `${reasonNote}：${evidence.blockers.join("；") || "未提供阻塞证据"}`,
  ];
}

export function clearAutomaticVacancyEvidence(assignment: Assignment): void {
  delete assignment.vacancyEvidence;
}

export function isDailyFlightCountBalanceVacancy(
  assignment: Assignment
): boolean {
  return assignment.vacancyEvidence?.reason === "daily-flight-count-balance";
}
