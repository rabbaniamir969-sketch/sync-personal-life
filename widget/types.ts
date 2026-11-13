export type WidgetModuleId =
  | "tasks"
  | "calendar"
  | "finance"
  | "goals"
  | "reminders"
  | "habits"
  | "productivity"
  | "focus"
  | "notes"
  | "health";

export type WidgetSize = "small" | "medium" | "large";
export type WidgetModulePresentation = "compact" | "comfortable" | "expanded";
export type WidgetSectionStatus = "ready" | "empty" | "unavailable";

export type WidgetModuleConfiguration = {
  enabled: boolean;
  order: number;
  presentation: WidgetModulePresentation;
  priority: number;
  alwaysVisible: boolean;
  locked: boolean;
  itemLimit: number;
  fields: string[];
};

export type WidgetTaskPriorityOverride = {
  pinned: boolean;
  importance: 0 | 1 | 2 | 3;
  locked: boolean;
};

export type WidgetConfiguration = {
  version: 1;
  size: WidgetSize;
  smartPriorityEnabled: boolean;
  refreshMinutes: number;
  showSensitiveInfo: boolean;
  modules: Record<WidgetModuleId, WidgetModuleConfiguration>;
  taskPriorities: Record<string, WidgetTaskPriorityOverride>;
};

export type WidgetModuleDefinition = {
  id: WidgetModuleId;
  label: string;
  available: boolean;
  description: string;
  fields: readonly { id: string; label: string }[];
};

export type WidgetSection<Item, Summary = never> = {
  status: WidgetSectionStatus;
  count: number;
  items: Item[];
  summary?: Summary;
};

export type WidgetTaskItem = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  priority: "Rendah" | "Sedang" | "Tinggi";
  completedOn?: string;
};

export type WidgetAgendaItem = {
  id: string;
  title: string;
  date: string;
  type: "task" | "reminder";
};

export type WidgetFinanceSummary = {
  monthIncome: number;
  monthExpenses: number;
  monthlyBudget: number;
  balance: number;
  currency: "IDR";
};

export type WidgetGoalItem = {
  id: string;
  title: string;
  saved: number;
  target: number;
  progressPercent: number;
};

export type WidgetReminderItem = {
  id: string;
  title: string;
  date: string;
};

export type WidgetHabitItem = {
  id: string;
  title: string;
  doneToday: boolean;
};

export type WidgetProductivitySummary = {
  completedTasks: number;
  pendingTasks: number;
  completedHabits: number;
  totalHabits: number;
};

export type WidgetModulesSnapshot = {
  tasks: WidgetSection<WidgetTaskItem, { pendingCount: number }>;
  calendar: WidgetSection<WidgetAgendaItem>;
  finance: WidgetSection<WidgetFinanceSummary>;
  goals: WidgetSection<WidgetGoalItem>;
  reminders: WidgetSection<WidgetReminderItem>;
  habits: WidgetSection<WidgetHabitItem>;
  productivity: WidgetSection<WidgetProductivitySummary>;
  focus: WidgetSection<never>;
  notes: WidgetSection<never>;
  health: WidgetSection<never>;
};

export type WidgetSnapshot = {
  schemaVersion: 1;
  source: "sync-local-data";
  updatedAt: string;
  asOfDate: string;
  modules: WidgetModulesSnapshot;
};
