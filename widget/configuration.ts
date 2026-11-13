import { DEFAULT_WIDGET_CONFIGURATION } from "./snapshot";
import { WIDGET_MODULES, WIDGET_MODULE_IDS } from "./catalog";
import type {
  WidgetConfiguration,
  WidgetModuleConfiguration,
  WidgetModuleId,
  WidgetModulePresentation,
  WidgetSize,
  WidgetTaskPriorityOverride
} from "./types";

const presentations: readonly WidgetModulePresentation[] = ["compact", "comfortable", "expanded"];
const sizes: readonly WidgetSize[] = ["small", "medium", "large"];

function isTaskPriorityOverride(value: unknown): value is WidgetTaskPriorityOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const override = value as Record<string, unknown>;
  return typeof override.pinned === "boolean"
    && typeof override.importance === "number"
    && Number.isInteger(override.importance)
    && override.importance >= 0
    && override.importance <= 3
    && typeof override.locked === "boolean";
}

function isModuleConfiguration(value: unknown): value is WidgetModuleConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const module = value as Record<string, unknown>;
  return typeof module.enabled === "boolean"
    && typeof module.order === "number"
    && Number.isInteger(module.order)
    && module.order >= 0
    && presentations.includes(module.presentation as WidgetModulePresentation)
    && typeof module.priority === "number"
    && Number.isInteger(module.priority)
    && module.priority >= 0
    && module.priority <= 5
    && typeof module.alwaysVisible === "boolean"
    && typeof module.locked === "boolean"
    && typeof module.itemLimit === "number"
    && Number.isInteger(module.itemLimit)
    && module.itemLimit >= 1
    && module.itemLimit <= 10
    && Array.isArray(module.fields)
    && module.fields.every(field => typeof field === "string");
}

export function isValidWidgetConfiguration(value: unknown): value is WidgetConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const configuration = value as Record<string, unknown>;
  if (configuration.version !== 1
    || !sizes.includes(configuration.size as WidgetSize)
    || typeof configuration.smartPriorityEnabled !== "boolean"
    || typeof configuration.refreshMinutes !== "number"
    || ![15, 30, 60, 120].includes(configuration.refreshMinutes)
    || typeof configuration.showSensitiveInfo !== "boolean"
    || !configuration.modules
    || typeof configuration.modules !== "object"
    || Array.isArray(configuration.modules)
    || !configuration.taskPriorities
    || typeof configuration.taskPriorities !== "object"
    || Array.isArray(configuration.taskPriorities)) return false;

  const modules = configuration.modules as Record<string, unknown>;
  if (!WIDGET_MODULE_IDS.every(id => isModuleConfiguration(modules[id]))) return false;
  const taskPriorities = configuration.taskPriorities as Record<string, unknown>;
  return Object.values(taskPriorities).every(isTaskPriorityOverride);
}

export function normalizeWidgetConfiguration(value: unknown): WidgetConfiguration {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sourceModules = source.modules && typeof source.modules === "object" && !Array.isArray(source.modules)
    ? source.modules as Record<string, unknown>
    : {};
  const modules = Object.fromEntries(WIDGET_MODULES.map(definition => {
    const defaults = DEFAULT_WIDGET_CONFIGURATION.modules[definition.id];
    const candidate = sourceModules[definition.id];
    const stored: WidgetModuleConfiguration = isModuleConfiguration(candidate) ? candidate : defaults;
    const validFieldIds = new Set(definition.fields.map(field => field.id));
    return [definition.id, {
      ...defaults,
      ...stored,
      fields: stored.fields.filter(field => validFieldIds.has(field))
    }];
  })) as WidgetConfiguration["modules"];
  const sourcePriorities = source.taskPriorities && typeof source.taskPriorities === "object" && !Array.isArray(source.taskPriorities)
    ? source.taskPriorities as Record<string, unknown>
    : {};
  const taskPriorities = Object.fromEntries(
    Object.entries(sourcePriorities).filter((entry): entry is [string, WidgetTaskPriorityOverride] =>
      isTaskPriorityOverride(entry[1])
    )
  );

  return {
    ...DEFAULT_WIDGET_CONFIGURATION,
    ...source,
    version: 1,
    size: sizes.includes(source.size as WidgetSize)
      ? source.size as WidgetSize
      : DEFAULT_WIDGET_CONFIGURATION.size,
    refreshMinutes: [15, 30, 60, 120].includes(Number(source.refreshMinutes))
      ? Number(source.refreshMinutes)
      : DEFAULT_WIDGET_CONFIGURATION.refreshMinutes,
    smartPriorityEnabled: typeof source.smartPriorityEnabled === "boolean"
      ? source.smartPriorityEnabled
      : DEFAULT_WIDGET_CONFIGURATION.smartPriorityEnabled,
    showSensitiveInfo: typeof source.showSensitiveInfo === "boolean"
      ? source.showSensitiveInfo
      : DEFAULT_WIDGET_CONFIGURATION.showSensitiveInfo,
    modules,
    taskPriorities
  };
}

export function updateTaskPriority(
  current: Readonly<Record<string, WidgetTaskPriorityOverride>>,
  taskId: string,
  changes: Partial<WidgetTaskPriorityOverride>
): Record<string, WidgetTaskPriorityOverride> {
  const existing = current[taskId] ?? {
    pinned: false,
    importance: 0,
    locked: false
  };
  const updated = { ...existing, ...changes };
  const { pinned, importance, locked } = updated;
  if (!pinned && importance === 0 && !locked) {
    const { [taskId]: _removed, ...remaining } = current;
    return remaining;
  }
  return { ...current, [taskId]: updated };
}

export function isWidgetModuleId(value: string): value is WidgetModuleId {
  return (WIDGET_MODULE_IDS as readonly string[]).includes(value);
}
