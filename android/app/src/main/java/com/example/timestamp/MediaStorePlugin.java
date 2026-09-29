package com.example.timestamp;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "MediaStore")
public class MediaStorePlugin extends Plugin {
    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String displayName = call.getString("displayName", "Timestamp.jpg");
        String mimeType = call.getString("mimeType", "image/jpeg");

        if (data == null || data.isEmpty()) {
            call.reject("Image data is required");
            return;
        }

        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Timestamp");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            ContentResolver resolver = getContext().getContentResolver();
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Unable to create image in MediaStore");
                return;
            }

            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IOException("Unable to open image output stream");
                output.write(bytes);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, completed, null, null);
            }

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) getContext().getContentResolver().delete(uri, null, null);
            call.reject("Unable to save image to gallery", error);
        }
    }
}
