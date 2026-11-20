package id.alfiandi.pdfsigner;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Pembungkus WebView untuk aplikasi PDF Signer.
 *
 * Aplikasi web dilayani dari aset lokal melalui
 * https://appassets.androidplatform.net/assets/index.html agar worker PDF.js,
 * fetch, dan modul lokal berjalan seperti di http://localhost.
 */
public class MainActivity extends Activity {

    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/index.html";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_STORAGE = 1002;
    private static final int REQ_CAMERA = 1003;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileChooserCallback;
    private PermissionRequest pendingCameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                              WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handlePermissionRequest(request));
            }

            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });

        webView.addJavascriptInterface(new SaveBridge(), "PdfSignerAndroid");
        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Android 9 ke bawah butuh izin untuk menulis ke folder Download publik.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        }

        webView.loadUrl(APP_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileChooserCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * Izinkan akses kamera untuk fitur scan dokumen di WebView.
     */
    private void handlePermissionRequest(PermissionRequest request) {
        boolean wantsVideo = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                wantsVideo = true;
                break;
            }
        }
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingCameraRequest != null) {
            pendingCameraRequest.deny();
        }
        pendingCameraRequest = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_CAMERA) {
            if (pendingCameraRequest != null) {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingCameraRequest.deny();
                }
                pendingCameraRequest = null;
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            exitApp();
            return;
        }
        // Tutup overlay pemindai lebih dulu, baru navigasi/keluar.
        webView.evaluateJavascript(
                "(function(){try{return !!(window.DocScanner && window.DocScanner.handleBack());}"
                        + "catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        exitApp();
                    }
                });
    }

    private void exitApp() {
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingCameraRequest != null) {
            pendingCameraRequest.deny();
            pendingCameraRequest = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("PdfSignerAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * Jembatan untuk menyimpan PDF hasil ekspor. Data dikirim bertahap
     * (base64 per potongan) agar file besar tidak membebani memori.
     */
    private class SaveBridge {

        private File tempFile;
        private OutputStream output;
        private String pendingName;
        private String lastError;

        @JavascriptInterface
        public synchronized boolean beginSave(String name) {
            closeQuietly();
            deleteQuietly();
            lastError = null;
            pendingName = safeFileName(name);
            try {
                tempFile = File.createTempFile("pdf-signer-", ".pdf", getCacheDir());
                output = new BufferedOutputStream(new FileOutputStream(tempFile), 64 * 1024);
                return true;
            } catch (IOException e) {
                lastError = e.getMessage();
                closeQuietly();
                deleteQuietly();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean writeChunk(String base64) {
            if (output == null || base64 == null) return false;
            try {
                byte[] data = Base64.decode(base64, Base64.NO_WRAP);
                output.write(data);
                return true;
            } catch (Exception e) {
                lastError = e.getMessage();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized String endSave() {
            if (output == null || tempFile == null) {
                return "Gagal menyimpan: sesi penyimpanan tidak aktif";
            }
            try {
                output.flush();
                output.close();
                output = null;
                final String message = publish(tempFile, pendingName);
                runOnUiThread(() ->
                        Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
                return message;
            } catch (Exception e) {
                lastError = e.getMessage() != null ? e.getMessage() : "kesalahan tidak diketahui";
                return "Gagal menyimpan PDF: " + lastError;
            } finally {
                closeQuietly();
                deleteQuietly();
            }
        }

        private String publish(File source, String name) throws IOException {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/PDF Signer");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                Uri target = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (target == null) {
                    throw new IOException("folder Download tidak tersedia");
                }
                try (InputStream in = new FileInputStream(source);
                     OutputStream out = getContentResolver().openOutputStream(target)) {
                    if (out == null) throw new IOException("tidak bisa membuka file tujuan");
                    copy(in, out);
                } catch (IOException e) {
                    getContentResolver().delete(target, null, null);
                    throw e;
                }

                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(target, done, null, null);
                return "Tersimpan di Download/PDF Signer/" + name;
            }

            File dir;
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED) {
                dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS), "PDF Signer");
            } else {
                dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getFilesDir();
            }
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("tidak bisa membuat folder " + dir);
            }

            File target = uniqueFile(dir, name);
            try (InputStream in = new FileInputStream(source);
                 OutputStream out = new FileOutputStream(target)) {
                copy(in, out);
            }
            return "Tersimpan di " + target.getAbsolutePath();
        }

        private File uniqueFile(File dir, String name) {
            File candidate = new File(dir, name);
            if (!candidate.exists()) return candidate;
            String base = name;
            String suffix = "";
            int dot = name.lastIndexOf('.');
            if (dot > 0) {
                base = name.substring(0, dot);
                suffix = name.substring(dot);
            }
            for (int i = 1; i < 1000; i++) {
                File next = new File(dir, base + " (" + i + ")" + suffix);
                if (!next.exists()) return next;
            }
            return candidate;
        }

        private String safeFileName(String name) {
            String clean = name == null ? "" : name.trim();
            clean = clean.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "-");
            if (clean.isEmpty()) clean = "dokumen-signed.pdf";
            if (!clean.toLowerCase().endsWith(".pdf")) clean += ".pdf";
            return clean;
        }

        private void copy(InputStream in, OutputStream out) throws IOException {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }

        private void closeQuietly() {
            if (output != null) {
                try {
                    output.close();
                } catch (IOException ignored) {
                }
                output = null;
            }
        }

        private void deleteQuietly() {
            if (tempFile != null) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
                tempFile = null;
            }
        }
    }
}
