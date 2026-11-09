package com.example.timestamp;

import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "SharedImages")
public class SharedImagesPlugin extends Plugin {
    @PluginMethod
    public void takeNext(PluginCall call) {
        Uri uri = ((MainActivity) getActivity()).sharedImages.poll();
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new java.io.IOException("Missing image");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 20 * 1024 * 1024) throw new java.io.IOException("Image too large");
                output.write(buffer, 0, count);
            }
            String type = getContext().getContentResolver().getType(uri);
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            result.put("mime", type != null && type.startsWith("image/") ? type : "image/jpeg");
            call.resolve(result);
        } catch (Exception e) {
            call.resolve(new JSObject().put("failed", true));
        }
    }
}
