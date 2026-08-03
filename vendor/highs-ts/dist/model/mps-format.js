/**
 * Converts a model to fixed MPS format. Uses the modern "free" MPS format
 * which doesn't require strict column alignment.
 */
export function toMPSFormat(input) {
  const lines = [];
  const constraintNames = [];
  lines.push("NAME          problem");
  if (input.sense === "maximize") {
    lines.push("OBJSENSE");
    lines.push(" MAX");
  }
  // ROWS section: objective and constraints
  lines.push("ROWS");
  lines.push(" N  obj");
  let constraintIndex = 0;
  for (const constraint of input.constraints) {
    const name = constraint.name ?? `c${constraintIndex++}`;
    constraintNames.push(name);
    const rowType =
      constraint.sense === "<=" ? "L" : constraint.sense === ">=" ? "G" : "E";
    lines.push(` ${rowType}  ${name}`);
  }
  // COLUMNS section: variable coefficients
  lines.push("COLUMNS");
  // Build coefficient map: varName -> { rowName -> coeff }
  const varCoeffs = new Map();
  for (const v of input.variables) {
    varCoeffs.set(v.name, new Map());
  }
  // Add objective coefficients
  if (input.objective) {
    for (const term of input.objective.terms) {
      const coeffs = varCoeffs.get(term.var.name);
      const current = coeffs.get("obj") ?? 0;
      coeffs.set("obj", current + term.coeff);
    }
  }
  // Add constraint coefficients
  for (let i = 0; i < input.constraints.length; i++) {
    const constraint = input.constraints[i];
    const rowName = constraintNames[i];
    for (const term of constraint.expr.terms) {
      const coeffs = varCoeffs.get(term.var.name);
      const current = coeffs.get(rowName) ?? 0;
      coeffs.set(rowName, current + term.coeff);
    }
  }
  // Output columns, marking integer variables
  const integerVars = input.variables.filter(
    (v) => v.type === "integer" || v.type === "binary"
  );
  const continuousVars = input.variables.filter((v) => v.type === "continuous");
  // A variable with no nonzero coefficients would never be mentioned in
  // COLUMNS and so would not exist in the parsed model; an explicit zero
  // objective entry keeps it (and its solution value) alive.
  function pushColumn(v) {
    const coeffs = varCoeffs.get(v.name);
    let emitted = false;
    for (const [rowName, coeff] of coeffs) {
      if (coeff !== 0) {
        lines.push(`    ${v.name}  ${rowName}  ${coeff}`);
        emitted = true;
      }
    }
    if (!emitted) {
      lines.push(`    ${v.name}  obj  0`);
    }
  }
  for (const v of continuousVars) {
    pushColumn(v);
  }
  if (integerVars.length > 0) {
    lines.push("    MARKER    'MARKER'  'INTORG'");
    for (const v of integerVars) {
      pushColumn(v);
    }
    lines.push("    MARKER    'MARKER'  'INTEND'");
  }
  // RHS section
  lines.push("RHS");
  for (let i = 0; i < input.constraints.length; i++) {
    const constraint = input.constraints[i];
    const rowName = constraintNames[i];
    const rhs = constraint.rhs - constraint.expr.constant;
    if (rhs !== 0) {
      lines.push(`    rhs  ${rowName}  ${rhs}`);
    }
  }
  // BOUNDS section
  const hasBounds = input.variables.some(
    (v) => v.type !== "binary" && (v.lb !== 0 || v.ub !== Infinity)
  );
  const hasBinary = input.variables.some((v) => v.type === "binary");
  if (hasBounds || hasBinary) {
    lines.push("BOUNDS");
    for (const v of input.variables) {
      if (v.type === "binary") {
        lines.push(` BV bnd  ${v.name}`);
      } else {
        if (v.lb !== 0) {
          lines.push(` LO bnd  ${v.name}  ${v.lb}`);
        }
        if (v.ub !== Infinity) {
          lines.push(` UP bnd  ${v.name}  ${v.ub}`);
        } else if (v.lb === 0) {
          lines.push(` PL bnd  ${v.name}`);
        }
      }
    }
  }
  lines.push("ENDATA");
  return lines.join("\n") + "\n";
}
//# sourceMappingURL=mps-format.js.map
