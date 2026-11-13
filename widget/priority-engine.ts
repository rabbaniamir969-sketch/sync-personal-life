import type { WidgetTaskItem, WidgetTaskPriorityOverride } from "./types";

export type PrioritizedWidgetTask = {
  task: WidgetTaskItem;
  score: number;
  reason: string;
  pinned: boolean;
  locked: boolean;
};

const priorityWeight: Record<WidgetTaskItem["priority"], number> = {
  Rendah: 0,
  Sedang: 20,
  Tinggi: 40
};

function daysUntil(deadline: string, today: string): number | undefined {
  if (!deadline) return undefined;
  const deadlineTime = Date.parse(`${deadline}T00:00:00Z`);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(deadlineTime) || !Number.isFinite(todayTime)) return undefined;
  return Math.round((deadlineTime - todayTime) / 86_400_000);
}

function scoreTask(
  task: WidgetTaskItem,
  override: WidgetTaskPriorityOverride | undefined,
  today: string
): { score: number; reason: string } {
  const manualImportance = override?.importance ?? 0;
  const deadlineDays = daysUntil(task.dueDate, today);
  let deadlineScore = 0;
  let deadlineReason = "Tidak ada tenggat dekat";

  if (deadlineDays !== undefined) {
    if (deadlineDays < 0) {
      deadlineScore = 100;
      deadlineReason = "Terlambat";
    } else if (deadlineDays === 0) {
      deadlineScore = 90;
      deadlineReason = "Tenggat hari ini";
    } else if (deadlineDays === 1) {
      deadlineScore = 65;
      deadlineReason = "Tenggat besok";
    } else if (deadlineDays <= 7) {
      deadlineScore = 35;
      deadlineReason = "Tenggat dalam 7 hari";
    } else {
      deadlineScore = 10;
      deadlineReason = "Tenggat masih lama";
    }
  }

  const score = deadlineScore + priorityWeight[task.priority] + manualImportance * 25
    + (override?.pinned ? 10_000 : 0);
  const reason = [
    override?.pinned ? "Disematkan manual" : "",
    manualImportance ? `Kepentingan manual ${manualImportance}/3` : "",
    deadlineReason,
    task.priority !== "Rendah" ? `Prioritas tugas ${task.priority.toLowerCase()}` : ""
  ].filter(Boolean).join(" · ");

  return { score, reason };
}

export function prioritizeWidgetTasks(
  tasks: readonly WidgetTaskItem[],
  overrides: Readonly<Record<string, WidgetTaskPriorityOverride>>,
  today: string,
  smartPriorityEnabled: boolean
): PrioritizedWidgetTask[] {
  const active = tasks.filter(task => !task.completed).map((task, originalIndex) => {
    const override = overrides[task.id];
    const evaluated = scoreTask(task, override, today);
    return {
      task,
      originalIndex,
      score: evaluated.score,
      reason: evaluated.reason,
      pinned: override?.pinned ?? false,
      locked: override?.locked ?? false
    };
  });

  const locked = active.filter(item => item.locked).sort((left, right) => left.originalIndex - right.originalIndex);
  const movable = active
    .filter(item => !item.locked)
    .sort((left, right) => {
      if (!smartPriorityEnabled) {
        return Number(right.pinned) - Number(left.pinned)
          || (overrides[right.task.id]?.importance ?? 0) - (overrides[left.task.id]?.importance ?? 0)
          || left.originalIndex - right.originalIndex;
      }
      return right.score - left.score
        || left.task.dueDate.localeCompare(right.task.dueDate)
        || left.originalIndex - right.originalIndex;
    });
  const lockedPositions = new Map(locked.map(item => [item.originalIndex, item]));
  const result: typeof active = [];
  let nextMovable = 0;
  for (let index = 0; index < active.length; index += 1) {
    result.push(lockedPositions.get(index) ?? movable[nextMovable++]);
  }

  return result.map(({ task, score, reason, pinned, locked: isLocked }) => ({
    task,
    score,
    reason: isLocked ? `${reason} · Posisi dikunci` : reason,
    pinned,
    locked: isLocked
  }));
}
