package com.streamdeckhp.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        hideBars();
        // Tombol kembali: biarkan halaman web menutup lapisan atau mundur satu halaman. Keluar hanya kalau tidak ada yang bisa ditutup.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                try {
                    getBridge().getWebView().evaluateJavascript(
                        "(function(){try{return window.__back?window.__back():false}catch(e){return false}})()",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String v) {
                                if (!"true".equals(v)) finish();
                            }
                        });
                } catch (Exception e) {
                    finish();
                }
            }
        });
        try {
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void keepOn(final boolean on) {
                    runOnUiThread(new Runnable() {
                        public void run() {
                            if (on) {
                                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            } else {
                                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            }
                        }
                    });
                }

                @JavascriptInterface
                public String version() {
                    try {
                        return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                    } catch (Exception e) {
                        return "";
                    }
                }

                @JavascriptInterface
                public void installApk(String url) {
                    MainActivity.this.startInstall(url);
                }
            }, "GatitoNative");
        } catch (Exception e) {
        }
    }

    private volatile boolean dlBusy = false;

    private void toJs(final String code) {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    getBridge().getWebView().evaluateJavascript(code, null);
                } catch (Exception e) {
                }
            }
        });
    }

    // Unduh APK dari GitHub lalu buka penginstal Android. Android sendiri yang meminta konfirmasi pasang.
    private void startInstall(final String url) {
        if (dlBusy) return;
        if (url == null || !url.startsWith("https://github.com/")) {
            toJs("window.__dl&&window.__dl('fail')");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            toJs("window.__dl&&window.__dl('perm')");
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        startActivity(new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                    }
                }
            });
            return;
        }
        dlBusy = true;
        new Thread(new Runnable() {
            public void run() {
                boolean ok = false;
                try {
                    final File f = new File(getCacheDir(), "update.apk");
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true);
                    c.setRequestProperty("User-Agent", "gatito-stream-tool");
                    if (c.getResponseCode() == 200) {
                        long total = c.getContentLength(), got = 0;
                        int last = -1, n;
                        InputStream in = c.getInputStream();
                        FileOutputStream out = new FileOutputStream(f);
                        byte[] buf = new byte[32768];
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            got += n;
                            if (total > 0) {
                                int p = (int) Math.min(99, got * 100 / total);
                                if (p != last) {
                                    last = p;
                                    toJs("window.__dl&&window.__dl(" + p + ")");
                                }
                            }
                        }
                        out.close();
                        in.close();
                        ok = total <= 0 || got == total;
                    }
                    c.disconnect();
                    if (ok) {
                        runOnUiThread(new Runnable() {
                            public void run() {
                                try {
                                    Uri u = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f);
                                    Intent i = new Intent(Intent.ACTION_VIEW);
                                    i.setDataAndType(u, "application/vnd.android.package-archive");
                                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(i);
                                } catch (Exception e) {
                                    toJs("window.__dl&&window.__dl('fail')");
                                }
                            }
                        });
                        toJs("window.__dl&&window.__dl('done')");
                    }
                } catch (Exception e) {
                    ok = false;
                }
                dlBusy = false;
                if (!ok) toJs("window.__dl&&window.__dl('fail')");
            }
        }).start();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    private void hideBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
