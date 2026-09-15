export interface PriorityPositionSemanticSource {
  name: string;
  remark: string;
}

export function isCombinedDeclarationDeliveryPosition(
  target: PriorityPositionSemanticSource
): boolean {
  const searchable = `${target.name} ${target.remark}`;
  return searchable.includes("申报") && searchable.includes("送资料");
}
