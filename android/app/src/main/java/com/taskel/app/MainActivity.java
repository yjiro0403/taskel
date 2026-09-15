package com.taskel.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.taskel.app.alarm.TaskelAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ローカルプラグインは super.onCreate() より前に登録する（Capacitor の規約）
        registerPlugin(TaskelAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
