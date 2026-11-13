package com.sync.personal

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

class WidgetRefreshWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        return try {
            val manager = AppWidgetManager.getInstance(applicationContext)
            val component = ComponentName(applicationContext, WidgetProvider::class.java)
            manager.getAppWidgetIds(component).forEach {
                WidgetProvider.updateWidget(applicationContext, manager, it)
            }
            Result.success()
        } catch (error: Exception) {
            Log.e("SYNCWidget", "Periodic widget refresh failed.", error)
            Result.retry()
        }
    }
}
