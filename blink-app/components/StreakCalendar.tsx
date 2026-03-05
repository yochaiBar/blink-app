import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing } from '@/constants/spacing';
import GlassCard from '@/components/ui/GlassCard';

interface StreakCalendarProps {
  totalSnaps: number;
  longestStreak: number;
  joinDate: string;
}

interface DayCell {
  date: Date;
  level: 0 | 1 | 2; // 0 = missed, 1 = partial, 2 = participated
}

const WEEKS = 12;
const DAYS_PER_WEEK = 7;
const CELL_SIZE = 14;
const CELL_GAP = 3;

const DAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'];

/**
 * Generate mock calendar data based on user stats.
 * When a real API is available, replace this with actual participation data.
 */
function generateMockData(totalSnaps: number, longestStreak: number, joinDate: string): DayCell[] {
  const today = new Date();
  const cells: DayCell[] = [];

  // Walk back 12 weeks from today (ending on the current day)
  // Align to Monday of the starting week
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (WEEKS * DAYS_PER_WEEK - 1));

  // Adjust startDate to the nearest Monday at or before
  const dayOfWeek = startDate.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startDate.setDate(startDate.getDate() + mondayOffset);

  const joinD = new Date(joinDate);

  // Use a seeded pseudo-random based on totalSnaps for consistency
  let seed = totalSnaps * 17 + longestStreak * 31;
  const pseudoRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 100) / 100;
  };

  // Participation probability increases with more snaps
  const baseProb = Math.min(0.7, 0.2 + (totalSnaps / 100) * 0.5);

  const current = new Date(startDate);
  while (current <= endDate) {
    const isFuture = current > today;
    const isBeforeJoin = current < joinD;

    let level: 0 | 1 | 2 = 0;
    if (!isFuture && !isBeforeJoin) {
      const rand = pseudoRandom();
      if (rand < baseProb) {
        level = 2; // full participation
      } else if (rand < baseProb + 0.15) {
        level = 1; // partial
      }
    }

    cells.push({ date: new Date(current), level });
    current.setDate(current.getDate() + 1);
  }

  return cells;
}

/**
 * Compute current streak from cells (consecutive level > 0 ending at today or yesterday).
 */
function computeCurrentStreak(cells: DayCell[]): number {
  let streak = 0;
  // Start from the end (most recent)
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].level > 0) {
      streak++;
    } else if (streak === 0) {
      // Allow skipping today if no data yet (it might be early in the day)
      continue;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Get month labels positioned above the calendar columns.
 */
function getMonthLabels(cells: DayCell[]): { label: string; col: number }[] {
  const labels: { label: string; col: number }[] = [];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let lastMonth = -1;

  for (let col = 0; col < Math.ceil(cells.length / DAYS_PER_WEEK); col++) {
    const cellIndex = col * DAYS_PER_WEEK;
    if (cellIndex < cells.length) {
      const month = cells[cellIndex].date.getMonth();
      if (month !== lastMonth) {
        labels.push({ label: months[month], col });
        lastMonth = month;
      }
    }
  }

  return labels;
}

function getCellColor(level: 0 | 1 | 2): string {
  switch (level) {
    case 2:
      return theme.coral;
    case 1:
      return theme.coralMuted;
    case 0:
    default:
      return theme.bgCardSolid;
  }
}

export default React.memo(function StreakCalendar({ totalSnaps, longestStreak, joinDate }: StreakCalendarProps) {
  const cells = useMemo(
    () => generateMockData(totalSnaps, longestStreak, joinDate),
    [totalSnaps, longestStreak, joinDate]
  );

  const currentStreak = useMemo(() => computeCurrentStreak(cells), [cells]);
  const monthLabels = useMemo(() => getMonthLabels(cells), [cells]);

  // Organize cells into columns (each column = 1 week)
  const totalCols = Math.ceil(cells.length / DAYS_PER_WEEK);

  const gridWidth = totalCols * (CELL_SIZE + CELL_GAP) - CELL_GAP;

  return (
    <GlassCard style={styles.card} padding={spacing.lg}>
      <View style={styles.headerRow}>
        <Text style={[typography.headlineMedium, { color: theme.text }]}>Activity</Text>
        <View style={styles.legendRow}>
          <Text style={[typography.bodySmall, { color: theme.textMuted, marginRight: spacing.xs }]}>Less</Text>
          <View style={[styles.legendCell, { backgroundColor: theme.bgCardSolid }]} />
          <View style={[styles.legendCell, { backgroundColor: theme.coralMuted }]} />
          <View style={[styles.legendCell, { backgroundColor: theme.coral }]} />
          <Text style={[typography.bodySmall, { color: theme.textMuted, marginLeft: spacing.xs }]}>More</Text>
        </View>
      </View>

      {/* Month labels */}
      <View style={[styles.monthLabelRow, { width: gridWidth + 20 }]}>
        <View style={{ width: 20 }} />
        {monthLabels.map((m, idx) => (
          <Text
            key={idx}
            style={[
              styles.monthLabel,
              {
                left: 20 + m.col * (CELL_SIZE + CELL_GAP),
                position: 'absolute',
              },
            ]}
          >
            {m.label}
          </Text>
        ))}
      </View>

      {/* Grid */}
      <View style={styles.gridContainer}>
        {/* Day labels on the left */}
        <View style={styles.dayLabels}>
          {DAY_LABELS.map((label, idx) => (
            <View key={idx} style={styles.dayLabelCell}>
              <Text style={styles.dayLabelText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid: rows = days of week, columns = weeks */}
        <View style={styles.grid}>
          {Array.from({ length: DAYS_PER_WEEK }).map((_, row) => (
            <View key={row} style={styles.gridRow}>
              {Array.from({ length: totalCols }).map((_, col) => {
                const cellIndex = col * DAYS_PER_WEEK + row;
                const cell = cellIndex < cells.length ? cells[cellIndex] : null;
                const today = new Date();
                const isToday =
                  cell &&
                  cell.date.getDate() === today.getDate() &&
                  cell.date.getMonth() === today.getMonth() &&
                  cell.date.getFullYear() === today.getFullYear();

                return (
                  <View
                    key={col}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: cell ? getCellColor(cell.level) : 'transparent',
                      },
                      isToday && styles.cellToday,
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* Current streak */}
      <View style={styles.streakRow}>
        <Text style={[typography.bodyMedium, { color: theme.textSecondary }]}>
          Current streak:{' '}
          <Text style={[typography.labelLarge, { color: theme.coral }]}>
            {currentStreak} {currentStreak === 1 ? 'day' : 'days'}
          </Text>
          {currentStreak >= 3 ? ' \uD83D\uDD25' : ''}
        </Text>
      </View>
    </GlassCard>
  );
});

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  monthLabelRow: {
    position: 'relative',
    height: 16,
    marginBottom: spacing.xs,
  },
  monthLabel: {
    ...typography.bodySmall,
    color: theme.textMuted,
    fontSize: 10,
  },
  gridContainer: {
    flexDirection: 'row',
  },
  dayLabels: {
    width: 20,
    marginRight: 2,
  },
  dayLabelCell: {
    height: CELL_SIZE,
    marginBottom: CELL_GAP,
    justifyContent: 'center',
  },
  dayLabelText: {
    fontSize: 9,
    color: theme.textMuted,
    fontWeight: '500',
  },
  grid: {
    flex: 1,
  },
  gridRow: {
    flexDirection: 'row',
    marginBottom: CELL_GAP,
    gap: CELL_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 3,
  },
  cellToday: {
    borderWidth: 1.5,
    borderColor: theme.text,
  },
  streakRow: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
});
