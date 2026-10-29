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
                    if (!operation.equals("read") && !operation.equals("list") && !operation.equals("status")) {
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
            case "read": {
                JSONObject metadata = readMetadata(db, id);
                if (metadata == null) break;
                ByteArrayOutputStream image = new ByteArrayOutputStream();
                try (Cursor cursor = db.rawQuery("SELECT data FROM image_chunks WHERE photo_id=? ORDER BY sequence", new String[]{id})) {
                    while (cursor.moveToNext()) image.write(cursor.getBlob(0));
                }
                if (image.size() == 0) throw new IllegalStateException("Missing image bytes for " + id);
                result.put("record", metadata);
                result.put("image", Base64.encodeToString(image.toByteArray(), Base64.NO_WRAP));
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
                HashSet<String> seen = new HashSet<>();
                List<String> ordered = new ArrayList<>();
                for (int index = 0; index < ids.length(); index++) {
                    String photoId = ids.getString(index);
                    if (!current.contains(photoId) || !seen.add(photoId)) throw new IllegalArgumentException("Invalid photo order");
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

    private List<String> activeIds(SQLiteDatabase db) throws Exception {
        List<String> remaining = new ArrayList<>();
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
