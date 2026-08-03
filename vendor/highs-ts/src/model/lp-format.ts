import type { Var } from "./var.js";
import type { LinExpr } from "./expr.js";
import type { Constraint } from "./constraint.js";

export interface LPFormatInput {
  objective: LinExpr | null;
  sense: "minimize" | "maximize";
  constraints: Constraint[];
  variables: Var[];
}

export function toLPFormat(input: LPFormatInput): string {
  const lines: string[] = [];

  if (input.sense === "maximize") {
    lines.push("Maximize");
  } else {
    lines.push("Minimize");
  }

  if (input.objective) {
    lines.push(`  obj: ${formatExpr(input.objective)}`);
  } else {
    lines.push("  obj: 0");
  }

  lines.push("Subject To");
  let constraintIndex = 0;
  for (const constraint of input.constraints) {
    const name = constraint.name ?? `c${constraintIndex++}`;
    const exprStr = formatExpr(constraint.expr);
    const senseStr = constraint.sense === "=" ? "=" : constraint.sense;
    const rhs = constraint.rhs - constraint.expr.constant;
    lines.push(`  ${name}: ${exprStr} ${senseStr} ${formatNumber(rhs)}`);
  }

  const boundsLines: string[] = [];
  const generalVars: string[] = [];
  const binaryVars: string[] = [];

  for (const v of input.variables) {
    if (v.type === "binary") {
      binaryVars.push(v.name);
    } else {
      if (v.type === "integer") {
        generalVars.push(v.name);
      }
      const hasNonDefaultBounds = v.lb !== 0 || v.ub !== Infinity;
      if (hasNonDefaultBounds) {
        if (v.ub === Infinity) {
          boundsLines.push(`  ${formatNumber(v.lb)} <= ${v.name}`);
        } else {
          boundsLines.push(
            `  ${formatNumber(v.lb)} <= ${v.name} <= ${formatNumber(v.ub)}`
          );
        }
      }
    }
  }

  if (boundsLines.length > 0) {
    lines.push("Bounds");
    lines.push(...boundsLines);
  }

  if (generalVars.length > 0) {
    lines.push("General");
    lines.push(`  ${generalVars.join(" ")}`);
  }

  if (binaryVars.length > 0) {
    lines.push("Binary");
    lines.push(`  ${binaryVars.join(" ")}`);
  }

  lines.push("End");
  return lines.join("\n") + "\n";
}

function formatExpr(expr: LinExpr): string {
  const consolidated = consolidateTerms(expr);
  if (consolidated.length === 0) {
    return "0";
  }

  const parts: string[] = [];
  for (let i = 0; i < consolidated.length; i++) {
    const { coeff, varName } = consolidated[i];
    if (coeff === 0) continue;

    if (i === 0) {
      if (coeff === 1) {
        parts.push(varName);
      } else if (coeff === -1) {
        parts.push(`- ${varName}`);
      } else if (coeff < 0) {
        parts.push(`- ${formatNumber(-coeff)} ${varName}`);
      } else {
        parts.push(`${formatNumber(coeff)} ${varName}`);
      }
    } else {
      if (coeff === 1) {
        parts.push(`+ ${varName}`);
      } else if (coeff === -1) {
        parts.push(`- ${varName}`);
      } else if (coeff < 0) {
        parts.push(`- ${formatNumber(-coeff)} ${varName}`);
      } else {
        parts.push(`+ ${formatNumber(coeff)} ${varName}`);
      }
    }
  }

  return parts.join(" ") || "0";
}

function consolidateTerms(expr: LinExpr): { coeff: number; varName: string }[] {
  const coeffMap = new Map<string, number>();
  for (const term of expr.terms) {
    const current = coeffMap.get(term.var.name) ?? 0;
    coeffMap.set(term.var.name, current + term.coeff);
  }
  const result: { coeff: number; varName: string }[] = [];
  for (const [varName, coeff] of coeffMap) {
    if (coeff !== 0) {
      result.push({ coeff, varName });
    }
  }
  return result;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toString();
}
