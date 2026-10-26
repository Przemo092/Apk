package com.przemekplewka.cmrpro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * CMR PRO — Android WebView wrapper.
 *
 * Loads the bundled web app from app/src/main/assets/index.html.
 * Everything (localStorage, layout sync, PDF, print, GPS, file pickers)
 * runs inside the WebView exactly as in the browser build.
 */
public class MainActivity extends AppCompatActivity {

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<String> filePicker;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        filePicker = registerForActivityResult(
                new ActivityResultContracts.GetContent(),
                uri -> {
                    if (filePathCallback != null) {
                        filePathCallback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
                        filePathCallback = null;
                    }
                });

        // location permission for the GPS / nearby-company features
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 1);
            }
        }

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage — the app relies on it
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        // file:///android_asset/ is NOT governed by this flag (Android docs) — it
        // only controls access to the rest of the file system, so keep it off.
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // the app only talks to https:// endpoints (OSM Nominatim / Overpass)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);

        // JS → native bridge used to save / share generated PDFs.
        // Only the app's own pages may stay in this WebView (see client below).
        web.addJavascriptInterface(new FileBridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (isTrustedUrl(url)) return false;            // stay in the app
                try {                                           // anything else → system browser
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {}
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // The app never uses camera / microphone (file inputs go through
                // onShowFileChooser). Granting everything was unnecessary exposure.
                request.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);  // cancel stale request
                filePathCallback = callback;
                try {
                    filePicker.launch("*/*");
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Plain http(s) downloads only. Generated files (PDF / backup / CSV) are
        // blob: URLs, which DownloadListener cannot read — the web app sends
        // those through AndroidBridge instead.
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                    String contentDisposition, String mimetype, long contentLength) {
                try {
                    if (url.startsWith("https://") || url.startsWith("http://")) {
                        String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                        if (mimetype != null) req.setMimeType(mimetype);
                        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                        req.setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) dm.enqueue(req);
                        Toast.makeText(getApplicationContext(), "Pobieranie…", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(getApplicationContext(),
                                "Nie można pobrać tego pliku — użyj przycisku w aplikacji",
                                Toast.LENGTH_LONG).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(getApplicationContext(), "Pobieranie nie powiodło się",
                            Toast.LENGTH_LONG).show();
                }
            }
        });

        // Bundled offline build. To point at the live site instead, use:
        //   web.loadUrl("https://przemo092.github.io/Apk/");
        web.loadUrl("file:///android_asset/index.html");
    }

    /** Pages allowed to stay inside the WebView (and talk to AndroidBridge). */
    private static boolean isTrustedUrl(String url) {
        return url.startsWith("file:///android_asset/")
                || url.startsWith("https://przemo092.github.io/")
                || url.startsWith("about:blank");
    }

    /**
     * JS → native file bridge (window.AndroidBridge).
     *
     * The web app streams a generated PDF in base64 chunks:
     *   beginFile(name, mime) → appendChunk(b64) × N → finishFile()
     * Chunks go straight to a temp file in the app cache (no big strings kept
     * in memory). finishFile() then
     *   1. (Android 10+) copies the PDF to the public Downloads folder via
     *      MediaStore — no storage permission needed,
     *   2. opens the Android share sheet for the file (FileProvider), so the
     *      user can open / save / send it from there.
     * Only application/pdf is accepted. Methods run on a WebView binder
     * thread, hence synchronized + runOnUiThread for the chooser.
     */
    private class FileBridge {
        private static final long MAX_BYTES = 40L * 1024 * 1024;
        private File tmp;
        private OutputStream out;
        private String name;
        private long written;

        private String cleanName(String raw) {
            String n = raw == null ? "" : raw.replaceAll("[^A-Za-z0-9._-]", "_");
            if (n.length() > 80) n = n.substring(0, 80);
            if (!n.toLowerCase(Locale.ROOT).endsWith(".pdf")) n = n + ".pdf";
            if (n.startsWith(".")) n = "CMR" + n;
            return n;
        }

        private void closeQuietly() {
            try { if (out != null) out.close(); } catch (IOException ignored) {}
            out = null;
        }

        @JavascriptInterface
        public synchronized boolean beginFile(String fileName, String mime) {
            try {
                abortFile();
                if (!"application/pdf".equals(mime)) return false;
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) return false;
                // housekeeping: drop files older than a day
                File[] old = dir.listFiles();
                if (old != null) {
                    long limit = System.currentTimeMillis() - 24L * 3600 * 1000;
                    for (File f : old) {
                        if (f.lastModified() < limit) f.delete();
                    }
                }
                name = cleanName(fileName);
                tmp = new File(dir, name);
                out = new FileOutputStream(tmp, false);
                written = 0;
                return true;
            } catch (Exception e) {
                closeQuietly();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean appendChunk(String base64) {
            if (out == null || base64 == null) return false;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                written += data.length;
                if (written > MAX_BYTES) { abortFile(); return false; }
                out.write(data);
                return true;
            } catch (Exception e) {
                abortFile();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void abortFile() {
            closeQuietly();
            if (tmp != null) {
                tmp.delete();
                tmp = null;
            }
        }

        /** @return "SAVED" | "SHARED_ONLY" | "ERROR: reason" */
        @JavascriptInterface
        public synchronized String finishFile() {
            if (out == null || tmp == null) return "ERROR: brak pliku";
            try {
                out.flush();
                closeQuietly();
                if (written < 100) { abortFile(); return "ERROR: pusty plik"; }

                boolean saved = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saved = saveToDownloads(tmp, name);
                }
                final Uri shareUri = FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", tmp);
                final String title = name;
                tmp = null;   // handed over to the share sheet — must not be deleted by the next beginFile()
                runOnUiThread(() -> shareFile(shareUri, title));
                return saved ? "SAVED" : "SHARED_ONLY";
            } catch (Exception e) {
                abortFile();
                return "ERROR: " + e.getClass().getSimpleName();
            }
        }
    }

    /** Android 10+: copy into public Downloads through MediaStore (no permission needed). */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private boolean saveToDownloads(File src, String displayName) {
        Uri item = null;
        ContentResolver resolver = getContentResolver();
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (item == null) return false;
            try (InputStream in = new FileInputStream(src);
                 OutputStream os = resolver.openOutputStream(item)) {
                if (os == null) throw new IOException("no stream");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(item, done, null, null);
            return true;
        } catch (Exception e) {
            if (item != null) {
                try { resolver.delete(item, null, null); } catch (Exception ignored) {}
            }
            return false;
        }
    }

    /** Android share sheet for the generated PDF (open / save / send). */
    private void shareFile(Uri uri, String title) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/pdf");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.setClipData(ClipData.newRawUri(title, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "CMR — zapisz / wyślij PDF"));
        } catch (Exception e) {
            Toast.makeText(getApplicationContext(),
                    "Nie można otworzyć okna udostępniania", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(@Nullable Bundle inState) {
        super.onRestoreInstanceState(inState);
        if (web != null && inState != null) web.restoreState(inState);
    }
}
