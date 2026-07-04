package com.przemekplewka.cmrpro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

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
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient());

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> callback, FileChooserParams params) {
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

        // let PDF exports (blob/data downloads) save to the device
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                    String contentDisposition, String mimetype, long contentLength) {
                try {
                    if (url.startsWith("http")) {
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                        req.setMimeType(mimetype);
                        req.setDestinationInExternalPublicDir(
                                Environment.DIRECTORY_DOWNLOADS, "CMR.pdf");
                        req.setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) dm.enqueue(req);
                        Toast.makeText(getApplicationContext(), "Pobieranie PDF…", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception ignored) {}
            }
        });

        // Bundled offline build. To point at the live site instead, use:
        //   web.loadUrl("https://przemo092.github.io/Apk/");
        web.loadUrl("file:///android_asset/index.html");
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
