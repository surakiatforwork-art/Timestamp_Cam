package com.example.timestamp;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Durable photo storage, independent of WebView origin, quota and cache eviction. */
@CapacitorPlugin(name = "PhotoStorage")
public class PhotoStoragePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SQLiteOpenHelper helper;
    private static final int CHUNK_SIZE = 256 * 1024;

    @Override
    public void load() {
        helper = new SQLiteOpenHelper(getContext(), "timestamp-library.db", null, 1, database -> {
            // Android's default corruption handler deletes the database. Preserve it
            // for recovery and report an error instead of creating an empty library.
            throw new SQLiteDatabaseCorruptException("Photo library is damaged; original database preserved");
        }) {
            @Override
            public void onConfigure(SQLiteDatabase db) {
                db.setForeignKeyConstraintsEnabled(true);
                db.execSQL("PRAGMA synchronous=FULL");
            }

            @Override
            public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE photos (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, " +
                    "mime TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)");
                // Small rows avoid Android CursorWindow's per-row size limit for large photos.
                db.execSQL("CREATE TABLE image_chunks (photo_id TEXT NOT NULL REFERENCES photos(id) " +
                    "ON DELETE CASCADE, sequence INTEGER NOT NULL, data BLOB NOT NULL, " +
                    "PRIMARY KEY(photo_id, sequence))");
                db.execSQL("CREATE TABLE properties (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
                db.execSQL("CREATE TABLE storage_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, " +
                    "occurred_at INTEGER NOT NULL, operation TEXT NOT NULL, photo_ids TEXT)");
                db.execSQL("CREATE INDEX photos_deleted_at ON photos(deleted_at)");
            }

            @Override
            public void onOpen(SQLiteDatabase db) {
                super.onOpen(db);
                // Derived cache only. No schema changes to the original photo records.
                db.execSQL("CREATE TABLE IF NOT EXISTS photo_thumbnails (photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE, data BLOB NOT NULL)");
            }

            @Override
            public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                throw new IllegalStateException("Photo storage requires a non-destructive migration");
            }
        };
    }

    @PluginMethod
    public void execute(PluginCall call) {
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getWritableDatabase();
                db.beginTransaction();
                JSObject result;
                try {
                    result = perform(db, call);
                    String operation = call.getString("operation", "");
                    if (!operation.equals("read") && !operation.equals("summaries") && !operation.equals("list") && !operation.equals("status")) {
                        ContentValues event = new ContentValues();
                        event.put("occurred_at", System.currentTimeMillis());
                        event.put("operation", operation);
                        event.put("photo_ids", result.has("ids") ? result.getJSONArray("ids").toString()
                            : call.getArray("ids") != null ? call.getArray("ids").toString()
                            : call.getObject("record") != null ? call.getObject("record").getString("id") : call.getString("id"));
                        db.insertOrThrow("storage_events", null, event);
                        db.execSQL("DELETE FROM storage_events WHERE sequence <= (SELECT MAX(sequence)-1000 FROM storage_events)");
                    }
                    db.setTransactionSuccessful();
                } finally {
                    db.endTransaction();
                }
                // Resolve only after the transaction has committed, including the image bytes.
                call.resolve(result);
            } catch (Exception error) {
                android.util.Log.e("TimestampPhotoStorage", "Cannot complete " + call.getString("operation"), error);
                call.reject("Photo storage failed: " + error.getMessage(), error);
            }
        });
    }

    private JSObject perform(SQLiteDatabase db, PluginCall call) throws Exception {
        String operation = call.getString("operation", "");
        String id = call.getString("id", "");
        JSObject result = new JSObject();
        switch (operation) {
            case "status":
                try (Cursor cursor = db.rawQuery("SELECT value FROM properties WHERE name='legacy-import'", null)) {
                    result.put("migrated", cursor.moveToFirst());
                }
                try (Cursor cursor = db.rawQuery("SELECT value FROM properties WHERE name='legacy-active-import' OR name='legacy-import'", null)) {
                    result.put("activeMigrated", cursor.moveToFirst());
                }
                break;
            case "finishActiveMigration":
                db.execSQL("INSERT OR REPLACE INTO properties(name,value) VALUES('legacy-active-import','1')");
                break;
            case "finishMigration":
                db.execSQL("INSERT OR REPLACE INTO properties(name,value) VALUES('legacy-import','1')");
                break;
            case "list": {
                boolean trash = Boolean.TRUE.equals(call.getBoolean("trash", false));
                JSArray ids = new JSArray();
                if (!trash) {
                    for (String photoId : activeIds(db)) ids.put(photoId);
                } else {
                    try (Cursor cursor = db.rawQuery("SELECT id FROM photos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC", null)) {
                        while (cursor.moveToNext()) ids.put(cursor.getString(0));
                    }
                }
                result.put("ids", ids);
                break;
            }
            case "summaries": {
                JSArray ids = call.getArray("ids");
                if (ids == null || ids.length() > 32) throw new IllegalArgumentException("Invalid summary batch");
                JSArray summaries = new JSArray();
                for (int index = 0; index < ids.length(); index++) {
                    String photoId = ids.getString(index);
                    JSObject summary = new JSObject();
                    summary.put("record", requireMetadata(db, photoId));
                    byte[] thumb = thumbnail(db, photoId, null);
                    if (thumb != null) summary.put("thumbnail", Base64.encodeToString(thumb, Base64.NO_WRAP));
                    summaries.put(summary);
                }
                result.put("summaries", summaries);
                break;
            }
            case "read": {
                JSONObject metadata = readMetadata(db, id);
                if (metadata == null) break;
                byte[] image = readImage(db, id);
                result.put("record", metadata);
                result.put("image", Base64.encodeToString(image, Base64.NO_WRAP));
                try (Cursor cursor = db.rawQuery("SELECT mime FROM photos WHERE id=?", new String[]{id})) {
                    cursor.moveToFirst();
                    result.put("mime", cursor.getString(0));
                }
                break;
            }
            case "add":
            case "import": {
                JSObject record = call.getObject("record");
                if (record == null) throw new IllegalArgumentException("Missing photo metadata");
                id = record.getString("id");
                if (id == null || id.isEmpty()) throw new IllegalArgumentException("Missing photo ID");
                if (operation.equals("import") && readMetadata(db, id) != null) break;
                byte[] bytes = Base64.decode(call.getString("image", ""), Base64.DEFAULT);
                if (bytes.length == 0) throw new IllegalArgumentException("Empty photo");
                ContentValues values = new ContentValues();
                values.put("id", id);
                values.put("metadata", record.toString());
                values.put("mime", call.getString("mime", "image/jpeg"));
                values.put("created_at", record.getString("createdAtISO"));
                values.put("deleted_at", record.optString("deletedAtISO", null));
                db.insertOrThrow("photos", null, values);
                for (int offset = 0, sequence = 0; offset < bytes.length; offset += CHUNK_SIZE, sequence++) {
                    int length = Math.min(CHUNK_SIZE, bytes.length - offset);
                    byte[] chunk = new byte[length];
                    System.arraycopy(bytes, offset, chunk, 0, length);
                    ContentValues part = new ContentValues();
                    part.put("photo_id", id);
                    part.put("sequence", sequence);
                    part.put("data", chunk);
                    db.insertOrThrow("image_chunks", null, part);
                }
                if (operation.equals("add")) {
                    byte[] thumb = thumbnail(db, id, bytes);
                    if (thumb != null) result.put("thumbnail", Base64.encodeToString(thumb, Base64.NO_WRAP));
                }
                break;
            }
            case "updateBatch": {
                JSArray ids = call.getArray("ids");
                JSObject updates = call.getObject("updates");
                if (ids == null || ids.length() == 0 || updates == null || updates.length() == 0)
                    throw new IllegalArgumentException("Missing batch metadata");
                HashSet<String> allowed = new HashSet<>(java.util.Arrays.asList(
                    "timeMode", "timeValueISO", "locationLatitude", "locationLongitude",
                    "locationAddress", "locationDetails", "remark"));
                Iterator<String> fields = updates.keys();
                while (fields.hasNext()) if (!allowed.contains(fields.next()))
                    throw new IllegalArgumentException("Invalid batch metadata field");
                for (int index = 0; index < ids.length(); index++) {
                    String photoId = ids.getString(index);
                    JSONObject metadata = requireMetadata(db, photoId);
                    if (metadata.has("deletedAtISO")) throw new IllegalArgumentException("Photo is in trash");
                    Iterator<String> keys = updates.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        metadata.put(key, updates.get(key));
                    }
                    writeMetadata(db, photoId, metadata);
                }
                // execute() commits or rolls back the entire batch.
                break;
            }
            case "update": {
                JSONObject metadata = requireMetadata(db, id);
                JSObject updates = call.getObject("updates");
                if (updates == null) throw new IllegalArgumentException("Missing updates");
                Iterator<String> keys = updates.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    if (key.equals("id") || key.equals("deletedAtISO") || key.equals("baseBlob")) {
                        throw new IllegalArgumentException("Cannot update " + key);
                    }
                    metadata.put(key, updates.get(key));
                }
                writeMetadata(db, id, metadata);
                break;
            }
            case "trash":
            case "restore": {
                JSArray ids = call.getArray("ids");
                if (ids == null) throw new IllegalArgumentException("Missing photo IDs");
                List<String> order = activeIds(db);
                for (int index = 0; index < ids.length(); index++) {
                    String photoId = ids.getString(index);
                    JSONObject metadata = requireMetadata(db, photoId);
                    if (operation.equals("trash")) {
                        // Repeating a delete must not reset the retention clock.
                        if (!metadata.has("deletedAtISO")) metadata.put("deletedAtISO", call.getString("deletedAtISO"));
                        order.remove(photoId);
                    } else {
                        if (metadata.has("deletedAtISO")) {
                            metadata.remove("deletedAtISO");
                            order.remove(photoId);
                            order.add(photoId);
                        }
                    }
                    writeMetadata(db, photoId, metadata);
                }
                saveOrder(db, order);
                break;
            }
            case "reorder": {
                JSArray ids = call.getArray("ids");
                if (ids == null) throw new IllegalArgumentException("Missing photo IDs");
                List<String> current = activeIds(db);
                HashSet<String> currentSet = new HashSet<>(current);
                HashSet<String> seen = new HashSet<>();
                List<String> ordered = new ArrayList<>();
                for (int index = 0; index < ids.length(); index++) {
                    String photoId = ids.getString(index);
                    if (!currentSet.contains(photoId) || !seen.add(photoId)) throw new IllegalArgumentException("Invalid photo order");
                    ordered.add(photoId);
                }
                // Preserve photos captured while an order save was in flight.
                for (String photoId : current) if (seen.add(photoId)) ordered.add(photoId);
                saveOrder(db, ordered);
                break;
            }
            case "deleteTrash": {
                JSArray ids = call.getArray("ids");
                if (ids == null) throw new IllegalArgumentException("Missing photo IDs");
                for (int index = 0; index < ids.length(); index++) {
                    db.delete("photos", "id=? AND deleted_at IS NOT NULL", new String[]{ids.getString(index)});
                }
                break;
            }
            default:
                throw new IllegalArgumentException("Unknown operation: " + operation);
        }
        return result;
    }

    private byte[] readImage(SQLiteDatabase db, String id) throws Exception {
        ByteArrayOutputStream image = new ByteArrayOutputStream();
        try (Cursor cursor = db.rawQuery("SELECT data FROM image_chunks WHERE photo_id=? ORDER BY sequence", new String[]{id})) {
            while (cursor.moveToNext()) image.write(cursor.getBlob(0));
        }
        if (image.size() == 0) throw new IllegalStateException("Missing image bytes for " + id);
        return image.toByteArray();
    }

    private byte[] thumbnail(SQLiteDatabase db, String id, byte[] original) {
        try {
            try (Cursor cursor = db.rawQuery("SELECT data FROM photo_thumbnails WHERE photo_id=?", new String[]{id})) {
                if (cursor.moveToFirst()) return cursor.getBlob(0);
            }
            byte[] bytes = original != null ? original : readImage(db,id);
            android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if (options.outWidth <= 0 || options.outHeight <= 0) return null;
            options.inJustDecodeBounds = false;
            options.inSampleSize = 1;
            while (Math.max(options.outWidth,options.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2;
            android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if (bitmap == null) return null;
            android.graphics.Bitmap small = bitmap;
            try {
                float scale = Math.min(1f, 256f / Math.max(bitmap.getWidth(),bitmap.getHeight()));
                if (scale < 1f) small = android.graphics.Bitmap.createScaledBitmap(bitmap, Math.max(1,Math.round(bitmap.getWidth()*scale)),Math.max(1,Math.round(bitmap.getHeight()*scale)),true);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (!small.compress(android.graphics.Bitmap.CompressFormat.JPEG,82,output)) return null;
                byte[] data = output.toByteArray();
                ContentValues values = new ContentValues();
                values.put("photo_id",id);values.put("data",data);
                db.insertWithOnConflict("photo_thumbnails",null,values,SQLiteDatabase.CONFLICT_REPLACE);
                return data;
            } finally {
                if(small != bitmap) small.recycle();
                bitmap.recycle();
            }
        } catch (Exception | OutOfMemoryError error) {
            // A derived preview must never prevent access to or saving an original.
            android.util.Log.w("TimestampPhotoStorage","Thumbnail unavailable: "+id,error);
            return null;
        }
    }

    private List<String> activeIds(SQLiteDatabase db) throws Exception {
        java.util.LinkedHashSet<String> remaining = new java.util.LinkedHashSet<>();
        try (Cursor cursor = db.rawQuery("SELECT id FROM photos WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC", null)) {
            while (cursor.moveToNext()) remaining.add(cursor.getString(0));
        }
        List<String> ordered = new ArrayList<>();
        try (Cursor cursor = db.rawQuery("SELECT value FROM properties WHERE name='photo-order'", null)) {
            if (cursor.moveToFirst()) {
                JSONArray saved = new JSONArray(cursor.getString(0));
                for (int index = 0; index < saved.length(); index++) {
                    String id = saved.getString(index);
                    if (remaining.remove(id)) ordered.add(id);
                }
            }
        }
        ordered.addAll(remaining);
        return ordered;
    }

    private void saveOrder(SQLiteDatabase db, List<String> ids) {
        ContentValues values = new ContentValues();
        values.put("name", "photo-order");
        values.put("value", new JSONArray(ids).toString());
        db.insertWithOnConflict("properties", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private JSONObject readMetadata(SQLiteDatabase db, String id) throws Exception {
        try (Cursor cursor = db.rawQuery("SELECT metadata FROM photos WHERE id=?", new String[]{id})) {
            return cursor.moveToFirst() ? new JSONObject(cursor.getString(0)) : null;
        }
    }

    private JSONObject requireMetadata(SQLiteDatabase db, String id) throws Exception {
        JSONObject metadata = readMetadata(db, id);
        if (metadata == null) throw new IllegalArgumentException("Photo not found: " + id);
        return metadata;
    }

    private void writeMetadata(SQLiteDatabase db, String id, JSONObject metadata) {
        ContentValues values = new ContentValues();
        values.put("metadata", metadata.toString());
        values.put("created_at", metadata.optString("createdAtISO"));
        values.put("deleted_at", metadata.optString("deletedAtISO", null));
        db.update("photos", values, "id=?", new String[]{id});
    }

    @Override
    protected void handleOnDestroy() {
        executor.execute(() -> helper.close());
        executor.shutdown();
    }
}
