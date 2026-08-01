import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment, Flight, PositionRule, Staff } from "../../src/model";
import { createScheduleRunFacts } from "../../src/domain/shared/schedule-run-facts";
import { fillVacancyWithTeamLeaderConcurrentSupervision } from "../../src/domain/coverage/team-leader-concurrent-supervision";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";

function staff(id: string, teamLeader = false): Staff {
  return {
    id,
    name: `员工${id}`,
    staffType: "常规",
    teamLeader,
    cxPreflightQualified: false,
    dutyQualified: false,
    nightShift: true,
    status: "正常",
    remark: "",
  };
}

function flight(
  id: string,
  flightNo: string,
  startTime: string,
  endTime: string
): Flight {
  return {
    id,
    flightNo,
    startTime,
    endTime,
    bookedPassengers: 100,
    positions: [],
    remark: "",
  };
}

function rule(
  id: string,
  flightNo: string,
  name: string,
  qualifiedStaffIds: string[],
  category: PositionRule["category"] = "常规"
): PositionRule {
  return {
    id,
    flightNo,
    name,
    category,
    remark: "",
    qualifiedStaffIds,
    manual: false,
    fatiguePoints: 1,
    minPassengers: 0,
    earlyReleaseMinutes: category === "分流" ? 15 : 0,
  };
}

function assignment(
  rule: PositionRule,
  flight: Flight,
  person: Staff | null,
  endTime = flight.endTime
): Assignment {
  return {
    id: `assignment-${rule.id}`,
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: person?.id ?? null,
    staffName: person?.name ?? "",
    startTime: flight.startTime,
    endTime,
    workHours: person ? 2 : 0,
    fatiguePoints: rule.fatiguePoints,
    remark: "",
    manualRemark: "",
    status: person ? "assigned" : "unfilled",
  };
}

describe("team leader concurrent supervision", () => {
  it("can use an idle duty worker for a new ordinary vacancy without moving locked duty positions", async () => {
    const state = createDefaultState();
    const leader = staff("leader", true);
    const supervisorWorker = staff("supervisor-worker");
    const dutyWorker = staff("duty-worker");
    dutyWorker.dutyQualified = true;
    state.staff = [leader, supervisorWorker, dutyWorker];
    state.dutyRosterOverrides = [
      {
        date: "2026-07-29",
        cxPreflightStaffId: null,
        dutyStaffId: dutyWorker.id,
        standbyStaffIds: [null, null],
      },
    ];
    state.flights = [
      flight("morning", "CX937", "08:30", "10:30"),
      flight("first", "MF8683", "13:40", "15:40"),
      flight("second", "FD573", "15:25", "17:25"),
      flight("late", "TR121", "21:55", "23:55"),
    ];
    const [morning, first, second, late] = state.flights;
    state.positionRules = [
      rule("morning-position", "CX937", "G17", [dutyWorker.id]),
      rule("first-supervisor", "MF8683", "督导", [
        leader.id,
        supervisorWorker.id,
      ]),
      rule("second-supervisor", "FD573", "督导", [
        leader.id,
        supervisorWorker.id,
      ]),
      rule("second-vacancy", "FD573", "G10", [dutyWorker.id]),
      {
        ...rule("late-position", "TR121", "H02", [dutyWorker.id]),
        remark: "一号",
      },
    ];
    const byId = new Map(state.positionRules.map((item) => [item.id, item]));
    const morningDuty = assignment(
      byId.get("morning-position")!,
      morning!,
      dutyWorker
    );
    const lateDuty = assignment(byId.get("late-position")!, late!, dutyWorker);
    state.assignments = [
      morningDuty,
      assignment(byId.get("first-supervisor")!, first!, supervisorWorker),
      assignment(byId.get("second-supervisor")!, second!, leader),
      assignment(byId.get("second-vacancy")!, second!, null),
      lateDuty,
    ];
    const lockedAssignmentIds = new Set([morningDuty.id, lateDuty.id]);

    await fillVacancyWithTeamLeaderConcurrentSupervision(
      defaultHighsSolver,
      state,
      state.assignments,
      "2026-07-29",
      lockedAssignmentIds,
      createScheduleRunFacts(state, "2026-07-29")
    );

    expect(
      state.assignments.find((item) => item.positionRuleId === "second-vacancy")
    ).toMatchObject({
      staffId: dutyWorker.id,
      status: "assigned",
    });
    expect(morningDuty.staffId).toBe(dutyWorker.id);
    expect(lateDuty.staffId).toBe(dutyWorker.id);
  });

  it("terminates a cyclic vacancy-transfer search instead of overflowing the call stack", async () => {
    const state = createDefaultState();
    const leader = staff("leader", true);
    const workers = Array.from({ length: 14 }, (_, index) =>
      staff(`worker-${index + 1}`)
    );
    state.staff = [leader, ...workers];
    state.flights = [
      flight("mf", "MF8683", "13:40", "15:40"),
      flight("ae", "AE218", "14:25", "16:25"),
      flight("fd", "FD573", "15:25", "17:25"),
    ];
    const [mf, ae, fd] = state.flights;
    const regularIds = workers.map((person) => person.id);
    const supervisorIds = [leader.id, workers[0]!.id, workers[1]!.id];
    state.positionRules = [
      rule("mf-supervisor", "MF8683", "督导", supervisorIds, "分流"),
      ...Array.from({ length: 4 }, (_, index) =>
        rule(`mf-${index}`, "MF8683", `G${20 - index}`, regularIds)
      ),
      rule("ae-supervisor", "AE218", "督导", supervisorIds),
      ...Array.from({ length: 6 }, (_, index) =>
        rule(`ae-${index}`, "AE218", `H0${index + 2}`, regularIds)
      ),
      rule("fd-supervisor", "FD573", "督导/引导", supervisorIds),
      ...Array.from({ length: 4 }, (_, index) =>
        rule(
          `fd-${index}`,
          "FD573",
          `G${String(7 + index).padStart(2, "0")}`,
          regularIds
        )
      ),
    ];
    const byId = new Map(state.positionRules.map((item) => [item.id, item]));
    state.assignments = [
      assignment(byId.get("mf-supervisor")!, mf!, workers[0]!, "15:25"),
      ...Array.from({ length: 4 }, (_, index) =>
        assignment(byId.get(`mf-${index}`)!, mf!, workers[index + 2]!)
      ),
      assignment(byId.get("ae-supervisor")!, ae!, leader),
      ...Array.from({ length: 6 }, (_, index) =>
        assignment(byId.get(`ae-${index}`)!, ae!, workers[index + 6]!)
      ),
      assignment(byId.get("fd-supervisor")!, fd!, workers[1]!),
      assignment(byId.get("fd-0")!, fd!, workers[12]!),
      assignment(byId.get("fd-1")!, fd!, workers[13]!),
      assignment(byId.get("fd-2")!, fd!, workers[0]!),
      assignment(byId.get("fd-3")!, fd!, null),
    ];

    await fillVacancyWithTeamLeaderConcurrentSupervision(
      defaultHighsSolver,
      state,
      state.assignments,
      "2026-07-29",
      new Set(),
      createScheduleRunFacts(state, "2026-07-29")
    );
    expect(
      state.assignments.filter((item) => item.status === "unfilled")
    ).toHaveLength(1);
  });

  it("keeps the vacancy when a qualified chain exceeds three participants", async () => {
    const state = createDefaultState();
    const leader = staff("leader", true);
    const releasedSupervisor = staff("released-supervisor");
    const workers = Array.from({ length: 4 }, (_, index) =>
      staff(`worker-${index + 1}`)
    );
    state.staff = [leader, releasedSupervisor, ...workers];
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.lateShiftRecoveryEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.flights = [
      flight("first", "FIRST1", "13:40", "15:40"),
      flight("second", "SECOND1", "15:25", "17:25"),
    ];
    const [first, second] = state.flights;
    state.positionRules = [
      rule("first-supervisor", first!.flightNo, "督导", [
        leader.id,
        releasedSupervisor.id,
      ]),
      rule("second-supervisor", second!.flightNo, "督导", [
        leader.id,
        releasedSupervisor.id,
      ]),
      rule("vacancy", second!.flightNo, "G10", [workers[0]!.id]),
      rule("relay-1", second!.flightNo, "G11", [
        workers[0]!.id,
        workers[1]!.id,
      ]),
      rule("relay-2", second!.flightNo, "G12", [
        workers[1]!.id,
        workers[2]!.id,
      ]),
      rule("relay-3", second!.flightNo, "G13", [
        workers[2]!.id,
        workers[3]!.id,
      ]),
      rule("relay-4", second!.flightNo, "G14", [
        workers[3]!.id,
        releasedSupervisor.id,
      ]),
    ];
    const byId = new Map(state.positionRules.map((item) => [item.id, item]));
    state.assignments = [
      assignment(byId.get("first-supervisor")!, first!, releasedSupervisor),
      assignment(byId.get("second-supervisor")!, second!, leader),
      assignment(byId.get("vacancy")!, second!, null),
      ...workers.map((person, index) =>
        assignment(byId.get(`relay-${index + 1}`)!, second!, person)
      ),
    ];

    const messages = await fillVacancyWithTeamLeaderConcurrentSupervision(
      defaultHighsSolver,
      state,
      state.assignments,
      "2026-07-29",
      new Set(),
      createScheduleRunFacts(state, "2026-07-29")
    );

    expect(messages).toEqual([]);
    expect(
      state.assignments.find((item) => item.positionRuleId === "vacancy")
    ).toMatchObject({ staffId: null, status: "unfilled" });
    expect(
      state.assignments.find((item) => item.positionRuleId === "relay-4")
    ).toMatchObject({ staffId: workers[3]!.id, status: "assigned" });
    expect(
      state.assignments.filter((item) =>
        ["first-supervisor", "second-supervisor"].includes(
          item.positionRuleId ?? ""
        )
      )
    ).toEqual([
      expect.objectContaining({ staffId: releasedSupervisor.id }),
      expect.objectContaining({ staffId: leader.id }),
    ]);
  });

  it("never uses short-overlap concurrent supervision when either flight is KE166", async () => {
    const state = createDefaultState();
    const leader = staff("leader", true);
    const keSupervisor = staff("ke-supervisor");
    state.staff = [leader, keSupervisor];
    state.flights = [
      flight("ke", "KE166", "09:15", "11:15"),
      flight("other", "OTHER1", "11:00", "13:00"),
    ];
    const [ke, other] = state.flights;
    state.positionRules = [
      rule("ke-supervisor-role", "KE166", "督导", [leader.id, keSupervisor.id]),
      rule("other-supervisor-role", "OTHER1", "督导", [
        leader.id,
        keSupervisor.id,
      ]),
      rule("other-vacancy", "OTHER1", "G10", [keSupervisor.id]),
    ];
    const byId = new Map(state.positionRules.map((item) => [item.id, item]));
    state.assignments = [
      assignment(byId.get("ke-supervisor-role")!, ke!, keSupervisor),
      assignment(byId.get("other-supervisor-role")!, other!, leader),
      assignment(byId.get("other-vacancy")!, other!, null),
    ];

    const messages = await fillVacancyWithTeamLeaderConcurrentSupervision(
      defaultHighsSolver,
      state,
      state.assignments,
      "2026-07-29",
      new Set(),
      createScheduleRunFacts(state, "2026-07-29")
    );

    expect(messages).toEqual([]);
    expect(
      state.assignments.find((item) => item.positionRuleId === "other-vacancy")
    ).toMatchObject({
      staffId: null,
      status: "unfilled",
    });
    expect(
      state.assignments.find(
        (item) => item.positionRuleId === "ke-supervisor-role"
      )?.staffId
    ).toBe(keSupervisor.id);
  });
});
