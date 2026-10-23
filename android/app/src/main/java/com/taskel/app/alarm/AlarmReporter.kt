package com.taskel.app.alarm

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * WebView が動いていなくても、鳴動・停止・スヌーズをサーバーへ伝える。
 * 成功時の "stop" は、別の場所ですでに止まっているという意味なのでローカルも止める。
 * 通信失敗の鳴動だけはイベントに残し、次にアプリを開いたときの書き戻しに回す。
 */
object AlarmReporter {
    private const val TAG = "TaskelAlarmReporter"
    private const val MAX_ATTEMPTS = 4

    fun reportAsync(context: Context, alarmId: String, action: String, fireAt: Long? = null) {
        val app = context.applicationContext
        thread(name = "taskel-alarm-report", isDaemon = false) {
            var outcome: String? = null
            for (attempt in 1..MAX_ATTEMPTS) {
                outcome = runCatching { post(app, alarmId, action, fireAt) }.getOrNull()
                if (outcome != null) break
                if (attempt < MAX_ATTEMPTS) {
                    Thread.sleep(1_500L * attempt)
                }
            }
            if (outcome == "stop") {
                AlarmScheduler.cancel(app, alarmId)
                AlarmStore.removeAlarm(app, alarmId)
                AlarmFeedback.stopRinging(app, alarmId)
                Log.i(TAG, "Remote stop applied for $alarmId (action=$action)")
            } else if (outcome == null && action == "ring") {
                AlarmStore.recordEvent(app, alarmId, "ring")
                Log.w(TAG, "Ring report failed for $alarmId; queued for the next app open")
            } else {
                Log.i(TAG, "Alarm report $action for $alarmId -> ${outcome ?: "failed"}")
            }
        }
    }

    private fun post(context: Context, alarmId: String, action: String, fireAt: Long?): String? {
        val secret = AlarmStore.deviceSecret(context)
        val base = AlarmStore.apiBase(context).trimEnd('/')
        val connection = (URL("$base/api/device-alarms/report").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8_000
            readTimeout = 8_000
            instanceFollowRedirects = false
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-taskel-device-secret", secret)
        }
        val body = JSONObject().put("alarmId", alarmId).put("action", action)
        if (fireAt != null) body.put("fireAt", fireAt)
        connection.outputStream.use { stream ->
            stream.write(body.toString().toByteArray(Charsets.UTF_8))
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        if (code !in 200..299) {
            Log.w(TAG, "Alarm report HTTP $code for $alarmId ($action)")
            return null
        }
        val outcome = runCatching { JSONObject(text).optString("outcome", "") }.getOrDefault("")
        return outcome.takeIf { it == "ringing" || it == "stop" || it == "snoozed" } ?: "ringing"
    }
}
