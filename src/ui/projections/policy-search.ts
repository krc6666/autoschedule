export function normalizePolicySearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase("zh-CN");
}

export function matchesPolicySearch(
  query: string,
  ...values: readonly unknown[]
): boolean {
  const normalizedQuery = normalizePolicySearchQuery(query);
  if (!normalizedQuery) return true;
  return values
    .flat(Infinity)
    .filter((value) => value !== null && value !== undefined)
    .some((value) =>
      String(value).toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    );
}
