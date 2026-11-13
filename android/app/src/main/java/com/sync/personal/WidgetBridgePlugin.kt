package com.sync.personal

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {
    @PluginMethod
    fun syncWidgetData(call: PluginCall) {
        val snapshot = call.getObject("snapshot")
        val configuration = call.getObject("configuration")
        if (snapshot == null || configuration == null || snapshot.optInt("schemaVersion") != 1) {
            call.reject("Snapshot widget tidak valid.")
            return
        }

        try {
            val stored = context.getSharedPreferences(WidgetProvider.PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(WidgetProvider.SNAPSHOT_KEY, snapshot.toString())
                .putString(WidgetProvider.CONFIGURATION_KEY, configuration.toString())
                .commit()
            if (!stored) {
                call.reject("Snapshot widget tidak dapat disimpan di penyimpanan aplikasi.")
                return
            }

            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, WidgetProvider::class.java)
            val widgetIds = manager.getAppWidgetIds(component)
            widgetIds.forEach { WidgetProvider.updateWidget(context, manager, it) }
            WidgetProvider.scheduleRefresh(context, configuration.optInt("refreshMinutes", 30))

            call.resolve(JSObject().apply {
                put("updatedAt", snapshot.optString("updatedAt"))
                put("widgetCount", widgetIds.size)
            })
        } catch (error: Exception) {
            call.reject("Pembaruan widget gagal.", error)
        }
    }
}
