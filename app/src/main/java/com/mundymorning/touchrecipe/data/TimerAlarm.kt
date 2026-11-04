package com.mundymorning.touchrecipe.data

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.mundymorning.touchrecipe.MainActivity
import com.mundymorning.touchrecipe.R

const val TIMER_CHANNEL = "cook_timer"

/** Schedules an inexact, permission-free alarm so a finished timer can still notify while the app is in the background. */
object TimerAlarm {
    private fun pending(context: Context, recipeId: String, title: String?): PendingIntent =
        PendingIntent.getBroadcast(context, recipeId.hashCode(), Intent(context, TimerReceiver::class.java).putExtra("recipeId", recipeId).putExtra("title", title),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun schedule(context: Context, recipeId: String, title: String, endAtMs: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAtMs, pending(context, recipeId, title))
    }

    fun cancel(context: Context, recipeId: String) {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(context, recipeId, null))
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(TIMER_CHANNEL) == null)
                nm.createNotificationChannel(NotificationChannel(TIMER_CHANNEL, context.getString(R.string.timer_channel), NotificationManager.IMPORTANCE_HIGH))
        }
    }
}

class TimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        TimerAlarm.ensureChannel(context)
        val nm = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, TIMER_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(context.getString(R.string.timer_done_title))
            .setContentText(intent.getStringExtra("title") ?: context.getString(R.string.timer_done_text))
            .setAutoCancel(true).setContentIntent(open).setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        nm.notify(intent.getStringExtra("recipeId").hashCode(), n)
    }
}
