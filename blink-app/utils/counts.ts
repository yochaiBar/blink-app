/** "1 member", "6 members": a count with its noun in the right number. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * "4/6 responded": members who answered out of the group's members. Only
 * the people actually in `memberIds` count, the viewer included only once
 * they're a member who answered — so the total matches "6 members".
 */
export function respondedSummary(memberIds: string[], respondedIds: ReadonlySet<string>): string {
  const responded = memberIds.filter((id) => respondedIds.has(id)).length;
  return `${responded}/${memberIds.length} responded`;
}

/** "7-challenge streak": streaks count challenges answered in a row, not days. */
export function streakLabel(streak: number): string {
  return `${streak}-challenge streak`;
}
