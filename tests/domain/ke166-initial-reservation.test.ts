import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { evaluateAutomaticHardConstraints } from "../../src/domain/rules/built-in-rule-registry";
import { optimizeDailySchedule } from "../../src/domain/kernel/daily-schedule-optimizer";
import { prepareSchedule } from "../../src/domain/kernel/schedule-preparation";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";
import { generateSchedule } from "../helpers/generate-schedule";

function scenario(withCounter = true, extraSupervisor = false) {
  const state = createDefaultState();
  const [blocked, needed, replacement, spare] = state.staff;
  state.staff = [
    blocked!,
    needed!,
    replacement!,
    ...(extraSupervisor ? [spare!] : []),
  ].map((person) => ({
    ...person,
    status: "正常" as const,
    teamLeader: false,
    nightShift: true,
    dutyQualified: false,
  }));
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.lateShiftRecoveryEnabled = false;
  state.settings.positionRotationEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  state.dutyRosterOverrides = [
    {
      date: "2026-09-18",
      cxPreflightStaffId: null,
      dutyStaffId: null,
      standbyStaffIds: [null, null],
    },
  ];
  state.flights = [
    {
      id: "fixed",
      flightNo: "FIX100",
      startTime: "20:00",
      endTime: "22:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
    {
      id: "cx",
      flightNo: "CX937",
      startTime: "20:00",
      endTime: "22:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
    {
      id: "ke",
      flightNo: "KE166",
      startTime: "20:00",
      endTime: "22:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
  ];
  const base = state.positionRules[0]!;
  state.positionRules = [
    {
      ...base,
      id: "fixed",
      flightNo: "FIX100",
      name: "G01",
      category: "常规",
      qualifiedStaffIds: [blocked!.id],
      fatiguePoints: 2,
    },
    {
      ...base,
      id: "cx",
      flightNo: "CX937",
      name: "G01",
      category: "常规",
      qualifiedStaffIds: withCounter
        ? [needed!.id, replacement!.id]
        : [needed!.id],
      fatiguePoints: 2,
    },
    {
      ...base,
      id: "ke-supervisor",
      flightNo: "KE166",
      name: "督导",
      category: "机动督导",
      qualifiedStaffIds: [
        blocked!.id,
        needed!.id,
        ...(extraSupervisor ? [spare!.id] : []),
      ],
      fatiguePoints: 5,
    },
    {
      ...base,
      id: "ke-counter",
      flightNo: "KE166",
      name: "H04",
      remark: withCounter ? "" : "排查",
      category: "常规",
      qualifiedStaffIds: withCounter
        ? [needed!.id, replacement!.id]
        : [replacement!.id],
      fatiguePoints: 2,
    },
  ];
  if (withCounter)
    state.history = [
      {
        id: "prior-ke",
        date: "2026-09-16",
        flightNo: "KE166",
        position: "H04",
        staffId: needed!.id,
        staffName: needed!.name,
        startTime: "20:00",
        endTime: "22:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      },
      {
        id: "prior-cx",
        date: "2026-09-16",
        flightNo: "CX937",
        position: "G01",
        staffId: replacement!.id,
        staffName: replacement!.name,
        startTime: "20:00",
        endTime: "22:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      },
    ];
  return {
    state,
    needed: needed!.id,
    replacement: replacement!.id,
    spare: spare!.id,
  };
}

describe(
  "KE166 supervisor capacity in the initial schedule",
  { timeout: 30_000 },
  () => {
    it("reserves a compatible KE counter while keeping CX937 staffed", async () => {
      const { state, needed, replacement } = scenario();
      state.settings.latePriorityFlightNumbers = ["TR121"];
      state.history.push({
        id: "prior-late",
        date: "2026-09-16",
        flightNo: "TR121",
        position: "H02",
        staffId: needed,
        staffName: state.staff.find((person) => person.id === needed)!.name,
        startTime: "22:00",
        endTime: "23:30",
        workHours: 1.5,
        fatiguePoints: 10,
        remark: "一号",
      });
      state.staff.find((person) => person.id === needed)!.dutyQualified = true;
      state.dutyRosterOverrides[0]!.dutyStaffId = needed;
      state.settings.dutyPositionPriorities = [
        { id: "cx", enabled: true, flightNo: "CX937", positionKeyword: "G01" },
      ];
      const preparation = prepareSchedule(
        state,
        "2026-09-18",
        evaluateAutomaticHardConstraints
      );
      const initial = await optimizeDailySchedule({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-18",
        preparation,
      });
      expect(
        initial.assignments.find((item) => item.positionRuleId === "ke-counter")
          ?.staffId
      ).toBe(needed);
      expect(
        initial.assignments.find((item) => item.positionRuleId === "cx")
          ?.staffId
      ).toBe(replacement);

      const result = await generateSchedule(state, "2026-09-18");
      expect(
        result.assignments.find(
          (item) => item.positionRuleId === "ke-supervisor"
        )
      ).toMatchObject({ staffId: needed, status: "assigned" });
      expect(
        result.assignments.find((item) => item.positionRuleId === "cx")
      ).toMatchObject({ staffId: replacement, status: "assigned" });
      expect(
        result.assignments.find((item) => item.positionRuleId === "ke-counter")
          ?.supervisorSourceAssignmentId
      ).toBeTruthy();
    });

    it("keeps an independent supervisor when a spare qualified worker is available", async () => {
      const { state, spare } = scenario(true, true);
      const result = await generateSchedule(state, "2026-09-18");
      expect(
        result.assignments.find(
          (item) => item.positionRuleId === "ke-supervisor"
        )
      ).toMatchObject({ staffId: spare, status: "assigned" });
      expect(
        result.assignments.find((item) => item.positionRuleId === "ke-counter")
          ?.supervisorSourceAssignmentId
      ).toBeUndefined();
      expect(
        result.assignments.find((item) => item.positionRuleId === "cx")?.status
      ).toBe("assigned");
    });

    it("does not treat a fully booked supervisor as independently available", async () => {
      const { state, needed, replacement } = scenario();
      const alreadyBusy = state.staff[0]!;
      const base = state.positionRules[0]!;
      state.settings.maxDailyHours = 8;
      state.staff.find((person) => person.id === needed)!.dutyQualified = true;
      state.dutyRosterOverrides[0]!.dutyStaffId = needed;
      state.settings.dutyPositionPriorities = [
        { id: "cx", enabled: true, flightNo: "CX937", positionKeyword: "G01" },
      ];
      state.flights[0] = {
        ...state.flights[0]!,
        startTime: "08:00",
        endTime: "12:00",
      };
      state.flights.push({
        id: "second",
        flightNo: "FIX200",
        startTime: "13:30",
        endTime: "17:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      });
      state.positionRules.push({
        ...base,
        id: "second",
        flightNo: "FIX200",
        name: "G01",
        category: "常规",
        qualifiedStaffIds: [alreadyBusy.id],
        fatiguePoints: 2,
      });
      state.positionRules.find(
        (rule) => rule.id === "ke-supervisor"
      )!.qualifiedStaffIds = [alreadyBusy.id, needed];

      const result = await generateSchedule(state, "2026-09-18");
      expect(
        result.assignments.find(
          (item) => item.positionRuleId === "ke-supervisor"
        )
      ).toMatchObject({ staffId: needed, status: "assigned" });
      expect(
        result.assignments.find((item) => item.positionRuleId === "cx")
      ).toMatchObject({ staffId: replacement, status: "assigned" });
    });

    it("leaves the supervisor vacant without a compatible counter rather than taking CX937 staff", async () => {
      const { state } = scenario(false);
      const result = await generateSchedule(state, "2026-09-18");
      expect(
        result.assignments.find(
          (item) => item.positionRuleId === "ke-supervisor"
        )
      ).toMatchObject({ staffId: null, status: "unfilled" });
      expect(
        result.assignments.find((item) => item.positionRuleId === "cx")?.status
      ).toBe("assigned");
      expect(result.warnings).toContain(
        "KE166机动督导未安排，岗位已留空，请人工复核"
      );
    });
  }
);
