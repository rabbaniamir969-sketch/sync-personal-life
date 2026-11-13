package com.sync.personal

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

class WidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        scheduleRefresh(context, refreshMinutes(context))
        widgetIds.forEach { updateWidget(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        updateWidget(context, manager, appWidgetId)
    }

    override fun onEnabled(context: Context) {
        scheduleRefresh(context, refreshMinutes(context))
    }

    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(REFRESH_WORK_NAME)
    }

    companion object {
        const val PREFERENCES_NAME = "sync_widget_private"
        const val SNAPSHOT_KEY = "snapshot_v1"
        const val CONFIGURATION_KEY = "configuration_v1"
        private const val REFRESH_WORK_NAME = "sync-widget-refresh"

        fun updateWidget(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            val snapshot = parseJson(preferences.getString(SNAPSHOT_KEY, null))
            val configuration = parseJson(preferences.getString(CONFIGURATION_KEY, null))
            val options = manager.getAppWidgetOptions(widgetId)
            val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180)
            val size = when {
                width < 160 -> "small"
                width < 270 -> "medium"
                else -> "large"
            }

            val views = RemoteViews(context.packageName, R.layout.sync_widget)
            val updatedAt = snapshot?.optString("updatedAt").orEmpty()
            val updateTime = try {
                java.time.Instant.parse(updatedAt).atZone(java.time.ZoneId.systemDefault())
                    .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
            } catch (_: Exception) {
                "—"
            }
            views.setTextViewText(R.id.widget_date, "${LocalDate.now()}  ·  Update $updateTime")
            views.setTextViewText(
                R.id.widget_content,
                if (snapshot == null || configuration == null) {
                    "Buka SYNC untuk menyinkronkan data widget."
                } else {
                    renderContent(snapshot, configuration, size)
                }
            )
            views.setViewVisibility(R.id.widget_finance_action, if (size == "small") View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.widget_reminder_action, if (size == "small") View.GONE else View.VISIBLE)
            views.setOnClickPendingIntent(R.id.widget_add_task, actionIntent(context, "tasks/new", 101))
            views.setOnClickPendingIntent(R.id.widget_calendar_action, actionIntent(context, "calendar", 102))
            views.setOnClickPendingIntent(R.id.widget_finance_action, actionIntent(context, "finance", 103))
            views.setOnClickPendingIntent(R.id.widget_reminder_action, actionIntent(context, "reminders/new", 104))
            manager.updateAppWidget(widgetId, views)
        }

        fun scheduleRefresh(context: Context, requestedMinutes: Int) {
            val interval = requestedMinutes.coerceIn(15, 120).toLong()
            val request = PeriodicWorkRequest.Builder(
                WidgetRefreshWorker::class.java,
                interval,
                TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                REFRESH_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        private fun refreshMinutes(context: Context): Int {
            val configuration = parseJson(
                context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                    .getString(CONFIGURATION_KEY, null)
            ) ?: return 30
            return configuration.optInt("refreshMinutes", 30)
        }

        private fun actionIntent(context: Context, route: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("sync://$route")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun renderContent(snapshot: JSONObject, configuration: JSONObject, size: String): String {
            val modules = snapshot.optJSONObject("modules") ?: return "Data widget belum tersedia."
            val configModules = configuration.optJSONObject("modules") ?: JSONObject()
            val today = LocalDate.now().toString()
            val tasks = prioritizedTasks(modules, configuration, today)
            val lines = mutableListOf<String>()

            for ((id, settings) in selectedModules(configModules, modules, size)) {
                val fields = settings.optJSONArray("fields").asStrings().toSet()
                val isSensitiveVisible = configuration.optBoolean("showSensitiveInfo")
                val section = modules.optJSONObject(id) ?: continue
                val label = moduleLabel(id)
                val items = section.optJSONArray("items").asObjects()
                when (id) {
                    "tasks" -> {
                        if (size == "small") {
                            val count = section.optInt("count", tasks.size)
                            lines += "$count tugas belum selesai"
                            tasks.firstOrNull()?.let { task ->
                                formatItem(id, task, fields, isSensitiveVisible)
                                    .forEach { lines += "Penting: $it" }
                            }
                        } else {
                            lines += "TUGAS PENTING"
                            val limit = minOf(if (size == "medium") 2 else itemLimit(settings), itemLimit(settings))
                            if (tasks.isEmpty()) lines += "Tidak ada tugas aktif."
                            tasks.take(limit).forEach { task ->
                                formatItem(id, task, fields, isSensitiveVisible).forEach { lines += "• $it" }
                            }
                        }
                    }
                    "calendar" -> {
                        val agenda = when (size) {
                            "small" -> listOfNotNull(nextAgenda(modules))
                            "medium" -> items.filter {
                                it.optString("date").startsWith(today) && isUpcoming(it.optString("date"))
                            }
                            else -> items
                        }
                        if (size == "medium") lines += "AGENDA HARI INI"
                        if (agenda.isEmpty()) lines += if (size == "medium") "Tidak ada agenda hari ini." else "Belum ada agenda."
                        agenda.take(if (size == "small") 1 else itemLimit(settings)).forEach { item ->
                            formatItem(id, item, fields, isSensitiveVisible)
                                .forEach { lines += if (size == "small") "Agenda: $it" else "• $it" }
                        }
                    }
                    "reminders" -> {
                        val upcoming = items.filter { isUpcoming(it.optString("date")) }
                        val selected = if (size == "large") upcoming.take(itemLimit(settings)) else upcoming.take(1)
                        if (selected.isEmpty()) lines += "Tidak ada pengingat terdekat."
                        selected.forEach { reminder ->
                            formatItem(id, reminder, fields, isSensitiveVisible)
                                .forEach { lines += if (size == "medium") "PENGINGAT: $it" else "• $it" }
                        }
                    }
                    "finance" -> lines += financeSummary(modules, configuration, fields)
                    else -> {
                        lines += moduleLabel(id)
                        if (items.isEmpty()) lines += "Belum ada data."
                        items.take(itemLimit(settings)).forEach { item ->
                            formatItem(id, item, fields, isSensitiveVisible)
                                .forEach { lines += "• $it" }
                        }
                    }
                }
            }
            return lines.joinToString("\n").ifBlank { "Pilih modul widget di Pengaturan SYNC." }
        }

        private data class WidgetModuleSetting(val id: String, val settings: JSONObject)

        private fun selectedModules(
            settings: JSONObject,
            modules: JSONObject,
            size: String
        ): List<Pair<String, JSONObject>> {
            val candidates = settings.keys().asSequence().mapNotNull { id ->
                val moduleSettings = settings.optJSONObject(id) ?: return@mapNotNull null
                val moduleData = modules.optJSONObject(id) ?: return@mapNotNull null
                if ((!moduleSettings.optBoolean("enabled") && !moduleSettings.optBoolean("alwaysVisible"))
                    || moduleData.optString("status") == "unavailable") return@mapNotNull null
                WidgetModuleSetting(id, moduleSettings)
            }.sortedWith(
                compareByDescending<WidgetModuleSetting> { it.settings.optBoolean("alwaysVisible") }
                    .thenByDescending { it.settings.optInt("priority") }
                    .thenBy { it.settings.optInt("order", Int.MAX_VALUE) }
            ).toList()

            val capacity = when (size) {
                "small" -> 2
                "medium" -> 4
                else -> candidates.size
            }
            val selectedIds = candidates.take(capacity).map { it.id }.toMutableSet()
            candidates.filter { it.settings.optBoolean("alwaysVisible") }.forEach { selectedIds += it.id }
            return candidates.filter { it.id in selectedIds }
                .sortedBy { it.settings.optInt("order", Int.MAX_VALUE) }
                .map { it.id to it.settings }
        }

        private fun moduleLabel(id: String): String = when (id) {
            "tasks" -> "Tugas"
            "calendar" -> "Kalender & agenda"
            "finance" -> "Keuangan"
            "goals" -> "Target"
            "reminders" -> "Pengingat"
            "habits" -> "Habit tracker"
            "productivity" -> "Produktivitas"
            else -> id.replaceFirstChar { it.uppercase() }
        }

        private data class RankedTask(
            val item: JSONObject,
            val originalIndex: Int,
            val score: Int,
            val reason: String,
            val pinned: Boolean,
            val locked: Boolean
        )

        private fun prioritizedTasks(modules: JSONObject, configuration: JSONObject, today: String): List<JSONObject> {
            val taskSection = modules.optJSONObject("tasks") ?: return emptyList()
            val items = taskSection.optJSONArray("items").asObjects()
                .filterNot { it.optBoolean("completed") }
            val overrides = configuration.optJSONObject("taskPriorities") ?: JSONObject()
            val smartEnabled = configuration.optBoolean("smartPriorityEnabled", true)
            val ranked = items.mapIndexed { index, item ->
                val override = overrides.optJSONObject(item.optString("id")) ?: JSONObject()
                val pinned = override.optBoolean("pinned")
                val locked = override.optBoolean("locked")
                val importance = override.optInt("importance").coerceIn(0, 3)
                val days = try {
                    ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(item.optString("dueDate"))).toInt()
                } catch (_: Exception) {
                    null
                }
                val deadlineScore = when {
                    days == null -> 0
                    days < 0 -> 100
                    days == 0 -> 90
                    days == 1 -> 65
                    days <= 7 -> 35
                    else -> 10
                }
                val taskPriorityScore = when (item.optString("priority")) {
                    "Tinggi" -> 40
                    "Sedang" -> 20
                    else -> 0
                }
                val score = deadlineScore + taskPriorityScore + importance * 25 + if (pinned) 10_000 else 0
                val reason = when {
                    pinned -> "Disematkan manual"
                    days != null && days < 0 -> "Terlambat"
                    days == 0 -> "Tenggat hari ini"
                    days == 1 -> "Tenggat besok"
                    item.optString("priority") == "Tinggi" -> "Prioritas tinggi"
                    importance > 0 -> "Kepentingan manual $importance/3"
                    else -> "Prioritas normal"
                }
                RankedTask(item, index, score, reason, pinned, locked)
            }

            val movableOrder = if (smartEnabled) {
                ranked.filterNot { it.locked }.sortedWith(
                    compareByDescending<RankedTask> { it.score }
                        .thenBy { it.item.optString("dueDate") }
                        .thenBy { it.originalIndex }
                )
            } else {
                ranked.filterNot { it.locked }.sortedWith(
                    compareByDescending<RankedTask> { it.pinned }
                        .thenByDescending { overrides.optJSONObject(it.item.optString("id"))?.optInt("importance") ?: 0 }
                        .thenBy { it.originalIndex }
                )
            }
            val lockedPositions = ranked.filter { it.locked }.associateBy { it.originalIndex }
            val ordered = mutableListOf<RankedTask>()
            var movableIndex = 0
            ranked.indices.forEach { index ->
                ordered += lockedPositions[index] ?: movableOrder.getOrNull(movableIndex++)
                    ?: return@forEach
            }
            return ordered.map { task ->
                JSONObject(task.item.toString()).put(
                    "reason",
                    if (task.locked) "${task.reason} · Posisi dikunci" else task.reason
                )
            }
        }

        private fun nextAgenda(modules: JSONObject): JSONObject? =
            modules.optJSONObject("calendar")?.optJSONArray("items").asObjects()
                .firstOrNull { isUpcoming(it.optString("date")) }

        private fun isUpcoming(value: String): Boolean {
            return try {
                if (value.length == 10) LocalDate.parse(value) >= LocalDate.now()
                else {
                    val instant = try {
                        Instant.parse(value)
                    } catch (_: Exception) {
                        LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant()
                    }
                    instant.toEpochMilli() >= System.currentTimeMillis()
                }
            } catch (_: Exception) {
                false
            }
        }

        private fun moduleEnabled(modules: JSONObject, id: String): Boolean {
            val settings = modules.optJSONObject(id) ?: return false
            return settings.optBoolean("enabled") || settings.optBoolean("alwaysVisible")
        }

        private fun itemLimit(settings: JSONObject): Int {
            val configured = settings.optInt("itemLimit", 3).coerceIn(1, 10)
            return if (settings.optString("presentation") == "compact") minOf(configured, 1) else configured
        }

        private fun formatItem(
            moduleId: String,
            item: JSONObject,
            fields: Set<String>,
            showSensitiveInfo: Boolean
        ): List<String> {
            val lines = mutableListOf<String>()
            fun add(field: String, value: String) {
                if (field in fields && value.isNotBlank()) lines += value
            }
            when (moduleId) {
                "tasks" -> {
                    add("title", item.optString("title"))
                    add("dueDate", item.optString("dueDate").ifBlank { "Tanpa tenggat" })
                    add("priority", "${item.optString("reason")} · ${item.optString("priority")}")
                }
                "calendar", "reminders" -> {
                    add("title", item.optString("title"))
                    add("date", item.optString("date"))
                    if (moduleId == "calendar") add("type", item.optString("type"))
                }
                "goals" -> {
                    add("title", item.optString("title"))
                    add("saved", if (showSensitiveInfo) money(item.optDouble("saved")) else "••••••")
                    add("target", if (showSensitiveInfo) money(item.optDouble("target")) else "••••••")
                    add("progressPercent", "${item.optInt("progressPercent")}%")
                }
                "habits" -> {
                    add("title", item.optString("title"))
                    add("doneToday", if (item.optBoolean("doneToday")) "Selesai hari ini" else "Belum hari ini")
                }
                "productivity" -> {
                    add("completedTasks", "Tugas selesai: ${item.optInt("completedTasks")}")
                    add("pendingTasks", "Tugas aktif: ${item.optInt("pendingTasks")}")
                    add("completedHabits", "Habit hari ini: ${item.optInt("completedHabits")}")
                    add("totalHabits", "Jumlah habit: ${item.optInt("totalHabits")}")
                }
            }
            return lines
        }

        private fun financeSummary(
            modules: JSONObject,
            configuration: JSONObject,
            fields: Set<String>
        ): String {
            val finance = modules.optJSONObject("finance")?.optJSONArray("items").asObjects().firstOrNull()
                ?: return "Keuangan: data belum tersedia."
            val showSensitiveInfo = configuration.optBoolean("showSensitiveInfo")
            fun value(field: String, label: String, amount: Double): String? {
                if (field !in fields) return null
                return "$label ${if (showSensitiveInfo) money(amount) else "••••••"}"
            }
            val values = listOfNotNull(
                value("balance", "Saldo", finance.optDouble("balance")),
                value("monthIncome", "Masuk", finance.optDouble("monthIncome")),
                value("monthExpenses", "Keluar", finance.optDouble("monthExpenses")),
                value("monthlyBudget", "Anggaran", finance.optDouble("monthlyBudget"))
            )
            return if (values.isEmpty()) "Ringkasan keuangan disembunyikan oleh pengaturan."
            else "Keuangan: ${values.joinToString("; ")}."
        }

        private fun money(amount: Double): String =
            NumberFormat.getCurrencyInstance(Locale("id", "ID")).format(amount)

        private fun JSONArray?.asObjects(): List<JSONObject> {
            if (this == null) return emptyList()
            return (0 until length()).mapNotNull { index -> optJSONObject(index) }
        }

        private fun JSONArray?.asStrings(): List<String> {
            if (this == null) return emptyList()
            return (0 until length()).mapNotNull { index -> optString(index).takeIf { it.isNotBlank() } }
        }

        private fun parseJson(raw: String?): JSONObject? =
            try {
                raw?.let(::JSONObject)
            } catch (_: Exception) {
                null
            }
    }
}
