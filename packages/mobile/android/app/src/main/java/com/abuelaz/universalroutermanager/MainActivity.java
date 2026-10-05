package com.abuelaz.universalroutermanager;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Universal Router Manager — Android entry point.
 *
 * Registers the tiny companion plugin (OS gateway, socket latency probe, and
 * Android Keystore sealing for remembered credentials) before the Capacitor
 * bridge starts, so the web layer can use it from the first frame.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UrlmNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
