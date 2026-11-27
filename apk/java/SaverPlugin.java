package com.aavetements.atelierstock;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** Téléchargement direct : photos → Galerie (Pictures/Atelier Stock), autres fichiers → Téléchargements. */
@CapacitorPlugin(name = "Saver")
public class SaverPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        final String data = call.getString("data", "");
        final String name = call.getString("name", "fichier");
        final String mime = call.getString("mime", "application/octet-stream");
        if (Build.VERSION.SDK_INT < 29) { call.reject("android-trop-ancien"); return; }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                boolean img = mime.startsWith("image/"), vid = mime.startsWith("video/");
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                String dir = img ? Environment.DIRECTORY_PICTURES : vid ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS;
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/Atelier Stock");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri col = img ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : vid ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri uri = cr.insert(col, v);
                if (uri == null) throw new Exception("insert");
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(bytes); }
                v.clear();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                JSObject r = new JSObject();
                r.put("uri", uri.toString());
                r.put("where", img || vid ? "gallery" : "downloads");
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }
}
