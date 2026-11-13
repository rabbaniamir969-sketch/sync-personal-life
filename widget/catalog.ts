import type { WidgetModuleDefinition, WidgetModuleId } from "./types";

export const WIDGET_MODULES: readonly WidgetModuleDefinition[] = [
  {
    id: "tasks",
    label: "Tugas",
    available: true,
    description: "Daftar tugas aktif dan tingkat prioritasnya.",
    fields: [
      { id: "title", label: "Nama tugas" },
      { id: "dueDate", label: "Tenggat" },
      { id: "priority", label: "Prioritas" }
    ]
  },
  {
    id: "calendar",
    label: "Kalender & agenda",
    available: true,
    description: "Agenda dari tugas bertanggal dan pengingat tersimpan.",
    fields: [
      { id: "title", label: "Nama agenda" },
      { id: "date", label: "Tanggal dan waktu" },
      { id: "type", label: "Jenis agenda" }
    ]
  },
  {
    id: "reminders",
    label: "Pengingat",
    available: true,
    description: "Pengingat SYNC yang waktunya belum berlalu.",
    fields: [
      { id: "title", label: "Nama pengingat" },
      { id: "date", label: "Tanggal dan waktu" }
    ]
  },
  {
    id: "finance",
    label: "Keuangan",
    available: true,
    description: "Ringkasan saldo dan arus kas yang dihitung dari transaksi SYNC.",
    fields: [
      { id: "monthIncome", label: "Pemasukan bulan ini" },
      { id: "monthExpenses", label: "Pengeluaran bulan ini" },
      { id: "monthlyBudget", label: "Anggaran bulanan" },
      { id: "balance", label: "Saldo" }
    ]
  },
  {
    id: "goals",
    label: "Target",
    available: true,
    description: "Progres target tabungan yang masih aktif.",
    fields: [
      { id: "title", label: "Nama target" },
      { id: "saved", label: "Dana terkumpul" },
      { id: "target", label: "Nilai target" },
      { id: "progressPercent", label: "Persentase progres" }
    ]
  },
  {
    id: "habits",
    label: "Habit tracker",
    available: true,
    description: "Kebiasaan dan status penyelesaiannya hari ini.",
    fields: [
      { id: "title", label: "Nama kebiasaan" },
      { id: "doneToday", label: "Status hari ini" }
    ]
  },
  {
    id: "productivity",
    label: "Produktivitas",
    available: true,
    description: "Ringkasan produktivitas yang dihitung dari tugas dan habit.",
    fields: [
      { id: "completedTasks", label: "Tugas selesai" },
      { id: "pendingTasks", label: "Tugas belum selesai" },
      { id: "completedHabits", label: "Habit selesai hari ini" },
      { id: "totalHabits", label: "Jumlah habit" }
    ]
  },
  {
    id: "focus",
    label: "Focus management",
    available: false,
    description: "Belum tersedia di SYNC; tidak ada data fokus untuk disinkronkan.",
    fields: []
  },
  {
    id: "notes",
    label: "Catatan",
    available: false,
    description: "Belum tersedia di SYNC; tidak ada data catatan untuk disinkronkan.",
    fields: []
  },
  {
    id: "health",
    label: "Health & wellness",
    available: false,
    description: "Belum tersedia di SYNC; tidak ada data kesehatan untuk disinkronkan.",
    fields: []
  }
] as const;

export const WIDGET_MODULE_IDS: readonly WidgetModuleId[] = WIDGET_MODULES.map(module => module.id);
