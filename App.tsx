import { useEffect, useMemo, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createExcelWorkbook } from "./excel-export";
import "./App.css";
import "./Debt.css";
import "./Responsive.css";
import "./Settings.css";
import { DEFAULT_WIDGET_CONFIGURATION } from "./widget/snapshot";
import { normalizeWidgetConfiguration, isValidWidgetConfiguration } from "./widget/configuration";
import { prioritizeWidgetTasks } from "./widget/priority-engine";
import { WidgetCustomization } from "./widget/WidgetCustomization";
import { createWidgetSnapshot } from "./widget/snapshot";
import { syncWidgetToNative } from "./widget/bridge";

type Transaction = { id: string; title: string; amount: number; type: "income" | "expense"; category: string; date: string; account: string };
type Debt = { id: string; title: string; amount: number; type: "utang" | "piutang"; dueDate: string; status: "Belum lunas" | "Lunas" };
type Task = { id: string; title: string; date: string; done: boolean; priority: "Rendah" | "Sedang" | "Tinggi"; completedOn?: string };
type Habit = { id: string; title: string; done: boolean; completedOn?: string; completionDates?: string[] };
type Goal = { id: string; title: string; target: number; saved: number; status?: "active" | "achieved" };
type ProgressSnapshot = { date: string; assets: number; goalsSaved: number; goalsTarget: number; completedTasks: number; habitsCompleted: number; habitsTotal: number };
type Reminder = { id: string; title: string; date: string };
type NotificationCategory = "debt" | "budget" | "schedule" | "goal" | "habit" | "task";
type NotificationPriority = "Tinggi" | "Sedang" | "Rendah";
type AppNotification = { id: string; category: NotificationCategory; title: string; message: string; priority: NotificationPriority; createdAt: string; read: boolean };
type NotificationSettings = { pushEnabled: boolean; reminderTime: string; advanceDays: number; budgetThreshold: number };
type UserPreferences = { name: string; email: string; theme: "dark" | "light"; accent: keyof typeof ACCENTS; autoLockMinutes: number; lastBackupAt: string };
type PinCredential = { salt: string; verifier: string };

const STORAGE_KEY = "sync-personal-manager-v1";
const SECURITY_KEY = "sync-local-pin-v1";
const PIN_ITERATIONS = 210000;
const ACCENTS = { purple: "#9b82ff", blue: "#68a6ff", teal: "#48cfb5", rose: "#fa82a2", amber: "#f5b24e" } as const;
const defaultPreferences: UserPreferences = { name: "Pengguna SYNC", email: "", theme: "dark", accent: "purple", autoLockMinutes: 5, lastBackupAt: "" };
const localDateKey = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const initial = {
  transactions: [] as Transaction[],
  debts: [] as Debt[],
  tasks: [] as Task[],
  habits: [{ id: "h1", title: "Bangun pagi", done: false }, { id: "h2", title: "Membaca / belajar", done: false }, { id: "h3", title: "Bergerak atau olahraga", done: false }] as Habit[],
  goals: [{ id: "g1", title: "Tabungan pribadi", target: 5000000, saved: 750000, status: "active" }] as Goal[],
  reminders: [] as Reminder[],
  accounts: [{ name: "Dompet", balance: 0 }, { name: "Rekening", balance: 0 }],
  budget: 1500000,
  notifications: [] as AppNotification[],
  notificationSettings: { pushEnabled: false, reminderTime: "20:00", advanceDays: 1, budgetThreshold: 80 } as NotificationSettings,
  preferences: defaultPreferences,
  progressSnapshots: [] as ProgressSnapshot[],
  widgetConfiguration: DEFAULT_WIDGET_CONFIGURATION
};

type Data = typeof initial;
type DataLoadResult = { data: Data; error: string };
const money = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const uid = () => Math.random().toString(36).slice(2, 10);
const offsetDateKey = (date: Date, days: number) => { const result = new Date(date); result.setDate(result.getDate() + days); return localDateKey(result); };
const displayDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const getInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "S";

function readSecurity(): PinCredential | null {
  try {
    const raw = localStorage.getItem(SECURITY_KEY);
    if (!raw) return null;
    const credential = JSON.parse(raw);
    if (typeof credential?.salt === "string" && typeof credential?.verifier === "string") return credential;
  } catch {
    return null;
  }
  return null;
}

function normalizeGoals(goals: Goal[] | undefined): Goal[] {
  return (goals ?? initial.goals).map(goal => ({ ...goal, status: goal.status ?? "active" }));
}

function randomSalt(): Uint8Array {
  if (!globalThis.crypto?.subtle) throw new Error("PIN memerlukan browser modern atau koneksi HTTPS.");
  return crypto.getRandomValues(new Uint8Array(16));
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function derivePinVerifier(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new Error("PIN memerlukan browser modern atau koneksi HTTPS.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new ArrayBuffer(salt.length);
  new Uint8Array(saltBuffer).set(salt);
  const result = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBuffer, iterations: PIN_ITERATIONS, hash: "SHA-256" }, key, 256);
  return new Uint8Array(result);
}

async function verifyPin(pin: string, credential: PinCredential): Promise<boolean> {
  const actual = await derivePinVerifier(pin, decodeBase64(credential.salt));
  const expected = decodeBase64(credential.verifier);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  actual.forEach((value, index) => { difference |= value ^ expected[index]; });
  return difference === 0;
}

function readData(): DataLoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: initial, error: "" };
    const saved: unknown = JSON.parse(raw);
    if (!isValidDataSnapshot(saved)) {
      return { data: initial, error: "Data SYNC yang tersimpan tidak valid. Data asli dipertahankan dan belum ditimpa; pulihkan backup JSON yang valid sebelum melanjutkan." };
    }
    return {
      data: {
        ...initial,
        ...saved,
        habits: normalizeHabits(saved.habits, localDateKey(new Date())),
        goals: normalizeGoals(saved.goals),
        notifications: Array.isArray(saved.notifications) ? saved.notifications : [],
        notificationSettings: { ...initial.notificationSettings, ...saved.notificationSettings },
        preferences: { ...defaultPreferences, ...saved.preferences },
        progressSnapshots: Array.isArray(saved.progressSnapshots) ? saved.progressSnapshots : [],
        widgetConfiguration: normalizeWidgetConfiguration(saved.widgetConfiguration)
      },
      error: ""
    };
  } catch (error) {
    console.error("Data SYNC tidak dapat dibaca dari penyimpanan lokal.", error);
    return { data: initial, error: "Data SYNC tidak dapat dibaca. Data asli dipertahankan dan belum ditimpa; pulihkan backup JSON yang valid sebelum melanjutkan." };
  }
}

function normalizeHabits(habits: Habit[] | undefined, date: string): Habit[] {
  return (habits ?? initial.habits).map(habit => ({
    ...habit,
    completionDates: Array.isArray(habit.completionDates)
      ? [...new Set(habit.completionDates)]
      : habit.completedOn ? [habit.completedOn] : habit.done ? [date] : [],
    completedOn: habit.completedOn ?? (habit.done ? date : undefined)
  }));
}

function isHabitDoneToday(habit: Habit, date: string): boolean {
  return habit.completionDates?.includes(date) ?? (habit.completedOn ? habit.completedOn === date : habit.done);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasStringFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return isRecord(value) && fields.every(field => typeof value[field] === "string");
}

function isValidDataSnapshot(value: unknown): value is Partial<Data> {
  if (!isRecord(value) || !Array.isArray(value.transactions) || !Array.isArray(value.debts) || !Array.isArray(value.tasks) || typeof value.budget !== "number" || !Number.isFinite(value.budget)) return false;
  const optionalArrays = ["habits", "goals", "reminders", "accounts", "notifications", "progressSnapshots"] as const;
  if (optionalArrays.some(key => value[key] !== undefined && !Array.isArray(value[key]))) return false;
  if (!value.transactions.every(item => hasStringFields(item, ["id", "title", "category", "date", "account"]) && typeof item.amount === "number" && Number.isFinite(item.amount) && (item.type === "income" || item.type === "expense"))) return false;
  if (!value.debts.every(item => hasStringFields(item, ["id", "title", "dueDate"]) && typeof item.amount === "number" && Number.isFinite(item.amount) && (item.type === "utang" || item.type === "piutang") && (item.status === "Lunas" || item.status === "Belum lunas"))) return false;
  if (!value.tasks.every(item => hasStringFields(item, ["id", "title", "date"]) && typeof item.done === "boolean" && (item.priority === "Rendah" || item.priority === "Sedang" || item.priority === "Tinggi") && (item.completedOn === undefined || typeof item.completedOn === "string"))) return false;
  if (Array.isArray(value.habits) && !value.habits.every(item => hasStringFields(item, ["id", "title"]) && typeof item.done === "boolean" && (item.completedOn === undefined || typeof item.completedOn === "string") && (item.completionDates === undefined || (Array.isArray(item.completionDates) && item.completionDates.every(date => typeof date === "string"))))) return false;
  if (Array.isArray(value.goals) && !value.goals.every(item => hasStringFields(item, ["id", "title"]) && typeof item.target === "number" && Number.isFinite(item.target) && typeof item.saved === "number" && Number.isFinite(item.saved) && (item.status === undefined || item.status === "active" || item.status === "achieved"))) return false;
  if (Array.isArray(value.reminders) && !value.reminders.every(item => hasStringFields(item, ["id", "title", "date"]))) return false;
  if (Array.isArray(value.accounts) && !value.accounts.every(item => hasStringFields(item, ["name"]) && typeof item.balance === "number" && Number.isFinite(item.balance))) return false;
  if (Array.isArray(value.notifications) && !value.notifications.every(item => hasStringFields(item, ["id", "title", "message", "createdAt"]) && typeof item.read === "boolean" && ["debt", "budget", "schedule", "goal", "habit", "task"].includes(String(item.category)) && ["Tinggi", "Sedang", "Rendah"].includes(String(item.priority)))) return false;
  if (Array.isArray(value.progressSnapshots) && !value.progressSnapshots.every(item => hasStringFields(item, ["date"]) && ["assets", "goalsSaved", "goalsTarget", "completedTasks", "habitsCompleted", "habitsTotal"].every(key => typeof item[key] === "number" && Number.isFinite(item[key])))) return false;
  if (value.notificationSettings !== undefined) {
    const settings = value.notificationSettings;
    if (!isRecord(settings) || typeof settings.pushEnabled !== "boolean" || typeof settings.reminderTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.reminderTime) || typeof settings.advanceDays !== "number" || !Number.isInteger(settings.advanceDays) || settings.advanceDays < 0 || settings.advanceDays > 30 || typeof settings.budgetThreshold !== "number" || !Number.isInteger(settings.budgetThreshold) || settings.budgetThreshold < 1 || settings.budgetThreshold > 100) return false;
  }
  if (value.preferences !== undefined && (!isRecord(value.preferences) || typeof value.preferences.name !== "string" || typeof value.preferences.email !== "string" || !["dark", "light"].includes(String(value.preferences.theme)) || !(String(value.preferences.accent) in ACCENTS) || typeof value.preferences.autoLockMinutes !== "number" || ![0, 1, 5, 15, 30].includes(value.preferences.autoLockMinutes) || (value.preferences.lastBackupAt !== undefined && typeof value.preferences.lastBackupAt !== "string"))) return false;
  if (value.widgetConfiguration !== undefined && !isValidWidgetConfiguration(value.widgetConfiguration)) return false;
  return true;
}

type ReportPeriod = "weekly" | "monthly";
type ReportRange = { start: string; end: string; label: string };
type TrendPoint = { date: string; label: string; value: number };
type FlowPoint = { label: string; income: number; expense: number };

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00`);
  shifted.setDate(shifted.getDate() + days);
  return localDateKey(shifted);
}

function rangeDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

function getReportRanges(now: Date, period: ReportPeriod): { current: ReportRange; previous: ReportRange; compareLabel: string } {
  const currentDate = localDateKey(now);
  if (period === "weekly") {
    const weekdayOffset = (now.getDay() + 6) % 7;
    const start = shiftDate(currentDate, -weekdayOffset);
    const previousEnd = shiftDate(start, -1);
    return {
      current: { start, end: currentDate, label: "Pekan ini" },
      previous: { start: shiftDate(previousEnd, -6), end: previousEnd, label: "Pekan lalu" },
      compareLabel: "dibanding pekan lalu"
    };
  }

  const start = `${currentDate.slice(0, 7)}-01`;
  const daysElapsed = rangeDates(start, currentDate).length;
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousStart = `${localDateKey(previousMonth).slice(0, 7)}-01`;
  const previousMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const previousEnd = shiftDate(previousStart, Math.min(daysElapsed, previousMonthLastDay) - 1);
  return {
    current: { start, end: currentDate, label: "Bulan ini" },
    previous: { start: previousStart, end: previousEnd, label: "Bulan sebelumnya" },
    compareLabel: "dibanding periode yang sama bulan lalu"
  };
}

function sumWithin(transactions: Transaction[], range: ReportRange, type: Transaction["type"]): number {
  return transactions
    .filter(transaction => transaction.type === type && transaction.date >= range.start && transaction.date <= range.end)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function buildFlowPoints(transactions: Transaction[], range: ReportRange, period: ReportPeriod): FlowPoint[] {
  const dates = rangeDates(range.start, range.end);
  const buckets = period === "weekly"
    ? dates.map(date => ({ label: new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short" }), start: date, end: date }))
    : Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) => {
      const start = shiftDate(range.start, index * 7);
      return { label: `Minggu ${index + 1}`, start, end: shiftDate(start, Math.min(index * 7 + 6, dates.length - 1) - index * 7) };
    });

  return buckets.map(bucket => ({
    label: bucket.label,
    income: sumWithin(transactions, { start: bucket.start, end: bucket.end, label: bucket.label }, "income"),
    expense: sumWithin(transactions, { start: bucket.start, end: bucket.end, label: bucket.label }, "expense")
  }));
}

function currentAssetValue(data: Data, throughDate: string): number {
  const openingBalances = data.accounts.reduce((sum, account) => sum + account.balance, 0);
  const transactionChange = data.transactions
    .filter(transaction => transaction.date <= throughDate)
    .reduce((sum, transaction) => sum + (transaction.type === "income" ? transaction.amount : -transaction.amount), 0);
  return openingBalances + transactionChange;
}

function currentAccountBalance(data: Data, accountName: string, throughDate: string): number {
  const openingBalance = data.accounts.find(account => account.name === accountName)?.balance ?? 0;
  const transactionChange = data.transactions
    .filter(transaction => transaction.account === accountName && transaction.date <= throughDate)
    .reduce((sum, transaction) => sum + (transaction.type === "income" ? transaction.amount : -transaction.amount), 0);
  return openingBalance + transactionChange;
}

function buildAssetPoints(data: Data, range: ReportRange, period: ReportPeriod): TrendPoint[] {
  const dates = rangeDates(range.start, range.end);
  const buckets = period === "weekly"
    ? dates.map(date => date)
    : Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) => shiftDate(range.start, Math.min(index * 7 + 6, dates.length - 1)));
  return buckets.map((date, index) => ({
    date,
    label: period === "weekly"
      ? new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short" })
      : `Minggu ${index + 1}`,
    value: currentAssetValue(data, date)
  }));
}

function snapshotGoalPoints(snapshots: ProgressSnapshot[], range: ReportRange, period: ReportPeriod): TrendPoint[] {
  const points = snapshots.filter(snapshot => snapshot.date >= range.start && snapshot.date <= range.end).sort((a, b) => a.date.localeCompare(b.date));
  const sampled = period === "weekly"
    ? points
    : points.filter((snapshot, index) => index === points.length - 1 || snapshot.date.slice(8, 10) === "01" || snapshot.date.slice(8, 10) === "08" || snapshot.date.slice(8, 10) === "15" || snapshot.date.slice(8, 10) === "22" || snapshot.date.slice(8, 10) === "29");
  return sampled.map(snapshot => ({
    date: snapshot.date,
    label: new Date(`${snapshot.date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    value: snapshot.goalsTarget > 0 ? Math.min(100, snapshot.goalsSaved / snapshot.goalsTarget * 100) : 0
  }));
}

function percentageChange(current: number, previous: number): string {
  if (!previous) return current ? "Baru pada periode ini" : "Tidak ada perubahan";
  const change = (current - previous) / Math.abs(previous) * 100;
  return `${change > 0 ? "+" : ""}${Math.round(change)}% dari periode lalu`;
}

function ProgressReport({ data, now, period, onPeriodChange }: { data: Data; now: Date; period: ReportPeriod; onPeriodChange: (period: ReportPeriod) => void }) {
  const currentDate = localDateKey(now);
  const { current, previous, compareLabel } = getReportRanges(now, period);
  const currentIncome = sumWithin(data.transactions, current, "income");
  const currentExpense = sumWithin(data.transactions, current, "expense");
  const previousIncome = sumWithin(data.transactions, previous, "income");
  const previousExpense = sumWithin(data.transactions, previous, "expense");
  const countTasks = (range: ReportRange) => data.tasks.filter(task => task.completedOn && task.completedOn >= range.start && task.completedOn <= range.end).length;
  const countHabits = (range: ReportRange) => data.habits.reduce((sum, habit) => sum + (habit.completionDates ?? []).filter(date => date >= range.start && date <= range.end).length, 0);
  const currentTaskCount = countTasks(current);
  const previousTaskCount = countTasks(previous);
  const currentHabitCount = countHabits(current);
  const previousHabitCount = countHabits(previous);
  const daysInRange = (range: ReportRange) => rangeDates(range.start, range.end).length;
  const habitRate = (count: number, range: ReportRange) => data.habits.length ? Math.min(100, Math.round(count / (data.habits.length * daysInRange(range)) * 100)) : 0;
  const currentHabitRate = habitRate(currentHabitCount, current);
  const previousHabitRate = habitRate(previousHabitCount, previous);
  const currentSnapshot = data.progressSnapshots.filter(snapshot => snapshot.date >= current.start && snapshot.date <= current.end).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const previousSnapshot = data.progressSnapshots.filter(snapshot => snapshot.date >= previous.start && snapshot.date <= previous.end).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const activeGoals = data.goals.filter(goal => goal.status !== "achieved");
  const liveGoalsTarget = activeGoals.reduce((sum, goal) => sum + goal.target, 0);
  const liveGoalsSaved = activeGoals.reduce((sum, goal) => sum + goal.saved, 0);
  const currentGoalRate = currentSnapshot
    ? currentSnapshot.goalsTarget > 0 ? Math.round(currentSnapshot.goalsSaved / currentSnapshot.goalsTarget * 100) : 0
    : liveGoalsTarget > 0 ? Math.round(liveGoalsSaved / liveGoalsTarget * 100) : 0;
  const previousGoalRate = previousSnapshot && previousSnapshot.goalsTarget > 0 ? Math.round(previousSnapshot.goalsSaved / previousSnapshot.goalsTarget * 100) : 0;
  const currentAssets = currentAssetValue(data, current.end);
  const previousAssets = currentAssetValue(data, previous.end);
  const flows = buildFlowPoints(data.transactions, current, period);
  const assets = buildAssetPoints(data, current, period);
  const recordedGoalPoints = snapshotGoalPoints(data.progressSnapshots, current, period);
  const goals = recordedGoalPoints.length
    ? recordedGoalPoints
    : liveGoalsTarget > 0 ? [{ date: currentDate, label: "Hari ini", value: currentGoalRate }] : [];
  const formatRange = (range: ReportRange) => `${displayDate(range.start)} – ${displayDate(range.end)}`;

  return <section className="content report-page">
    <div className="section-actions report-heading">
      <div><h2>Perkembangan hidupmu</h2><p>Ringkasan dari data yang tercatat di SYNC.</p></div>
      <div className="report-period-toggle" role="group" aria-label="Pilih periode laporan">
        <button type="button" className={period === "weekly" ? "active" : ""} aria-pressed={period === "weekly"} onClick={() => onPeriodChange("weekly")}>Mingguan</button>
        <button type="button" className={period === "monthly" ? "active" : ""} aria-pressed={period === "monthly"} onClick={() => onPeriodChange("monthly")}>Bulanan</button>
      </div>
    </div>
    <div className="report-period-caption"><b>{current.label}</b><span>{formatRange(current)} · {compareLabel}</span></div>
    <div className="stats-grid three report-stats">
      <ReportStat label="Pemasukan" value={money(currentIncome)} comparison={percentageChange(currentIncome, previousIncome)} icon="↗"/>
      <ReportStat label="Pengeluaran" value={money(currentExpense)} comparison={percentageChange(currentExpense, previousExpense)} icon="↘"/>
      <ReportStat label="Tugas selesai" value={String(currentTaskCount)} comparison={percentageChange(currentTaskCount, previousTaskCount)} icon="✓"/>
      <ReportStat label="Keberhasilan habit" value={`${currentHabitRate}%`} comparison={`${currentHabitRate - previousHabitRate > 0 ? "+" : ""}${currentHabitRate - previousHabitRate} poin ${compareLabel}`} icon="✳"/>
      <ReportStat label="Progres target" value={`${currentGoalRate}%`} comparison={previousSnapshot ? `${currentGoalRate - previousGoalRate > 0 ? "+" : ""}${currentGoalRate - previousGoalRate} poin ${compareLabel}` : "Riwayat periode sebelumnya belum tersedia"} icon="◎"/>
      <ReportStat label="Aset tercatat" value={money(currentAssets)} comparison={percentageChange(currentAssets, previousAssets)} icon="◈"/>
    </div>
    <div className="report-chart-grid">
      <div className="panel report-chart-panel">
        <div className="panel-head"><div><h3>Arus kas</h3><p>Pemasukan dan pengeluaran berdasarkan transaksi {period === "weekly" ? "harian" : "mingguan"}.</p></div></div>
        <FlowChart points={flows}/>
        {!data.transactions.some(transaction => transaction.date >= current.start && transaction.date <= current.end) && <p className="report-footnote">Belum ada transaksi pada periode ini; grafik menampilkan nilai nol.</p>}
      </div>
      <div className="panel report-chart-panel">
        <div className="panel-head"><div><h3>Perkembangan aset</h3><p>Perkiraan saldo dari transaksi dan saldo awal akun.</p></div></div>
        {assets.length ? <TrendChart points={assets} color="var(--sync-accent)" format={value => money(value)} ariaLabel="Grafik perkembangan aset"/> : <Empty text="Belum ada data aset."/>}
      </div>
      <div className="panel report-chart-panel">
        <div className="panel-head"><div><h3>Perkembangan target</h3><p>Progres gabungan target yang terekam di akhir hari.</p></div></div>
        {goals.length ? <><TrendChart points={goals} color="#48cfb5" format={value => `${Math.round(value)}%`} ariaLabel="Grafik progres target tabungan"/>{recordedGoalPoints.length === 0 && <p className="report-footnote">Menampilkan progres target saat ini. Riwayat grafik dimulai hari ini; data sebelumnya tidak direka ulang.</p>}</> : <Empty text="Buat target tabungan untuk melihat grafik progresnya."/>}
      </div>
      <div className="panel report-chart-panel report-notes">
        <div className="panel-head"><div><h3>Produktivitas & kebiasaan</h3><p>{current.label} dibanding {previous.label.toLowerCase()}.</p></div></div>
        <div className="report-detail-row"><span>Tugas yang diselesaikan</span><b>{currentTaskCount}</b></div>
        <div className="report-detail-row"><span>Habit dituntaskan</span><b>{currentHabitCount}</b></div>
        <div className="report-detail-row"><span>Rata-rata keberhasilan habit</span><b>{currentHabitRate}%</b></div>
        <div className="report-detail-row"><span>Target aktif</span><b>{data.goals.length}</b></div>
        <p className="report-footnote">Perbandingan produktivitas dan habit memakai tanggal penyelesaian yang tercatat. Riwayat sebelum fitur laporan tersedia tidak dibuat-buat.</p>
      </div>
    </div>
    <p className="report-footnote report-disclaimer">Nilai aset memperkirakan saldo awal dompet/rekening ditambah transaksi sampai tanggal laporan. Untuk hasil yang tepat, saldo akun harus dimasukkan sebagai saldo awal. Riwayat target dimulai sejak laporan merekam snapshot.</p>
  </section>;
}

function ReportStat({ label, value, comparison, icon }: { label: string; value: string; comparison: string; icon: string }) {
  return <div className="stat-card report-stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{comparison}</small></div>;
}

function FlowChart({ points }: { points: FlowPoint[] }) {
  const max = Math.max(1, ...points.flatMap(point => [point.income, point.expense]));
  const width = 640;
  const height = 220;
  const chartTop = 16;
  const chartHeight = 154;
  const groupWidth = width / points.length;
  const barWidth = Math.min(20, groupWidth * 0.28);
  return <div className="report-chart-scroll"><svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik pemasukan dan pengeluaran">
    {[0, 1, 2, 3].map(step => <line key={step} x1="0" x2={width} y1={chartTop + chartHeight * step / 3} y2={chartTop + chartHeight * step / 3} className="chart-grid-line"/>)}
    {points.map((point, index) => {
      const center = groupWidth * (index + 0.5);
      const incomeHeight = point.income / max * chartHeight;
      const expenseHeight = point.expense / max * chartHeight;
      return <g key={`${point.label}-${index}`}>
        <rect x={center - barWidth - 2} y={chartTop + chartHeight - incomeHeight} width={barWidth} height={incomeHeight} rx="4" className="chart-income-bar"><title>{point.label}: pemasukan {money(point.income)}</title></rect>
        <rect x={center + 2} y={chartTop + chartHeight - expenseHeight} width={barWidth} height={expenseHeight} rx="4" className="chart-expense-bar"><title>{point.label}: pengeluaran {money(point.expense)}</title></rect>
        <text x={center} y="194" textAnchor="middle" className="chart-axis-label">{point.label}</text>
      </g>;
    })}
  </svg><div className="chart-legend"><span><i className="legend-income"/>Pemasukan</span><span><i className="legend-expense"/>Pengeluaran</span></div></div>;
}

function TrendChart({ points, color, format, ariaLabel }: { points: TrendPoint[]; color: string; format: (value: number) => string; ariaLabel: string }) {
  const width = 640;
  const height = 220;
  const padding = { top: 20, right: 12, bottom: 42, left: 12 };
  const values = points.map(point => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (index: number) => padding.left + (points.length <= 1 ? (width - padding.left - padding.right) / 2 : index * (width - padding.left - padding.right) / (points.length - 1));
  const y = (value: number) => padding.top + (max === min ? 0 : (max - value) * (height - padding.top - padding.bottom) / (max - min));
  const path = points.map((point, index) => `${index ? "L" : "M"} ${x(index)} ${y(point.value)}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  return <div className="report-chart-scroll"><svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
    {[0, 1, 2, 3].map(step => <line key={step} x1="0" x2={width} y1={padding.top + (height - padding.top - padding.bottom) * step / 3} y2={padding.top + (height - padding.top - padding.bottom) * step / 3} className="chart-grid-line"/>)}
    <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    {points.map((point, index) => <g key={point.date}>
      <circle cx={x(index)} cy={y(point.value)} r="4" fill={color}><title>{point.label}: {format(point.value)}</title></circle>
      {(index % labelStep === 0 || index === points.length - 1) && <text x={x(index)} y="198" textAnchor="middle" className="chart-axis-label">{point.label}</text>}
    </g>)}
  </svg><div className="chart-current-value">{points.length ? format(points[points.length - 1].value) : ""}</div></div>;
}

function buildNotifications(data: Data, now: Date): AppNotification[] {
  const date = localDateKey(now);
  const month = date.slice(0, 7);
  const settings = data.notificationSettings;
  const leadDays = Math.min(30, Math.max(0, settings.advanceDays));
  const lastReminderDate = offsetDateKey(now, leadDays);
  const createdAt = now.toISOString();
  const notifications: AppNotification[] = [];
  const add = (id: string, category: NotificationCategory, title: string, message: string, priority: NotificationPriority) => {
    notifications.push({ id, category, title, message, priority, createdAt, read: false });
  };
  const dueDescription = (dueDate: string) => dueDate < date
    ? `Terlambat sejak ${displayDate(dueDate)}.`
    : dueDate === date ? "Jatuh tempo hari ini." : `Jatuh tempo ${displayDate(dueDate)}.`;

  for (const debt of data.debts) {
    if (debt.status === "Lunas" || !debt.dueDate || debt.dueDate > lastReminderDate) continue;
    const typeLabel = debt.type === "utang" ? "Tagihan utang" : "Piutang";
    add(`debt:${debt.id}:${debt.dueDate}`, "debt", `${typeLabel} akan jatuh tempo`, `${debt.title} — ${money(debt.amount)}. ${dueDescription(debt.dueDate)}`, debt.dueDate <= date ? "Tinggi" : "Sedang");
  }

  const monthExpenses = data.transactions
    .filter(transaction => transaction.type === "expense" && transaction.date.slice(0, 7) === month)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  if (data.budget > 0 && monthExpenses >= data.budget * settings.budgetThreshold / 100) {
    const exceeded = monthExpenses >= data.budget;
    add(`budget:${month}:${settings.budgetThreshold}`, "budget", exceeded ? "Anggaran sudah tercapai" : "Anggaran hampir habis", `Pengeluaran bulan ini ${money(monthExpenses)} dari anggaran ${money(data.budget)} (${Math.round(monthExpenses / data.budget * 100)}%).`, exceeded ? "Tinggi" : "Sedang");
  }

  for (const reminder of data.reminders) {
    const startsAt = new Date(reminder.date);
    if (!reminder.date || Number.isNaN(startsAt.getTime()) || startsAt <= now || localDateKey(startsAt) > lastReminderDate) continue;
    const remaining = startsAt.getTime() - now.getTime();
    const startsLabel = startsAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    add(`schedule:${reminder.id}`, "schedule", "Jadwal akan dimulai", `${reminder.title} — ${startsLabel}.`, remaining <= 60 * 60 * 1000 ? "Tinggi" : remaining <= 24 * 60 * 60 * 1000 ? "Sedang" : "Rendah");
  }

  for (const task of data.tasks) {
    if (task.done || !task.date || task.date > lastReminderDate) continue;
    const isOverdue = task.date < date;
    const isToday = task.date === date;
    const dueLabel = isOverdue ? `Tenggat lewat pada ${displayDate(task.date)}.` : isToday ? "Tenggatnya hari ini." : `Tenggat ${displayDate(task.date)}.`;
    const priority = isOverdue || isToday || task.priority === "Tinggi" ? "Tinggi" : task.priority === "Sedang" ? "Sedang" : "Rendah";
    add(`task:${task.id}:${task.date}`, "task", "Tugas mendekati tenggat", `${task.title} — ${dueLabel}`, priority);
  }

  const time = now.toTimeString().slice(0, 5);
  if (time >= settings.reminderTime) {
    const unfinishedHabits = data.habits.filter(habit => !isHabitDoneToday(habit, date));
    if (unfinishedHabits.length) {
      add(`habit:${date}`, "habit", "Habit belum diselesaikan", `${unfinishedHabits.length} kebiasaan masih menunggu: ${unfinishedHabits.slice(0, 3).map(habit => habit.title).join(", ")}${unfinishedHabits.length > 3 ? ", dan lainnya" : ""}.`, "Sedang");
    }
    const unfinishedGoals = data.goals.filter(goal => goal.status !== "achieved" && goal.saved < goal.target);
    if (unfinishedGoals.length) {
      add(`goal:${date}`, "goal", "Target tabungan belum tercapai", `${unfinishedGoals.length} target masih berjalan. Target terdekat: ${unfinishedGoals[0].title} (${money(unfinishedGoals[0].saved)} dari ${money(unfinishedGoals[0].target)}).`, "Rendah");
    }
  }

  return notifications;
}

export default function App() {
  const [initialData] = useState(readData);
  const [data, setData] = useState<Data>(initialData.data);
  const [storageError, setStorageError] = useState(initialData.error);
  const [pinCredential, setPinCredential] = useState<PinCredential | null>(readSecurity);
  const [isLocked, setIsLocked] = useState(() => Boolean(readSecurity()));
  const [lockError, setLockError] = useState("");
  const [failedUnlockAttempts, setFailedUnlockAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [importError, setImportError] = useState("");
  const [widgetSyncError, setWidgetSyncError] = useState("");
  const [page, setPage] = useState("Dashboard");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("weekly");
  const [now, setNow] = useState(() => new Date());
  const [sessionStartedAt] = useState(() => new Date());
  const [showTransaction, setShowTransaction] = useState(false);
  const [showDebt, setShowDebt] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [goalContributionId, setGoalContributionId] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", text: "Halo! Saya SYNC Assistant. Ceritakan aktivitas atau pengeluaranmu, saya bantu membuat ringkasan dan memberi saran." }]);
  const importRef = useRef<HTMLInputElement>(null);
  const skipNextDataSave = useRef(false);
  const preserveStoredData = useRef(Boolean(initialData.error));
  const storageWriteSucceeded = useRef(false);

  useEffect(() => {
    const accent = ACCENTS[data.preferences.accent] ?? ACCENTS.purple;
    document.documentElement.dataset.theme = data.preferences.theme;
    document.documentElement.style.setProperty("--sync-accent", accent);
    document.documentElement.style.setProperty("--sync-accent-soft", `${accent}22`);
    document.documentElement.style.setProperty("--sync-accent-border", `${accent}70`);
  }, [data.preferences.accent, data.preferences.theme]);

  useEffect(() => {
    const autoLockMinutes = data.preferences.autoLockMinutes;
    if (!pinCredential || !autoLockMinutes || isLocked) return;
    let timeoutId = 0;
    const resetIdleTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setIsLocked(true), autoLockMinutes * 60_000);
    };
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    activityEvents.forEach(eventName => window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    resetIdleTimer();
    return () => {
      window.clearTimeout(timeoutId);
      activityEvents.forEach(eventName => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, [pinCredential, data.preferences.autoLockMinutes, isLocked]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (skipNextDataSave.current) {
      skipNextDataSave.current = false;
      storageWriteSucceeded.current = true;
      return;
    }
    if (preserveStoredData.current) {
      storageWriteSucceeded.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageWriteSucceeded.current = true;
      setStorageError("");
    } catch (error) {
      storageWriteSucceeded.current = false;
      console.error("Perubahan SYNC tidak dapat disimpan ke penyimpanan lokal.", error);
      setStorageError("Perubahan belum tersimpan di browser. Ekspor backup dan periksa ruang penyimpanan/perizinan browser.");
    }
  }, [data]);

  useEffect(() => {
    const generated = buildNotifications(data, now);
    const existingIds = new Set(data.notifications.map(notification => notification.id));
    const fresh = generated.filter(notification => !existingIds.has(notification.id));
    if (!fresh.length) return;

    setData(current => {
      const currentIds = new Set(current.notifications.map(notification => notification.id));
      const additions = fresh.filter(notification => !currentIds.has(notification.id));
      return additions.length
        ? { ...current, notifications: [...additions, ...current.notifications].slice(0, 100) }
        : current;
    });

    if (data.notificationSettings.pushEnabled && "Notification" in window && Notification.permission === "granted") {
      fresh.forEach(notification => {
        try {
          new Notification(notification.title, { body: notification.message, tag: notification.id });
        } catch (error) {
          console.error("Notifikasi browser tidak dapat ditampilkan.", error);
        }
      });
    }
  }, [data, now]);

  const currentDate = localDateKey(now);
  useEffect(() => {
    let active = true;
    if (!Capacitor.isNativePlatform()) {
      setWidgetSyncError("");
      return () => { active = false; };
    }
    if (storageError || preserveStoredData.current || !storageWriteSucceeded.current) {
      setWidgetSyncError("Data SYNC belum tersimpan dengan aman; widget belum diperbarui.");
      return () => { active = false; };
    }

    const snapshot = createWidgetSnapshot(data, now);
    syncWidgetToNative(snapshot, data.widgetConfiguration)
      .then(result => {
        if (active && result) setWidgetSyncError("");
      })
      .catch(error => {
        console.error("Snapshot widget SYNC tidak dapat diperbarui.", error);
        if (active) setWidgetSyncError("Widget belum tersinkron. Buka kembali aplikasi untuk mencoba lagi.");
      });

    return () => { active = false; };
  }, [data, currentDate, storageError]);

  useEffect(() => {
    let active = true;
    let listener: import("@capacitor/core").PluginListenerHandle | undefined;
    const openFromWidget = (url: string) => {
      let destination: URL;
      try {
        destination = new URL(url);
      } catch (error) {
        console.error("Deep link dari widget tidak valid.", error);
        return;
      }

      if (destination.protocol !== "sync:") return;
      if (destination.hostname === "tasks" && destination.pathname === "/new") {
        setPage("Aktivitas");
        setShowTask(true);
      } else if (destination.hostname === "calendar" || destination.hostname === "reminders") {
        setPage("Kalender");
        if (destination.hostname === "reminders" && destination.pathname === "/new") setShowReminder(true);
      } else if (destination.hostname === "finance") {
        setPage("Keuangan");
        if (destination.pathname === "/new") setShowTransaction(true);
      } else if (destination.hostname === "tasks") {
        setPage("Aktivitas");
      }
    };

    NativeApp.addListener("appUrlOpen", event => openFromWidget(event.url))
      .then(handle => {
        if (active) listener = handle;
        else void handle.remove();
      })
      .catch(error => console.error("Listener aksi widget tidak dapat dipasang.", error));
    if (Capacitor.isNativePlatform()) {
      NativeApp.getLaunchUrl()
        .then(result => { if (result?.url) openFromWidget(result.url); })
        .catch(error => console.error("Deep link awal dari widget tidak dapat dibaca.", error));
    }
    return () => {
      active = false;
      void listener?.remove();
    };
  }, []);

  useEffect(() => {
    const snapshot: ProgressSnapshot = {
      date: currentDate,
      assets: currentAssetValue(data, currentDate),
      goalsSaved: data.goals.filter(goal => goal.status !== "achieved").reduce((sum, goal) => sum + goal.saved, 0),
      goalsTarget: data.goals.filter(goal => goal.status !== "achieved").reduce((sum, goal) => sum + goal.target, 0),
      completedTasks: data.tasks.filter(task => task.done).length,
      habitsCompleted: data.habits.filter(habit => isHabitDoneToday(habit, currentDate)).length,
      habitsTotal: data.habits.length
    };
    const existing = data.progressSnapshots.find(item => item.date === currentDate);
    if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) return;
    setData(current => ({
      ...current,
      progressSnapshots: [...current.progressSnapshots.filter(item => item.date !== currentDate), snapshot]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-400)
    }));
  }, [data, currentDate]);

  const income = useMemo(() => data.transactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0), [data.transactions]);
  const expense = useMemo(() => data.transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0), [data.transactions]);
  const netFlow = income - expense;
  const balance = currentAssetValue(data, currentDate);
  const monthExpense = data.transactions.filter(t => t.type === "expense" && t.date.slice(0, 7) === currentDate.slice(0, 7)).reduce((s, t) => s + t.amount, 0);
  const completedTasks = data.tasks.filter(t => t.done).length;
  const pendingTasks = data.tasks.filter(t => !t.done).length;
  const prioritizedTaskList = prioritizeWidgetTasks(
    data.tasks.map(task => ({
      id: task.id,
      title: task.title,
      dueDate: task.date,
      completed: task.done,
      priority: task.priority,
      completedOn: task.completedOn
    })),
    data.widgetConfiguration.taskPriorities,
    currentDate,
    data.widgetConfiguration.smartPriorityEnabled
  );
  const outstandingDebts = data.debts.filter(debt => debt.status !== "Lunas");
  const unpaidOwed = outstandingDebts.filter(debt => debt.type === "utang").reduce((sum, debt) => sum + debt.amount, 0);
  const unpaidReceivable = outstandingDebts.filter(debt => debt.type === "piutang").reduce((sum, debt) => sum + debt.amount, 0);
  const unreadNotifications = data.notifications.filter(notification => !notification.read).length;
  const dashboardAgenda = [
    ...data.tasks.filter(task => !task.done && task.date >= currentDate).map(task => ({ id: `task:${task.id}`, title: task.title, date: `${task.date}T00:00`, label: "Tugas" })),
    ...data.reminders.filter(reminder => reminder.date && new Date(reminder.date) >= now).map(reminder => ({ id: `reminder:${reminder.id}`, title: reminder.title, date: reminder.date, label: "Pengingat" }))
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const contributionGoal = data.goals.find(goal => goal.id === goalContributionId);

  function exportData() {
    const backup = { format: "sync-backup", version: 2, exportedAt: new Date().toISOString(), data: { ...data, preferences: { ...data.preferences, lastBackupAt: new Date().toISOString() } } };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SYNC-backup-${currentDate}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setData(current => ({ ...current, preferences: { ...current.preferences, lastBackupAt: backup.exportedAt } }));
  }
  function exportExcel() {
    const sheets = [
      { name: "Transaksi", headers: ["ID", "Judul", "Jumlah", "Jenis", "Kategori", "Tanggal", "Akun"], rows: data.transactions.map(item => [item.id, item.title, item.amount, item.type, item.category, item.date, item.account]) },
      { name: "Utang Piutang", headers: ["ID", "Judul", "Jumlah", "Jenis", "Jatuh Tempo", "Status"], rows: data.debts.map(item => [item.id, item.title, item.amount, item.type, item.dueDate, item.status]) },
      { name: "Tugas", headers: ["ID", "Judul", "Tanggal", "Selesai", "Prioritas", "Selesai Pada"], rows: data.tasks.map(item => [item.id, item.title, item.date, item.done, item.priority, item.completedOn]) },
      { name: "Kebiasaan", headers: ["ID", "Judul", "Selesai", "Selesai Pada", "Tanggal Selesai"], rows: data.habits.map(item => [item.id, item.title, item.done, item.completedOn, item.completionDates?.join(", ")]) },
      { name: "Target", headers: ["ID", "Judul", "Target", "Terkumpul", "Status"], rows: data.goals.map(item => [item.id, item.title, item.target, item.saved, item.status]) },
      { name: "Pengingat", headers: ["ID", "Judul", "Tanggal"], rows: data.reminders.map(item => [item.id, item.title, item.date]) },
      { name: "Akun", headers: ["Nama", "Saldo"], rows: data.accounts.map(item => [item.name, item.balance]) },
      { name: "Anggaran", headers: ["Anggaran Bulanan"], rows: [[data.budget]] },
      { name: "Notifikasi", headers: ["ID", "Kategori", "Judul", "Pesan", "Prioritas", "Dibuat Pada", "Sudah Dibaca"], rows: data.notifications.map(item => [item.id, item.category, item.title, item.message, item.priority, item.createdAt, item.read]) },
      { name: "Pengaturan Notifikasi", headers: ["Notifikasi Push", "Waktu Pengingat", "Hari Sebelumnya", "Ambang Anggaran (%)"], rows: [[data.notificationSettings.pushEnabled, data.notificationSettings.reminderTime, data.notificationSettings.advanceDays, data.notificationSettings.budgetThreshold]] },
      { name: "Preferensi", headers: ["Nama", "Email", "Tema", "Aksen", "Kunci Otomatis (menit)", "Backup Terakhir"], rows: [[data.preferences.name, data.preferences.email, data.preferences.theme, data.preferences.accent, data.preferences.autoLockMinutes, data.preferences.lastBackupAt]] },
      { name: "Riwayat Progres", headers: ["Tanggal", "Aset", "Tabungan Target", "Target Tabungan", "Tugas Selesai", "Kebiasaan Selesai", "Total Kebiasaan"], rows: data.progressSnapshots.map(item => [item.date, item.assets, item.goalsSaved, item.goalsTarget, item.completedTasks, item.habitsCompleted, item.habitsTotal]) },
      { name: "Konfigurasi Widget", headers: ["Data Konfigurasi"], rows: [[JSON.stringify(data.widgetConfiguration)]] }
    ];

    try {
      const workbook = createExcelWorkbook(sheets);
      const excelBytes = new Uint8Array(workbook.byteLength);
      excelBytes.set(workbook);
      const blob = new Blob([excelBytes.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SYNC-data-${currentDate}.xlsx`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("Data SYNC tidak dapat diekspor ke Excel.", error);
      alert(error instanceof Error ? `Ekspor Excel gagal: ${error.message}` : "Ekspor Excel gagal.");
    }
  }
  function importData(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Format file JSON tidak valid.");
        const restored = parsed.format === "sync-backup" ? parsed.data : parsed;
        if (!isValidDataSnapshot(restored)) {
          throw new Error("File ini bukan backup SYNC yang valid.");
        }
        preserveStoredData.current = false;
        setStorageError("");
        setData({
          ...initial,
          ...restored,
          habits: normalizeHabits(restored.habits, currentDate),
          goals: normalizeGoals(restored.goals),
          notifications: Array.isArray(restored.notifications) ? restored.notifications : [],
          notificationSettings: { ...initial.notificationSettings, ...restored.notificationSettings },
          preferences: { ...defaultPreferences, ...restored.preferences },
          widgetConfiguration: normalizeWidgetConfiguration(restored.widgetConfiguration)
        });
        setImportError("");
        alert("Backup SYNC berhasil dipulihkan. PIN aplikasi tetap mengikuti perangkat ini.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "File backup tidak valid.";
        setImportError(message);
        alert(message);
      }
    };
    reader.onerror = () => {
      const message = "File backup tidak dapat dibaca.";
      setImportError(message);
      alert(message);
    };
    reader.readAsText(file);
  }

  async function savePin(currentPin: string, nextPin: string): Promise<boolean> {
    if (pinCredential && !await verifyPin(currentPin, pinCredential)) return false;
    if (!nextPin) {
      localStorage.removeItem(SECURITY_KEY);
      setPinCredential(null);
      setIsLocked(false);
      return true;
    }
    const salt = randomSalt();
    const verifier = await derivePinVerifier(nextPin, salt);
    const credential = { salt: encodeBase64(salt), verifier: encodeBase64(verifier) };
    localStorage.setItem(SECURITY_KEY, JSON.stringify(credential));
    setPinCredential(credential);
    setIsLocked(false);
    return true;
  }

  async function unlock(pin: string): Promise<void> {
    if (!pinCredential || Date.now() < lockoutUntil) return;
    try {
      if (await verifyPin(pin, pinCredential)) {
        setFailedUnlockAttempts(0);
        setLockoutUntil(0);
        setLockError("");
        setIsLocked(false);
        return;
      }
      const attempts = failedUnlockAttempts + 1;
      setFailedUnlockAttempts(attempts);
      if (attempts >= 5) {
        setLockoutUntil(Date.now() + 30_000);
        setFailedUnlockAttempts(0);
        setLockError("Terlalu banyak percobaan. Coba lagi dalam 30 detik.");
        return;
      }
      setLockError(`PIN salah. Sisa percobaan sebelum jeda: ${5 - attempts}.`);
    } catch (error) {
      console.error("Verifikasi PIN gagal.", error);
      setLockError("PIN tidak dapat diverifikasi. Coba lagi atau hapus data SYNC pada browser ini.");
    }
  }

  function deleteAllData() {
    if (deleteConfirmation !== "HAPUS DATA") return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SECURITY_KEY);
    } catch (error) {
      console.error("Data SYNC tidak dapat dihapus dari penyimpanan lokal.", error);
      setStorageError("Data tidak dapat dihapus dari penyimpanan browser. Periksa pengaturan/perizinan browser lalu coba lagi.");
      return;
    }
    preserveStoredData.current = false;
    setStorageError("");
    skipNextDataSave.current = true;
    storageWriteSucceeded.current = true;
    setData(initial);
    setPinCredential(null);
    setIsLocked(false);
    setShowDeleteConfirmation(false);
    setDeleteConfirmation("");
    setImportError("");
    setPage("Pengaturan");
  }
  function notify(title: string, body: string) {
    if (!("Notification" in window)) { alert("Browser ini tidak mendukung notifikasi."); return; }
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission === "denied") alert("Izin notifikasi ditolak. Ubah izin SYNC di pengaturan browser.");
    else Notification.requestPermission().then(permission => permission === "granted" ? new Notification(title, { body }) : alert("Izin notifikasi belum diberikan.")).catch(error => {
      console.error("Permintaan izin notifikasi gagal.", error);
      alert("Izin notifikasi tidak dapat diminta saat ini.");
    });
  }
  async function enablePushNotifications() {
    if (!("Notification" in window)) {
      alert("Browser ini tidak mendukung notifikasi.");
      return;
    }
    if (Notification.permission === "denied") {
      alert("Izin notifikasi ditolak. Ubah izin SYNC di pengaturan browser.");
      return;
    }
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission === "granted") {
        setData(current => ({ ...current, notificationSettings: { ...current.notificationSettings, pushEnabled: true } }));
      } else {
        alert("Izin notifikasi belum diberikan.");
      }
    } catch (error) {
      console.error("Permintaan izin notifikasi gagal.", error);
      alert("Izin notifikasi tidak dapat diminta saat ini.");
    }
  }
  function markNotificationRead(id: string) {
    setData(current => ({ ...current, notifications: current.notifications.map(notification => notification.id === id ? { ...notification, read: true } : notification) }));
  }
  function markAllNotificationsRead() {
    setData(current => ({ ...current, notifications: current.notifications.map(notification => ({ ...notification, read: true })) }));
  }
  function deleteGoal(goal: Goal) {
    if (!window.confirm(`Hapus target "${goal.title}"? Progres target ini akan dihapus dan tidak dapat dipulihkan.`)) return;
    setData(current => ({ ...current, goals: current.goals.filter(item => item.id !== goal.id) }));
  }
  function setGoalStatus(id: string, status: Goal["status"]) {
    setData(current => ({ ...current, goals: current.goals.map(goal => goal.id === id ? { ...goal, status } : goal) }));
  }
  function sendChat() {
    const q = chat.trim(); if (!q) return;
    const lower = q.toLowerCase();
    let answer = "Saya bisa membantu merangkum data SYNC. Coba tanyakan: 'ringkasan keuangan', 'tugas saya', atau 'saran hemat'.";
    if (lower.includes("keuangan") || lower.includes("uang") || lower.includes("pengeluaran")) answer = `Ringkasan saat ini: pemasukan ${money(income)}, pengeluaran ${money(expense)}, dan selisih ${money(balance)}. Pengeluaran bulan ini ${money(monthExpense)} dari anggaran ${money(data.budget)}.`;
    else if (lower.includes("tugas") || lower.includes("aktivitas")) answer = `Kamu memiliki ${pendingTasks} tugas yang belum selesai dan ${completedTasks} tugas yang sudah selesai. Mulai dari tugas dengan prioritas tinggi.`;
    else if (lower.includes("hemat") || lower.includes("saran")) answer = monthExpense > data.budget ? `Pengeluaran bulan ini melewati anggaran sebesar ${money(monthExpense - data.budget)}. Tinjau transaksi non-prioritas dan tetapkan batas harian.` : `Pengeluaran masih ${money(Math.max(0, data.budget - monthExpense))} di bawah anggaran. Catat transaksi secara konsisten dan sisihkan tabungan di awal bulan.`;
    setMessages(m => [...m, { role: "user", text: q }, { role: "assistant", text: answer }]);
    setChat("");
  }

  const nav = [{ name: "Dashboard", icon: "◫" }, { name: "Keuangan", icon: "↗" }, { name: "Utang & Piutang", icon: "⇄" }, { name: "Aktivitas", icon: "✓" }, { name: "Laporan", icon: "▤" }, { name: "Kalender", icon: "▦" }, { name: "Kebiasaan", icon: "✳" }, { name: "Target", icon: "◎" }, { name: "Notifikasi", icon: "♧" }, { name: "AI Assistant", icon: "✦" }, { name: "Pengaturan", icon: "⚙" }];
  if (isLocked && pinCredential) return <LockScreen name={data.preferences.name} error={lockError} lockoutUntil={lockoutUntil} onUnlock={unlock}/>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><b>SYNC</b><small>PERSONAL OS</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      {nav.map(n => <button key={n.name} className={`nav-item ${page === n.name ? "active" : ""}`} onClick={() => setPage(n.name)}><span>{n.icon}</span><span className="nav-item-label">{n.name}</span>{n.name === "Aktivitas" && pendingTasks > 0 && <i>{pendingTasks}</i>}{n.name === "Notifikasi" && unreadNotifications > 0 && <i>{unreadNotifications}</i>}</button>)}
      <div className="sidebar-bottom"><div className="storage-card"><span className="pulse"></span><div><b>Data tersimpan lokal</b><small>Di perangkat ini</small></div></div><p>SYNC v1.0 · Personal dashboard</p></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">PERSONAL LIFE MANAGEMENT</div><h1>{page === "AI Assistant" ? "AI Assistant" : page}</h1></div><div className="top-actions"><span className="date-pill">◷ {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</span><button className="icon-btn notification-trigger" title="Buka pusat notifikasi" aria-label="Buka pusat notifikasi" onClick={() => setPage("Notifikasi")}>♧{unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}</button><button className="avatar profile-avatar" title={`Profil ${data.preferences.name}`} onClick={() => setPage("Pengaturan")}>{getInitials(data.preferences.name)}</button></div></header>

      {page === "Notifikasi" && <NotificationCenter
        notifications={data.notifications}
        settings={data.notificationSettings}
        unreadOnly={unreadOnly}
        onFilterChange={setUnreadOnly}
        onMarkRead={markNotificationRead}
        onMarkAllRead={markAllNotificationsRead}
        onRequestPush={enablePushNotifications}
        onPushChange={enabled => setData(current => ({ ...current, notificationSettings: { ...current.notificationSettings, pushEnabled: enabled } }))}
        onSettingsChange={settings => setData(current => ({ ...current, notificationSettings: { ...current.notificationSettings, ...settings } }))}
      />}

      {page === "Pengaturan" && <SettingsCenter
        preferences={data.preferences}
        widgetSyncError={widgetSyncError}
        notificationSettings={data.notificationSettings}
        pinEnabled={Boolean(pinCredential)}
        sessionStartedAt={sessionStartedAt}
        lastBackupAt={data.preferences.lastBackupAt}
        importError={importError}
        importRef={importRef}
        onPreferencesChange={preferences => setData(current => ({ ...current, preferences: { ...current.preferences, ...preferences } }))}
        onNotificationChange={enabled => setData(current => ({ ...current, notificationSettings: { ...current.notificationSettings, pushEnabled: enabled } }))}
        onSetPin={savePin}
        onLockSession={() => setIsLocked(true)}
        onExport={exportData}
        onExportExcel={exportExcel}
        onImport={importData}
        onDelete={() => setShowDeleteConfirmation(true)}
        onOpenWidget={() => setPage("Kustomisasi Widget")}
      />}

      {page === "Kustomisasi Widget" && <WidgetCustomization
        configuration={data.widgetConfiguration}
        sourceData={data}
        now={now}
        syncError={widgetSyncError}
        onBack={() => setPage("Pengaturan")}
        onChange={widgetConfiguration => setData(current => ({ ...current, widgetConfiguration }))}
      />}

      {page === "Laporan" && <ProgressReport data={data} now={now} period={reportPeriod} onPeriodChange={setReportPeriod}/>}

      {page === "Dashboard" && <section className="content">
        <div className="welcome"><div><div className="eyebrow light">YOUR DAY, IN SYNC</div><h2>Atur hari. Kendalikan tujuan.</h2><p>Semua hal penting dalam hidupmu, dalam satu tempat.</p></div><div className="welcome-orb">✦</div></div>
        <div className="stats-grid">
          <Stat label="Total saldo tercatat" value={money(balance)} note="Saldo awal ditambah transaksi" icon="◈" />
          <Stat label="Pengeluaran bulan ini" value={money(monthExpense)} note={`Anggaran ${money(data.budget)}`} icon="↘" />
          <Stat label="Tugas belum selesai" value={String(pendingTasks)} note={`${completedTasks} tugas selesai`} icon="✓" />
          <Stat label="Target tabungan" value={money(data.goals.reduce((s,g)=>s+g.saved,0))} note="Total dana terkumpul" icon="◎" />
        </div>
        <div className="two-col">
          <div className="panel"><div className="panel-head"><div><h3>Ringkasan keuangan</h3><p>Akumulasi seluruh transaksi tercatat</p></div><button className="text-btn" onClick={()=>setPage("Keuangan")}>Lihat detail ↗</button></div><div className="money-row"><div><small>PEMASUKAN</small><strong className="green">{money(income)}</strong></div><div><small>PENGELUARAN</small><strong className="red">{money(expense)}</strong></div></div><div className="budget-track"><div style={{width:`${Math.min(100, data.budget ? monthExpense/data.budget*100 : 0)}%`}} /></div><div className="track-caption"><span>Anggaran terpakai</span><b>{data.budget ? Math.round(monthExpense/data.budget*100) : 0}%</b></div></div>
          <div className="panel"><div className="panel-head"><div><h3>Fokus hari ini</h3><p>Langkah kecil, progres nyata</p></div><button className="text-btn" onClick={()=>setShowTask(true)}>+ Tambah</button></div>{data.tasks.filter(t=>!t.done).slice(0,4).map(t=><div className="task-line" key={t.id}><span className="task-dot"></span><div><b>{t.title}</b><small>{t.date || "Tanpa tanggal"} · {t.priority}</small></div></div>)}{pendingTasks===0 && <Empty text="Belum ada tugas. Tambahkan fokus hari ini."/>}</div>
        </div>
        <div className="two-col">
          <div className="panel"><div className="panel-head"><div><h3>Kebiasaan hari ini</h3><p>Bangun konsistensi setiap hari</p></div><button className="text-btn" onClick={()=>setPage("Kebiasaan")}>Semua ↗</button></div>{data.habits.map(h=>{const done=isHabitDoneToday(h,currentDate);return <label className="habit-line" key={h.id}><input type="checkbox" checked={done} onChange={e=>setData(d=>({...d,habits:d.habits.map(x=>x.id===h.id?{...x,done:e.target.checked,completedOn:e.target.checked?currentDate:undefined,completionDates:e.target.checked?[...new Set([...(x.completionDates??[]),currentDate])]:x.completionDates?.filter(date=>date!==currentDate)}:x)}))}/><span className={done?"done":""}>{h.title}</span><small>{done?"Selesai":"Belum"}</small></label>})}</div>
          <div className="panel"><div className="panel-head"><div><h3>Target tabungan</h3><p>Terus bergerak menuju tujuanmu</p></div><button className="text-btn" onClick={()=>setPage("Target")}>Detail ↗</button></div>{data.goals.filter(g=>g.status!=="achieved").slice(0,2).map(g=><div className="goal-mini" key={g.id}><div><b>{g.title}</b><span>{money(g.saved)} / {money(g.target)}</span></div><div className="budget-track"><div style={{width:`${Math.min(100,g.target?g.saved/g.target*100:0)}%`}}/></div></div>)}{data.goals.every(g=>g.status==="achieved")&&<Empty text="Belum ada target aktif. Buat target baru untuk mulai melacak progres."/>}</div>
        </div>
        <div className="panel dashboard-agenda"><div className="panel-head"><div><h3>Agenda mendatang</h3><p>Tugas dan pengingat terdekat.</p></div><button className="text-btn" onClick={()=>setPage("Kalender")}>Buka kalender ↗</button></div>{dashboardAgenda.length ? dashboardAgenda.map(item=><div className="task-line" key={item.id}><span className="calendar-date">{item.label==="Tugas"?"✓":"◷"}</span><div><b>{item.title}</b><small>{item.label} · {new Date(item.date).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:item.label==="Tugas"?undefined:"short"})}</small></div></div>) : <Empty text="Belum ada tugas atau pengingat mendatang."/>}</div>
      </section>}

      {page === "Keuangan" && <section className="content">
        <div className="section-actions"><div><h2>Keuangan pribadi</h2><p>Catat arus uang dan pantau anggaranmu.</p></div><button className="primary" onClick={()=>setShowTransaction(true)}>＋ Catat transaksi</button></div>
        <div className="stats-grid three"><Stat label="Pemasukan" value={money(income)} note="Semua pemasukan" icon="↗"/><Stat label="Pengeluaran" value={money(expense)} note="Semua pengeluaran" icon="↘"/><Stat label="Arus kas bersih" value={money(netFlow)} note="Pemasukan - pengeluaran" icon="◈"/></div>
        <div className="two-col"><div className="panel"><div className="panel-head"><div><h3>Anggaran bulanan</h3><p>Atur batas pengeluaran bulanan</p></div></div><label className="field-label">Anggaran (Rp)<input type="number" min="0" step="1" value={data.budget} onChange={e=>setData(d=>({...d,budget:Math.max(0,Number(e.target.value)||0)}))}/></label><div className="budget-track large"><div style={{width:`${Math.min(100,data.budget?monthExpense/data.budget*100:0)}%`}}/></div><div className="track-caption"><span>Terpakai {money(monthExpense)}</span><b>Sisa {money(data.budget-monthExpense)}</b></div></div><div className="panel"><div className="panel-head"><div><h3>Dompet & rekening</h3><p>Saldo awal dapat kamu sesuaikan; transaksi dihitung otomatis.</p></div></div>{data.accounts.map((a,i)=><label className="account-line" key={a.name}><span>◈ {a.name}<small className="account-current">Saldo saat ini: {money(currentAccountBalance(data,a.name,currentDate))}</small></span><input aria-label={`Saldo awal ${a.name}`} type="number" value={a.balance} onChange={e=>setData(d=>({...d,accounts:d.accounts.map((x,j)=>j===i?{...x,balance:Number(e.target.value)||0}:x)}))}/></label>)}</div></div>
        <div className="panel"><div className="panel-head"><div><h3>Riwayat transaksi</h3><p>{data.transactions.length} transaksi tercatat</p></div></div>{data.transactions.length===0?<Empty text="Belum ada transaksi. Mulai catat pemasukan atau pengeluaran."/>:<div className="table-wrap"><table><thead><tr><th>Transaksi</th><th>Kategori</th><th>Tanggal</th><th>Jenis</th><th>Jumlah</th><th></th></tr></thead><tbody>{[...data.transactions].reverse().map(t=><tr key={t.id}><td><b>{t.title}</b><small>{t.account}</small></td><td>{t.category}</td><td>{t.date}</td><td><span className={`tag ${t.type}`}>{t.type==="income"?"Masuk":"Keluar"}</span></td><td className={t.type==="income"?"green":"red"}>{t.type==="income"?"+":"−"}{money(t.amount)}</td><td><button className="delete-btn" onClick={()=>setData(d=>({...d,transactions:d.transactions.filter(x=>x.id!==t.id)}))}>Hapus</button></td></tr>)}</tbody></table></div>}</div>
        <div className="panel debt-summary"><div className="panel-head"><div><h3>Utang & piutang</h3><p>Pantau kewajiban dan uang yang perlu ditagih.</p></div><button className="text-btn" onClick={()=>setPage("Utang & Piutang")}>Lihat semua ↗</button></div><div className="money-row"><div><small>UTANG BELUM LUNAS</small><strong className="red">{money(unpaidOwed)}</strong></div><div><small>PIUTANG BELUM DIBAYAR</small><strong className="green">{money(unpaidReceivable)}</strong></div></div><button className="primary" onClick={()=>setShowDebt(true)}>＋ Tambah utang/piutang</button></div>
      </section>}

      {page === "Utang & Piutang" && <section className="content">
        <div className="section-actions"><div><h2>Utang & piutang</h2><p>Catat nominal, jatuh tempo, dan status pembayaran.</p></div><button className="primary" onClick={()=>setShowDebt(true)}>＋ Tambah catatan</button></div>
        <div className="stats-grid three"><Stat label="Utang belum lunas" value={money(unpaidOwed)} note="Kewajiban yang perlu dibayar" icon="↘"/><Stat label="Piutang belum dibayar" value={money(unpaidReceivable)} note="Dana yang perlu ditagih" icon="↗"/><Stat label="Catatan aktif" value={String(outstandingDebts.length)} note={`${data.debts.length - outstandingDebts.length} sudah lunas`} icon="⇄"/></div>
        <div className="panel"><div className="panel-head"><div><h3>Daftar utang & piutang</h3><p>{data.debts.length} catatan tersimpan</p></div></div>{data.debts.length===0?<Empty text="Belum ada catatan. Tambahkan utang atau piutang untuk mulai memantaunya."/>:<div className="table-wrap"><table className="debt-table"><thead><tr><th>Catatan</th><th>Jenis</th><th>Jatuh tempo</th><th>Nominal</th><th>Status pembayaran</th><th></th></tr></thead><tbody>{[...data.debts].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(debt=><tr key={debt.id}><td><b>{debt.title}</b></td><td><span className={`tag ${debt.type==="utang"?"expense":"income"}`}>{debt.type==="utang"?"Utang":"Piutang"}</span></td><td className={debt.status!=="Lunas"&&debt.dueDate<currentDate?"red":""}>{debt.dueDate}{debt.status!=="Lunas"&&debt.dueDate<currentDate&&<small>Lewat jatuh tempo</small>}</td><td>{money(debt.amount)}</td><td><select className={`debt-status ${debt.status==="Lunas"?"paid":""}`} aria-label={`Status pembayaran ${debt.title}`} value={debt.status} onChange={e=>setData(d=>({...d,debts:d.debts.map(item=>item.id===debt.id?{...item,status:e.target.value as Debt["status"]}:item)}))}><option>Belum lunas</option><option>Lunas</option></select></td><td><button className="delete-btn" onClick={()=>setData(d=>({...d,debts:d.debts.filter(item=>item.id!==debt.id)}))}>Hapus</button></td></tr>)}</tbody></table></div>}</div>
      </section>}

      {page === "Aktivitas" && <section className="content"><div className="section-actions"><div><h2>Daftar aktivitas</h2><p>Kelola pekerjaan dan prioritasmu.</p></div><button className="primary" onClick={()=>setShowTask(true)}>＋ Tambah tugas</button></div><div className="panel">{data.tasks.length===0?<Empty text="Belum ada tugas yang dibuat."/>:[...prioritizedTaskList, ...data.tasks.filter(task=>task.done).map(task=>({task:{id:task.id,title:task.title,dueDate:task.date,completed:true,priority:task.priority,completedOn:task.completedOn},reason:"Selesai",pinned:false,locked:false}))].map(({task:t, reason, pinned, locked})=><div className="task-full" key={t.id}><input type="checkbox" checked={t.completed} onChange={e=>setData(d=>({...d,tasks:d.tasks.map(x=>x.id===t.id?{...x,done:e.target.checked,completedOn:e.target.checked?currentDate:undefined}:x)}))}/><div className={t.completed?"done":""}><b>{t.title}</b><small>{t.dueDate||"Tanpa tanggal"}{data.widgetConfiguration.smartPriorityEnabled ? ` · ${reason}` : ""}</small></div><span className={`priority ${t.priority.toLowerCase()}`}>{pinned?"Disematkan · ":""}{t.priority}{locked?" · Terkunci":""}</span><button className="delete-btn" onClick={()=>setData(d=>({...d,tasks:d.tasks.filter(x=>x.id!==t.id)}))}>Hapus</button></div>)}</div></section>}

      {page === "Kalender" && <section className="content"><div className="section-actions"><div><h2>Kalender & pengingat</h2><p>Agenda yang perlu kamu ingat.</p></div><button className="primary" onClick={()=>setShowReminder(true)}>＋ Buat pengingat</button></div><div className="panel"><h3>Agenda tugas</h3>{data.tasks.filter(t=>t.date).sort((a,b)=>a.date.localeCompare(b.date)).map(t=><div className="task-line" key={t.id}><span className="calendar-date">{t.date.slice(8,10)}</span><div><b>{t.title}</b><small>{t.date}</small></div></div>)}{data.tasks.filter(t=>t.date).length===0&&<Empty text="Belum ada agenda bertanggal."/>}</div><div className="panel"><h3>Pengingat tersimpan</h3>{data.reminders.map(r=><div className="task-line" key={r.id}><span className="task-dot purple"></span><div><b>{r.title}</b><small>{new Date(r.date).toLocaleString("id-ID")}</small></div><button className="text-btn" onClick={()=>notify(r.title,"Ini pengingat dari SYNC.")}>Uji notifikasi</button></div>)}{data.reminders.length===0&&<Empty text="Belum ada pengingat."/>}</div></section>}

      {page === "Kebiasaan" && <section className="content"><div className="section-actions"><div><h2>Habit tracker</h2><p>Pantau kebiasaan yang ingin kamu bangun.</p></div><button className="primary" onClick={()=>setShowHabitForm(true)}>＋ Tambah kebiasaan</button></div><div className="panel">{data.habits.map(h=>{const done=isHabitDoneToday(h,currentDate);return <label className="habit-line roomy" key={h.id}><input type="checkbox" checked={done} onChange={e=>setData(d=>({...d,habits:d.habits.map(x=>x.id===h.id?{...x,done:e.target.checked,completedOn:e.target.checked?currentDate:undefined,completionDates:e.target.checked?[...new Set([...(x.completionDates??[]),currentDate])]:x.completionDates?.filter(date=>date!==currentDate)}:x)}))}/><span className={done?"done":""}>{h.title}</span><small>{done?"Selesai hari ini":"Belum dilakukan"}</small><button className="delete-btn" onClick={e=>{e.preventDefault();setData(d=>({...d,habits:d.habits.filter(x=>x.id!==h.id)}))}}>Hapus</button></label>})}{data.habits.length===0&&<Empty text="Belum ada habit. Tambahkan kebiasaan untuk mulai melacaknya."/>}</div></section>}

      {page === "Target" && <section className="content"><div className="section-actions"><div><h2>Target & tabungan</h2><p>Ubah rencana menjadi progres yang terukur.</p></div><button className="primary" onClick={()=>setShowGoal(true)}>＋ Target baru</button></div><div className="goal-grid">{data.goals.length===0?<Empty text="Belum ada target tabungan. Buat target untuk mulai melacak progres."/>:data.goals.map(g=><div className={`panel goal-card ${g.status==="achieved"?"goal-card-achieved":""}`} key={g.id}><div className="goal-icon">{g.status==="achieved"?"✓":"◎"}</div><span className={`goal-status ${g.status==="achieved"?"achieved":""}`}>{g.status==="achieved"?"Target tercapai":"Sedang berjalan"}</span><h3>{g.title}</h3><strong>{money(g.saved)}</strong><small>dari {money(g.target)}</small><div className="budget-track"><div style={{width:`${Math.min(100,g.target?g.saved/g.target*100:0)}%`}}/></div><div className="track-caption"><b>{g.target?Math.round(g.saved/g.target*100):0}% progres</b>{g.status!=="achieved"&&<button className="text-btn" onClick={()=>setGoalContributionId(g.id)}>＋ Tambah dana</button>}</div><div className="goal-actions">{g.status==="achieved"?<button className="text-btn" onClick={()=>setGoalStatus(g.id,"active")}>Jadikan aktif</button>:<button className="text-btn" onClick={()=>setGoalStatus(g.id,"achieved")}>Tandai tercapai</button>}<button className="delete-btn" onClick={()=>deleteGoal(g)}>Hapus target</button></div></div>)}</div></section>}

      {page === "AI Assistant" && <section className="content assistant-layout"><div className="assistant-intro"><div className="assistant-symbol">✦</div><h2>Teman berpikir, langsung dari dashboard.</h2><p>Tanyakan ringkasan keuangan, aktivitas, atau minta saran berdasarkan data yang tersimpan di SYNC.</p><span className="tag">MODE LOKAL · TANPA API</span></div><div className="panel chat-panel"><div className="chat-messages">{messages.map((m,i)=><div key={i} className={`bubble ${m.role}`}>{m.text}</div>)}</div><div className="chat-input"><input value={chat} onChange={e=>setChat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Tanyakan sesuatu tentang harimu..."/><button className="primary" onClick={sendChat}>Kirim ↑</button></div><small className="muted">Catatan: asisten awal ini menggunakan analisis lokal sederhana, bukan model AI online.</small></div></section>}

      <footer className="footer-actions"><span>SYNC · Semua perubahan tersimpan otomatis di browser.</span><div><button className="text-btn" onClick={()=>setPage("Pengaturan")}>Profil, backup & privasi ↗</button></div>{storageError && <p className="storage-error" role="alert">{storageError}</p>}</footer>
    </main>

    {showDeleteConfirmation && <Modal title="Hapus seluruh data SYNC" close={() => { setShowDeleteConfirmation(false); setDeleteConfirmation(""); }}>
      <form className="form-grid delete-confirmation" onSubmit={event => { event.preventDefault(); deleteAllData(); }}>
        <p className="full">Tindakan ini menghapus profil, seluruh data, notifikasi, pengaturan, dan PIN dari browser ini. Ekspor backup terlebih dahulu jika ingin menyimpan salinannya. Penghapusan izin notifikasi browser harus dilakukan melalui pengaturan browser.</p>
        <label className="full">Ketik <b>HAPUS DATA</b> untuk mengonfirmasi<input autoComplete="off" required value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder="HAPUS DATA"/></label>
        <button className="primary full delete-data-button" disabled={deleteConfirmation !== "HAPUS DATA"} type="submit">Hapus seluruh data</button>
      </form>
    </Modal>}

    {showTransaction&&<Modal title="Catat transaksi" close={()=>setShowTransaction(false)}><TransactionForm accounts={data.accounts.length?data.accounts.map(account=>account.name):initial.accounts.map(account=>account.name)} save={t=>{setData(d=>({...d,transactions:[...d.transactions,t]}));setShowTransaction(false)}}/></Modal>}
    {showDebt&&<Modal title="Tambah utang/piutang" close={()=>setShowDebt(false)}><DebtForm save={debt=>{setData(d=>({...d,debts:[...d.debts,debt]}));setShowDebt(false)}}/></Modal>}
    {showTask&&<Modal title="Tambah tugas" close={()=>setShowTask(false)}><TaskForm save={t=>{setData(d=>({...d,tasks:[...d.tasks,t]}));setShowTask(false)}}/></Modal>}
    {showGoal&&<Modal title="Buat target tabungan" close={()=>setShowGoal(false)}><GoalForm save={g=>{setData(d=>({...d,goals:[...d.goals,g]}));setShowGoal(false)}}/></Modal>}
    {showHabitForm&&<Modal title="Tambah kebiasaan" close={()=>setShowHabitForm(false)}><HabitForm save={title=>{setData(d=>({...d,habits:[...d.habits,{id:uid(),title,done:false,completionDates:[]}]}));setShowHabitForm(false)}}/></Modal>}
    {contributionGoal&&<Modal title={`Tambah dana — ${contributionGoal.title}`} close={()=>setGoalContributionId(null)}><GoalContributionForm save={amount=>{setData(d=>({...d,goals:d.goals.map(goal=>goal.id===contributionGoal.id?{...goal,saved:goal.saved+amount}:goal)}));setGoalContributionId(null)}}/></Modal>}
    {showReminder&&<Modal title="Buat pengingat" close={()=>setShowReminder(false)}><ReminderForm save={r=>{setData(d=>({...d,reminders:[...d.reminders,r]}));setShowReminder(false)}}/></Modal>}
  </div>;
}

function NotificationCenter({ notifications, settings, unreadOnly, onFilterChange, onMarkRead, onMarkAllRead, onRequestPush, onPushChange, onSettingsChange }: {
  notifications: AppNotification[];
  settings: NotificationSettings;
  unreadOnly: boolean;
  onFilterChange: (unreadOnly: boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onRequestPush: () => void;
  onPushChange: (enabled: boolean) => void;
  onSettingsChange: (settings: Partial<NotificationSettings>) => void;
}) {
  const unreadCount = notifications.filter(notification => !notification.read).length;
  const visibleNotifications = notifications
    .filter(notification => !unreadOnly || !notification.read)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const categoryLabels: Record<NotificationCategory, string> = {
    debt: "Tagihan",
    budget: "Anggaran",
    schedule: "Jadwal",
    goal: "Target",
    habit: "Habit",
    task: "Tugas"
  };
  const permission = !("Notification" in window) ? "Tidak didukung browser" : Notification.permission === "granted" ? "Izin diberikan" : Notification.permission === "denied" ? "Izin ditolak di browser" : "Izin belum diminta";

  return <section className="content notification-center">
    <div className="section-actions"><div><h2>Pusat notifikasi</h2><p>Pengingat dari seluruh modul, tersimpan sebagai riwayat.</p></div><button className="primary" disabled={!unreadCount} onClick={onMarkAllRead}>Tandai semua dibaca</button></div>
    <div className="notification-summary">
      <div className="panel notification-summary-card"><small>SEMUA NOTIFIKASI</small><strong>{notifications.length}</strong></div>
      <div className="panel notification-summary-card"><small>BELUM DIBACA</small><strong>{unreadCount}</strong></div>
      <div className="panel notification-summary-card"><small>PRIORITAS TINGGI</small><strong>{notifications.filter(notification => notification.priority === "Tinggi" && !notification.read).length}</strong></div>
    </div>

    <div className="panel notification-settings">
      <div className="panel-head"><div><h3>Pengaturan pengingat</h3><p>Sesuaikan jadwal, ambang anggaran, dan notifikasi browser.</p></div></div>
      <div className="notification-settings-grid">
        <label className="notification-setting-field">Waktu pengingat harian
          <input type="time" value={settings.reminderTime} onChange={event => { if (event.target.value) onSettingsChange({ reminderTime: event.target.value }); }}/>
          <small>Pengingat habit dan target yang belum selesai.</small>
        </label>
        <label className="notification-setting-field">Pengingat sebelum tenggat (hari)
          <input type="number" min="0" max="30" step="1" value={settings.advanceDays} onChange={event => { if (event.target.value) onSettingsChange({ advanceDays: Math.min(30, Math.max(0, Math.round(Number(event.target.value)))) }); }}/>
          <small>Untuk tagihan, jadwal, dan tenggat tugas.</small>
        </label>
        <label className="notification-setting-field">Ambang peringatan anggaran (%)
          <input type="number" min="1" max="100" step="1" value={settings.budgetThreshold} onChange={event => { if (event.target.value) onSettingsChange({ budgetThreshold: Math.min(100, Math.max(1, Math.round(Number(event.target.value)))) }); }}/>
          <small>Peringatan muncul lagi saat ambang diubah.</small>
        </label>
        <div className="notification-setting-field push-setting">
          <span>Push notification</span>
          <label className="push-toggle"><input type="checkbox" checked={settings.pushEnabled} disabled={!settings.pushEnabled && !("Notification" in window)} onChange={event => event.target.checked ? onRequestPush() : onPushChange(false)}/><span>Aktifkan notifikasi browser</span></label>
          <small>{permission}. Notifikasi otomatis dikirim saat SYNC terbuka; pengiriman saat aplikasi ditutup memerlukan server push.</small>
        </div>
      </div>
    </div>

    <div className="panel notification-history">
      <div className="panel-head notification-history-head"><div><h3>Riwayat notifikasi</h3><p>{unreadCount} belum dibaca · maksimal 100 notifikasi terbaru</p></div>
        <div className="notification-filters">
          <button className={`notification-filter ${!unreadOnly ? "active" : ""}`} onClick={() => onFilterChange(false)}>Semua</button>
          <button className={`notification-filter ${unreadOnly ? "active" : ""}`} onClick={() => onFilterChange(true)}>Belum dibaca</button>
        </div>
      </div>
      {visibleNotifications.length === 0
        ? <Empty text={unreadOnly ? "Semua notifikasi sudah dibaca." : "Belum ada notifikasi. Pengingat dari modul akan tampil di sini."}/>
        : <div className="notification-list">{visibleNotifications.map(notification => <article className={`notification-row ${notification.read ? "" : "unread"}`} key={notification.id}>
          <div className={`notification-priority priority-${notification.priority.toLowerCase()}`}>{notification.priority}</div>
          <div className="notification-copy">
            <div className="notification-meta"><span className="tag">{categoryLabels[notification.category]}</span><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</time></div>
            <h4>{notification.title}</h4>
            <p>{notification.message}</p>
          </div>
          {!notification.read && <button className="text-btn mark-read" onClick={() => onMarkRead(notification.id)}>Tandai dibaca</button>}
        </article>)}</div>}
    </div>
  </section>;
}

function SettingsCenter({ preferences, notificationSettings, pinEnabled, sessionStartedAt, lastBackupAt, importError, importRef, onPreferencesChange, onNotificationChange, onSetPin, onLockSession, onExport, onExportExcel, onImport, onDelete, onOpenWidget, widgetSyncError }: {
  preferences: UserPreferences;
  widgetSyncError: string;
  notificationSettings: NotificationSettings;
  pinEnabled: boolean;
  sessionStartedAt: Date;
  lastBackupAt: string;
  importError: string;
  importRef: React.RefObject<HTMLInputElement | null>;
  onPreferencesChange: (preferences: Partial<UserPreferences>) => void;
  onNotificationChange: (enabled: boolean) => void;
  onSetPin: (currentPin: string, nextPin: string) => Promise<boolean>;
  onLockSession: () => void;
  onExport: () => void;
  onExportExcel: () => void;
  onImport: (file?: File) => void;
  onDelete: () => void;
  onOpenWidget: () => void;
}) {
  const [currentPin, setCurrentPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [isSavingPin, setIsSavingPin] = useState(false);

  async function handleSavePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPinMessage("");
    if (!/^\d{6,12}$/.test(nextPin)) {
      setPinMessage("PIN baru harus terdiri dari 6–12 angka.");
      return;
    }
    if (nextPin !== confirmPin) {
      setPinMessage("Konfirmasi PIN tidak sama.");
      return;
    }
    setIsSavingPin(true);
    try {
      const saved = await onSetPin(currentPin, nextPin);
      setPinMessage(saved ? "PIN berhasil disimpan. Aplikasi akan terkunci kembali saat berikutnya dibuka." : "PIN saat ini salah.");
      if (saved) {
        setCurrentPin("");
        setNextPin("");
        setConfirmPin("");
      }
    } catch (error) {
      console.error("PIN aplikasi tidak dapat disimpan.", error);
      setPinMessage(error instanceof Error ? error.message : "PIN tidak dapat disimpan.");
    } finally {
      setIsSavingPin(false);
    }
  }

  async function handleDisablePin() {
    setPinMessage("");
    setIsSavingPin(true);
    try {
      const removed = await onSetPin(currentPin, "");
      setPinMessage(removed ? "PIN aplikasi dinonaktifkan." : "PIN saat ini salah.");
      if (removed) setCurrentPin("");
    } catch (error) {
      console.error("PIN aplikasi tidak dapat dinonaktifkan.", error);
      setPinMessage(error instanceof Error ? error.message : "PIN tidak dapat dinonaktifkan.");
    } finally {
      setIsSavingPin(false);
    }
  }

  return <section className="content settings-center">
    <div className="section-actions"><div><h2>Pengaturan</h2><p>Kelola profil, tampilan, keamanan, dan data SYNC.</p></div></div>

    <div className="panel settings-panel widget-settings-entry">
      <div className="panel-head"><div><h3>Widget Customization</h3><p>Atur modul, prioritas, privasi, dan tampilan Home Screen Widget.</p></div><button className="primary" type="button" onClick={onOpenWidget}>Atur widget ↗</button></div>
      <p className="settings-help">Pengaturan widget tersimpan otomatis bersama data SYNC di perangkat ini.</p>
      {widgetSyncError && <p className="widget-sync-error" role="alert">{widgetSyncError}</p>}
    </div>

    <div className="panel settings-panel">
      <div className="panel-head"><div><h3>Profil pengguna</h3><p>Informasi profil tersimpan hanya di browser ini.</p></div><div className="avatar settings-avatar">{getInitials(preferences.name)}</div></div>
      <div className="settings-fields">
        <label className="settings-field">Nama tampilan<input maxLength={60} value={preferences.name} onChange={event => onPreferencesChange({ name: event.target.value })} placeholder="Nama pengguna"/></label>
        <label className="settings-field">Email (opsional)<input type="email" maxLength={254} value={preferences.email} onChange={event => onPreferencesChange({ email: event.target.value })} placeholder="nama@email.com"/></label>
      </div>
    </div>

    <div className="panel settings-panel">
      <div className="panel-head"><div><h3>Tampilan</h3><p>Tema dan warna aksen dapat diubah kapan saja.</p></div></div>
      <div className="settings-choice-row">
        <span className="settings-choice-title">Tema</span>
        <div className="settings-choice-group">
          {(["dark", "light"] as const).map(theme => <button key={theme} type="button" className={`settings-choice ${preferences.theme === theme ? "selected" : ""}`} aria-pressed={preferences.theme === theme} onClick={() => onPreferencesChange({ theme })}>{theme === "dark" ? "◐ Gelap" : "☀ Terang"}</button>)}
        </div>
      </div>
      <div className="settings-choice-row accent-choice-row">
        <span className="settings-choice-title">Warna aksen</span>
        <div className="accent-swatches">
          {Object.entries(ACCENTS).map(([name, color]) => <button key={name} type="button" className={`accent-swatch ${preferences.accent === name ? "selected" : ""}`} style={{ "--swatch-color": color } as React.CSSProperties} aria-label={`Pilih aksen ${name}`} aria-pressed={preferences.accent === name} onClick={() => onPreferencesChange({ accent: name as keyof typeof ACCENTS })}/>)}
        </div>
      </div>
    </div>

    <div className="panel settings-panel">
      <div className="panel-head"><div><h3>Privasi & notifikasi</h3><p>Pahami bagaimana data dan izin browser digunakan.</p></div></div>
      <div className="settings-info-row"><div><b>Penyimpanan lokal</b><p>Profil, transaksi, dan backup berada di penyimpanan browser perangkat ini; SYNC tidak mengirimkannya ke server.</p></div><span className="settings-status">Perangkat ini</span></div>
      <div className="settings-info-row"><div><b>AI Assistant</b><p>Jawaban dibuat secara lokal dari ringkasan aktivitas; pertanyaan dan data tidak dikirim ke model eksternal.</p></div><span className="settings-status">Lokal</span></div>
      <div className="settings-info-row"><div><b>Notifikasi browser</b><p>Matikan untuk menghentikan notifikasi browser dari SYNC. Izin situs dapat dicabut di pengaturan browser.</p></div><label className="push-toggle settings-push-toggle"><input type="checkbox" checked={notificationSettings.pushEnabled} onChange={event => onNotificationChange(event.target.checked)}/><span>{notificationSettings.pushEnabled ? "Aktif" : "Nonaktif"}</span></label></div>
      <div className="settings-info-row privacy-caveat"><p>PIN mengunci tampilan aplikasi, tetapi tidak mengenkripsi data yang tersimpan di browser. Siapa pun yang memiliki akses ke profil browser/perangkat ini mungkin dapat mengakses data lokal.</p></div>
    </div>

    <div className="panel settings-panel">
      <div className="panel-head"><div><h3>Kunci aplikasi dengan PIN</h3><p>{pinEnabled ? "PIN aktif pada perangkat ini." : "Buat PIN untuk mengunci tampilan aplikasi."} Gunakan 6–12 angka.</p></div><span className={`settings-status ${pinEnabled ? "status-enabled" : ""}`}>{pinEnabled ? "Aktif" : "Nonaktif"}</span></div>
      <form className="settings-fields pin-settings-form" onSubmit={handleSavePin}>
        {pinEnabled && <label className="settings-field">PIN saat ini<input autoComplete="current-password" inputMode="numeric" maxLength={12} pattern="[0-9]{6,12}" required type="password" value={currentPin} onChange={event => setCurrentPin(event.target.value)} placeholder="6–12 angka"/></label>}
        <label className="settings-field">PIN baru<input autoComplete="new-password" inputMode="numeric" maxLength={12} pattern="[0-9]{6,12}" required type="password" value={nextPin} onChange={event => setNextPin(event.target.value)} placeholder="6–12 angka"/></label>
        <label className="settings-field">Konfirmasi PIN<input autoComplete="new-password" inputMode="numeric" maxLength={12} pattern="[0-9]{6,12}" required type="password" value={confirmPin} onChange={event => setConfirmPin(event.target.value)} placeholder="Ulangi PIN baru"/></label>
        <button className="primary settings-save-button" disabled={isSavingPin} type="submit">{isSavingPin ? "Menyimpan…" : pinEnabled ? "Ubah PIN" : "Aktifkan PIN"}</button>
      </form>
      {pinEnabled && <div className="pin-session-actions"><button className="settings-secondary-button" type="button" onClick={onLockSession}>Kunci sesi sekarang</button><button className="settings-danger-button" type="button" disabled={isSavingPin || !currentPin} onClick={handleDisablePin}>Nonaktifkan PIN</button></div>}
      {pinMessage && <p className="settings-feedback" role="status">{pinMessage}</p>}
      <div className="session-settings">
        <label className="settings-field">Kunci otomatis setelah tidak aktif
          <select value={preferences.autoLockMinutes} disabled={!pinEnabled} onChange={event => onPreferencesChange({ autoLockMinutes: Number(event.target.value) })}>
            {[1, 5, 15, 30].map(minutes => <option key={minutes} value={minutes}>{minutes} menit</option>)}
            <option value={0}>Tidak pernah</option>
          </select>
        </label>
        <div className="session-description"><b>Sesi browser saat ini <span className="settings-status status-enabled">Aktif</span></b><p>Dimulai {sessionStartedAt.toLocaleString("id-ID")}. Sesi ini berjalan di perangkat dan profil browser yang sedang digunakan; aplikasi offline ini tidak mengelola sesi di perangkat lain.</p></div>
      </div>
    </div>

    <div className="panel settings-panel">
      <div className="panel-head"><div><h3>Ekspor & backup</h3><p>Unduh data SYNC dalam format Excel untuk dibuka di spreadsheet. Gunakan backup JSON untuk memulihkan data ke aplikasi.</p></div></div>
      <div className="backup-actions"><button className="primary" type="button" onClick={onExportExcel}>↓ Ekspor ke Excel</button><button className="settings-secondary-button" type="button" onClick={onExport}>↓ Backup JSON</button><button className="settings-secondary-button" type="button" onClick={() => { if (importRef.current) importRef.current.value = ""; importRef.current?.click(); }}>↑ Pulihkan dari JSON</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event => onImport(event.target.files?.[0])}/></div>
      <p className="settings-help">{lastBackupAt ? `Backup terakhir: ${new Date(lastBackupAt).toLocaleString("id-ID")}.` : "Belum ada backup yang dibuat dari perangkat ini."} PIN tidak disertakan dalam file backup dan tetap mengikuti perangkat tempat aplikasi dipulihkan.</p>
      {importError && <p className="settings-feedback" role="alert">{importError}</p>}
    </div>

    <div className="panel settings-panel settings-delete-panel">
      <div className="panel-head"><div><h3>Hapus data lokal</h3><p>Menghapus semua data SYNC dan PIN dari browser ini secara permanen.</p></div></div>
      <button className="settings-danger-button" type="button" onClick={onDelete}>Hapus seluruh data SYNC</button>
    </div>
  </section>;
}

function LockScreen({ name, error, lockoutUntil, onUnlock }: { name: string; error: string; lockoutUntil: number; onUnlock: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    const updateRemaining = () => setRemainingSeconds(Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000)));
    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [lockoutUntil]);

  return <main className="lock-screen">
    <form className="lock-card" onSubmit={event => { event.preventDefault(); if (!remainingSeconds) { onUnlock(pin); setPin(""); } }}>
      <div className="lock-brand-mark">S</div>
      <div className="eyebrow">SYNC · PERSONAL OS</div>
      <h1>Aplikasi terkunci</h1>
      <p>Masukkan PIN untuk melanjutkan{ name ? `, ${name}` : ""}.</p>
      <label className="lock-pin-field">PIN aplikasi<input autoFocus autoComplete="current-password" inputMode="numeric" maxLength={12} pattern="[0-9]{6,12}" required type="password" value={pin} onChange={event => setPin(event.target.value)} placeholder="Masukkan PIN"/></label>
      <button className="primary lock-submit" disabled={remainingSeconds > 0} type="submit">{remainingSeconds > 0 ? `Coba lagi dalam ${remainingSeconds} dtk` : "Buka SYNC"}</button>
      {error && <p className="lock-error" role="alert">{error}</p>}
      <p className="lock-disclaimer">PIN hanya mengunci tampilan aplikasi pada perangkat ini; data browser tidak dienkripsi. Jika lupa PIN, hapus penyimpanan situs/browser untuk mengatur ulang data.</p>
    </form>
  </main>;
}

function Stat({label,value,note,icon}:{label:string;value:string;note:string;icon:string}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></div>; }
function Empty({text}:{text:string}) { return <div className="empty-state">{text}</div>; }
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>; }
function DebtForm({save}:{save:(debt:Debt)=>void}) {
  const [title,setTitle]=useState(""); const [amount,setAmount]=useState(""); const [type,setType]=useState<Debt["type"]>("utang"); const [dueDate,setDueDate]=useState(()=>localDateKey(new Date()));
  return <form className="form-grid" onSubmit={e=>{e.preventDefault();if(title.trim()&&Number(amount)>0)save({id:uid(),title:title.trim(),amount:Number(amount),type,dueDate,status:"Belum lunas"})}}>
    <label className="full">Nama pihak / keperluan<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Pinjaman dari Andi"/></label>
    <label>Jenis catatan<select value={type} onChange={e=>setType(e.target.value as Debt["type"])}><option value="utang">Utang — saya perlu membayar</option><option value="piutang">Piutang — perlu ditagih</option></select></label>
    <label>Nominal (Rp)<input required type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label className="full">Tanggal jatuh tempo<input required type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <button className="primary full" type="submit">Simpan catatan</button>
  </form>;
}
function TransactionForm({accounts,save}:{accounts:string[];save:(t:Transaction)=>void}) {
  const [title,setTitle]=useState(""); const [amount,setAmount]=useState(""); const [type,setType]=useState<"income"|"expense">("expense"); const [category,setCategory]=useState("Makanan"); const [date,setDate]=useState(()=>localDateKey(new Date())); const [account,setAccount]=useState(accounts[0] ?? "Dompet");
  return <form onSubmit={e=>{e.preventDefault();if(title.trim()&&Number(amount)>0&&accounts.includes(account))save({id:uid(),title:title.trim(),amount:Number(amount),type,category,date,account})}} className="form-grid"><label>Nama transaksi<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Makan siang"/></label><label>Jumlah (Rp)<input required type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Jenis<select value={type} onChange={e=>setType(e.target.value as "income"|"expense")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select></label><label>Kategori<select value={category} onChange={e=>setCategory(e.target.value)}>{["Makanan","Transportasi","Belanja","Tagihan","Hiburan","Pendidikan","Gaji","Bonus","Lainnya"].map(x=><option key={x}>{x}</option>)}</select></label><label>Tanggal<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Sumber dana<select required value={account} onChange={e=>setAccount(e.target.value)}>{accounts.map(name=><option key={name}>{name}</option>)}</select></label><button className="primary full" type="submit">Simpan transaksi</button></form>;
}
function TaskForm({save}:{save:(t:Task)=>void}) { const [title,setTitle]=useState("");const [date,setDate]=useState(()=>localDateKey(new Date()));const [priority,setPriority]=useState<Task["priority"]>("Sedang");return <form className="form-grid" onSubmit={e=>{e.preventDefault();save({id:uid(),title,date,priority,done:false})}}><label className="full">Nama tugas<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Apa yang perlu diselesaikan?"/></label><label>Tanggal<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Prioritas<select value={priority} onChange={e=>setPriority(e.target.value as Task["priority"])}><option>Rendah</option><option>Sedang</option><option>Tinggi</option></select></label><button className="primary full">Simpan tugas</button></form>; }
function GoalForm({save}:{save:(g:Goal)=>void}) {const [title,setTitle]=useState("");const [target,setTarget]=useState("");return <form className="form-grid" onSubmit={e=>{e.preventDefault();save({id:uid(),title,target:Number(target),saved:0,status:"active"})}}><label className="full">Nama target<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Laptop baru"/></label><label className="full">Jumlah target (Rp)<input required type="number" min="1" value={target} onChange={e=>setTarget(e.target.value)}/></label><button className="primary full">Buat target</button></form>; }
function GoalContributionForm({save}:{save:(amount:number)=>void}) {const [amount,setAmount]=useState("");return <form className="form-grid" onSubmit={e=>{e.preventDefault();const value=Number(amount);if(Number.isSafeInteger(value)&&value>0)save(value)}}><label className="full">Dana yang ditambahkan (Rp)<input autoFocus required type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="primary full" type="submit">Simpan kontribusi</button></form>; }
function HabitForm({save}:{save:(title:string)=>void}) {const [title,setTitle]=useState("");return <form className="form-grid" onSubmit={e=>{e.preventDefault();if(title.trim())save(title.trim())}}><label className="full">Nama kebiasaan<input autoFocus required maxLength={80} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Membaca 15 menit"/></label><button className="primary full" type="submit">Simpan kebiasaan</button></form>; }
function ReminderForm({save}:{save:(r:Reminder)=>void}) {const [title,setTitle]=useState("");const [date,setDate]=useState("");return <form className="form-grid" onSubmit={e=>{e.preventDefault();if(title.trim()&&date)save({id:uid(),title:title.trim(),date})}}><label className="full">Nama pengingat<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Bayar tagihan"/></label><label className="full">Tanggal & waktu<input required type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label><p className="form-note full">Pengingat muncul di kalender dan dashboard. Notifikasi browser hanya diperiksa saat SYNC terbuka; pengiriman saat aplikasi ditutup belum tersedia.</p><button className="primary full">Simpan pengingat</button></form>; }
