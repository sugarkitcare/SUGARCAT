package com.caremasters;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 파일 저장·공유 (v0.9.1)
 * Android WebView는 <a download>(blob:/data: URL)를 처리하지 않아 "저장 완료"만 뜨고 파일이 생기지 않았음.
 * - save : MediaStore로 공용 폴더에 저장 (권한 불필요, API 29+)
 *          이미지 → Pictures/CareMasters (갤러리 앨범), 그 외 → Download/CareMasters
 * - share: 저장된 uri 또는 base64 데이터를 공유 시트(카카오톡 등)로 전달
 */
@CapacitorPlugin(name = "CmFileSaver")
public class CmFileSaverPlugin extends Plugin {

    private static final String SUB_DIR = "CareMasters";

    private static String safeName(String name) {
        String n = (name == null || name.trim().isEmpty()) ? "caremasters_file" : name.trim();
        return n.replaceAll("[\\\\/:*?\"<>|\\n\\r\\t]", "_");
    }

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String mime = call.getString("mimeType", "application/octet-stream");
        String filename = safeName(call.getString("filename"));
        if (data == null) { call.reject("data 누락"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Android 9 이하는 공용 폴더 쓰기에 저장소 권한이 필요 → JS에서 공유 시트로 폴백
            call.reject("Android 10 미만은 직접 저장을 지원하지 않아요", "UNSUPPORTED");
            return;
        }
        boolean isImage = mime.startsWith("image/");
        Uri collection = isImage
                ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String relPath = (isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + SUB_DIR;

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relPath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            uri = resolver.insert(collection, values);
            if (uri == null) throw new Exception("MediaStore insert 실패");
            try (OutputStream os = resolver.openOutputStream(uri)) {
                if (os == null) throw new Exception("출력 스트림 열기 실패");
                os.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("folder", relPath);
            ret.put("isImage", isImage);
            call.resolve(ret);
        } catch (Exception e) {
            if (uri != null) {
                try { resolver.delete(uri, null, null); } catch (Exception ignore) {}
            }
            call.reject("저장 실패: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String mime = call.getString("mimeType", "application/octet-stream");
        String uriStr = call.getString("uri");
        String data = call.getString("data");
        String title = call.getString("title", "공유");
        String text = call.getString("text");
        try {
            Uri uri;
            if (uriStr != null) {
                uri = Uri.parse(uriStr);
            } else if (data != null) {
                File dir = new File(getContext().getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safeName(call.getString("filename")));
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(Base64.decode(data, Base64.DEFAULT));
                }
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            } else {
                call.reject("uri 또는 data 필요");
                return;
            }
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("공유 실패: " + e.getMessage(), e);
        }
    }
}
