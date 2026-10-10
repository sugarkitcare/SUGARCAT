package com.caremasters;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 로컬 플러그인은 super.onCreate 전에 등록해야 브릿지에 노출됨
        registerPlugin(CmFileSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
