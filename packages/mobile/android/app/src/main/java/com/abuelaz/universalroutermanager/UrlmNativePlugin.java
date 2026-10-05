/**
 * UrlmNative — a deliberately tiny Capacitor plugin exposing only the three
 * things a WebView cannot do for a router manager:
 *
 *   1. info()     : OS network facts (default gateway, DNS, Wi-Fi link details).
 *   2. ping()     : a real socket reachability/latency probe.
 *   3. encrypt()/decrypt() : AES-256-GCM sealing with a key that lives inside the
 *                   Android Keystore and never leaves it — so a remembered
 *                   password is never written in plaintext.
 *
 * Everything router-specific (discovery, fingerprinting, adapters, verification)
 * stays in the portable TypeScript engine; this file intentionally has no
 * knowledge about any vendor.
 *
 * Security notes:
 *  - the Keystore key is created with PURPOSE_ENCRYPT|PURPOSE_DECRYPT only and is
 *    never exported (no getUserAuthenticationRequired, no exportable key);
 *  - no credential is logged here, ever;
 *  - probes are single-shot with a timeout: the app never floods a network.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

package com.abuelaz.universalroutermanager;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyStore;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "UrlmNative")
public class UrlmNativePlugin extends Plugin {

    private static final String KEY_ALIAS = "urlm_vault_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    /* ------------------------------------------------------------------ *
     * Capability probe
     * ------------------------------------------------------------------ */

    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("keystore", supportsKeystore());
        result.put("version", "1");
        result.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    private boolean supportsKeystore() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
    }

    /* ------------------------------------------------------------------ *
     * Network facts
     * ------------------------------------------------------------------ */

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();

        try {
            ConnectivityManager manager =
                    (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager != null) {
                Network active = manager.getActiveNetwork();
                LinkProperties properties = active == null ? null : manager.getLinkProperties(active);
                if (properties != null) {
                    for (RouteInfo route : properties.getRoutes()) {
                        if (route.isDefaultRoute() && route.getGateway() != null
                                && route.getGateway() instanceof Inet4Address) {
                            result.put("gateway", route.getGateway().getHostAddress());
                            break;
                        }
                    }
                    JSArray dns = new JSArray();
                    for (InetAddress server : properties.getDnsServers()) {
                        dns.put(server.getHostAddress());
                    }
                    result.put("dns", dns);
                }
            }
        } catch (Exception ignored) {
            // Facts we cannot read are simply absent — never an error for the UI.
        }

        try {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                WifiInfo wifiInfo = wifi.getConnectionInfo();
                if (wifiInfo != null) {
                    String ssid = wifiInfo.getSSID();
                    // Android returns the literal "<unknown ssid>" without a location grant.
                    if (ssid != null && !ssid.contains("unknown")) {
                        result.put("ssid", ssid.replace("\"", ""));
                    }
                    String bssid = wifiInfo.getBSSID();
                    if (bssid != null) result.put("bssid", bssid);
                    if (wifiInfo.getFrequency() > 0) result.put("frequencyMhz", wifiInfo.getFrequency());
                    if (wifiInfo.getLinkSpeed() > 0) result.put("linkSpeedMbps", wifiInfo.getLinkSpeed());
                }
            }
        } catch (Exception ignored) {
            // Wi-Fi details are optional hints.
        }

        call.resolve(result);
    }

    /* ------------------------------------------------------------------ *
     * Latency probe
     * ------------------------------------------------------------------ */

    @PluginMethod
    public void ping(PluginCall call) {
        String host = call.getString("host");
        if (host == null || host.isEmpty()) {
            call.reject("host is required");
            return;
        }
        Integer port = call.getInt("port", 80);
        Integer timeoutMs = call.getInt("timeoutMs", 2500);

        JSObject result = new JSObject();

        // 1) ICMP echo (works on most devices, no root needed for isReachable).
        try {
            InetAddress address = InetAddress.getByName(host);
            long started = System.nanoTime();
            if (address.isReachable(timeoutMs)) {
                long elapsed = (System.nanoTime() - started) / 1_000_000L;
                result.put("latencyMs", Math.max(1, elapsed));
                result.put("reachable", true);
                result.put("method", "icmp");
                call.resolve(result);
                return;
            }
        } catch (Exception ignored) {
            // fall through to the TCP probe
        }

        // 2) TCP connect time — the same thing a router feels when we open its UI.
        try {
            long started = System.nanoTime();
            Socket socket = new Socket();
            socket.connect(new java.net.InetSocketAddress(host, port == null ? 80 : port),
                    timeoutMs == null ? 2500 : timeoutMs);
            long elapsed = (System.nanoTime() - started) / 1_000_000L;
            socket.close();
            result.put("latencyMs", Math.max(1, elapsed));
            result.put("reachable", true);
            result.put("method", "tcp");
            call.resolve(result);
            return;
        } catch (Exception ignored) {
            result.put("latencyMs", 0);
            result.put("reachable", false);
            result.put("method", "tcp");
            call.resolve(result);
        }
    }

    /* ------------------------------------------------------------------ *
     * Keystore sealing (credentials at rest)
     * ------------------------------------------------------------------ */

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plaintext = call.getString("plaintext");
        if (plaintext == null) {
            call.reject("plaintext is required");
            return;
        }
        if (!supportsKeystore()) {
            call.reject("keystore-unavailable");
            return;
        }
        try {
            SecretKey key = secretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(plaintext.getBytes("UTF-8"));

            JSObject result = new JSObject();
            result.put(
                    "payload",
                    "v1:" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                            + Base64.encodeToString(sealed, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("encrypt-failed", error.getMessage(), error);
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null) {
            call.reject("payload is required");
            return;
        }
        if (!supportsKeystore()) {
            call.reject("keystore-unavailable");
            return;
        }
        try {
            String[] parts = payload.split(":");
            if (parts.length != 3 || !"v1".equals(parts[0])) {
                call.reject("payload-malformed");
                return;
            }
            byte[] iv = Base64.decode(parts[1], Base64.NO_WRAP);
            byte[] sealed = Base64.decode(parts[2], Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] opened = cipher.doFinal(sealed);

            JSObject result = new JSObject();
            result.put("plaintext", new String(opened, "UTF-8"));
            call.resolve(result);
        } catch (Exception error) {
            // A tampered or foreign blob fails closed: nothing is returned.
            call.reject("decrypt-failed", error.getMessage(), error);
        }
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(
                new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
        return generator.generateKey();
    }

    @SuppressWarnings("unused")
    private List<String> noop() {
        return null;
    }
}
