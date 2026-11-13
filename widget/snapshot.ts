import type {
  WidgetAgendaItem,
  WidgetConfiguration,
  WidgetHabitItem,
  WidgetModulesSnapshot,
  WidgetSnapshot,
  WidgetTaskItem,
  WidgetSection
} from "./types";
import { WIDGET_MODULES } from "./catalog";

export type WidgetSourceData = {
  transactions: Array<{
    amount: number;
    type: "income" | "expense";
    date: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    date: string;
    done: boolean;
    priority: "Rendah" | "Sedang" | "Tinggi";
    completedOn?: string;
  }>;
  habits: Array<{
    id: string;
    title: string;
    done: boolean;
    completedOn?: string;
    completionDates?: string[];
  }>;
  goals: Array<{
    id: string;
    title: string;
    target: number;
    saved: number;
    status?: "active" | "achieved";
  }>;
  reminders: Array<{ id: string; title: string; date: string }>;
  accounts: Array<{ name: string; balance: number }>;
  budget: number;
};

export const DEFAULT_WIDGET_CONFIGURATION: WidgetConfiguration = {
  version: 1,
  size: "medium",
  smartPriorityEnabled: true,
  refreshMinutes: 30,
  showSensitiveInfo: false,
  taskPriorities: {},
  modules: Object.fromEntries(WIDGET_MODULES.map((module, order) => [
    module.id,
    {
      enabled: module.available,
      order,
      presentation: "comfortable",
      priority: 0,
      alwaysVisible: false,
      locked: false,
      itemLimit: 3,
      fields: module.fields.map(field => field.id)
    }
  ])) as WidgetConfiguration["modules"]
};

function section<Item>(items: Item[]): WidgetSection<Item> {
  return { status: items.length ? "ready" : "empty", count: items.length, items };
}

function unavailableSection<Item>(): WidgetSection<Item> {
  return { status: "unavailable", count: 0, items: [] };
}

function isHabitDoneToday(
  habit: WidgetSourceData["habits"][number],
  date: string
): boolean {
  return habit.completionDates?.includes(date)
    ?? (habit.completedOn ? habit.completedOn === date : habit.done);
}

export function createWidgetSnapshot(data: WidgetSourceData, now = new Date()): WidgetSnapshot {
  const asOfDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  const monthPrefix = asOfDate.slice(0, 7);
  const pendingTasks: WidgetTaskItem[] = data.tasks
    .filter(task => !task.done)
    .map(task => ({
      id: task.id,
      title: task.title,
      dueDate: task.date,
      completed: task.done,
      priority: task.priority,
      completedOn: task.completedOn
    }));
  const habits: WidgetHabitItem[] = data.habits.map(habit => ({
    id: habit.id,
    title: habit.title,
    doneToday: isHabitDoneToday(habit, asOfDate)
  }));
  const taskAgenda: WidgetAgendaItem[] = pendingTasks
    .filter(task => task.dueDate && task.dueDate >= asOfDate)
    .map(task => ({
      id: `task:${task.id}`,
      title: task.title,
      date: `${task.dueDate}T00:00:00`,
      type: "task"
    }));
  const reminderAgenda: WidgetAgendaItem[] = data.reminders
    .filter(reminder => Number.isFinite(Date.parse(reminder.date)) && Date.parse(reminder.date) >= now.getTime())
    .map<WidgetAgendaItem>(reminder => ({
      id: `reminder:${reminder.id}`,
      title: reminder.title,
      date: reminder.date,
      type: "reminder"
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const monthIncome = data.transactions
    .filter(transaction => transaction.type === "income" && transaction.date.startsWith(monthPrefix))
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthExpenses = data.transactions
    .filter(transaction => transaction.type === "expense" && transaction.date.startsWith(monthPrefix))
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const balance = data.accounts.reduce((sum, account) => sum + account.balance, 0)
    + data.transactions
      .filter(transaction => transaction.date <= asOfDate)
      .reduce((sum, transaction) => sum + (transaction.type === "income" ? transaction.amount : -transaction.amount), 0);
  const activeGoals = data.goals
    .filter(goal => goal.status !== "achieved")
    .map(goal => ({
      id: goal.id,
      title: goal.title,
      saved: goal.saved,
      target: goal.target,
      progressPercent: goal.target > 0 ? Math.min(100, Math.round(goal.saved / goal.target * 100)) : 0
    }));
  const allAgenda = [...taskAgenda, ...reminderAgenda]
    .sort((left, right) => left.date.localeCompare(right.date));
  const completedTasks = data.tasks.filter(task => task.done).length;
  const completedHabits = habits.filter(habit => habit.doneToday).length;

  const modules: WidgetModulesSnapshot = {
    tasks: {
      ...section(pendingTasks),
      summary: { pendingCount: pendingTasks.length }
    },
    calendar: section(allAgenda),
    finance: section([{
      monthIncome,
      monthExpenses,
      monthlyBudget: data.budget,
      balance,
      currency: "IDR"
    }]),
    goals: section(activeGoals),
    reminders: section(reminderAgenda.map(({ id, title, date }) => ({ id, title, date }))),
    habits: section(habits),
    productivity: section([{
      completedTasks,
      pendingTasks: pendingTasks.length,
      completedHabits,
      totalHabits: habits.length
    }]),
    focus: unavailableSection(),
    notes: unavailableSection(),
    health: unavailableSection()
  };

  return {
    schemaVersion: 1,
    source: "sync-local-data",
    updatedAt: now.toISOString(),
    asOfDate,
    modules
  };
}
