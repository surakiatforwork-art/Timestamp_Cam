package com.example.timestamp;

import static org.junit.Assert.*;

import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class PhotoStorageTest {
    private Context context;
    private PhotoStoragePlugin plugin;

    private PhotoStoragePlugin open() {
        PhotoStoragePlugin instance = new PhotoStoragePlugin() {
            @Override public Context getContext() { return context; }
        };
        instance.load();
        return instance;
    }

    @Before public void before() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase("timestamp-library.db");
        plugin = open();
    }

    @After public void after() throws Exception {
        close();
    }

    private void close() throws Exception {
        // The shutdown is queued after every prior request, including commits.
        java.lang.reflect.Field field = PhotoStoragePlugin.class.getDeclaredField("executor");
        field.setAccessible(true);
        java.util.concurrent.ExecutorService executor = (java.util.concurrent.ExecutorService) field.get(plugin);
        plugin.handleOnDestroy();
        assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
    }

    private JSObject execute(JSObject data) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        JSObject[] result = new JSObject[1];
        Exception[] failure = new Exception[1];
        plugin.execute(new PluginCall(null, "PhotoStorage", "test", "execute", data) {
            @Override public void resolve(JSObject value) { result[0] = value; done.countDown(); }
            @Override public void reject(String message, Exception exception) { failure[0] = exception; done.countDown(); }
        });
        assertTrue("Storage request timed out", done.await(30, TimeUnit.SECONDS));
        if (failure[0] != null) throw failure[0];
        return result[0];
    }

    private JSObject request(String operation) { return new JSObject().put("operation", operation); }

    private JSObject photo(String id, byte[] image) {
        JSObject record = new JSObject().put("id", id).put("createdAtISO", "2026-01-01T00:00:00.000Z")
            .put("timeValueISO", "2026-10-15T03:10:22.000Z").put("remark", "original");
        return request("add").put("record", record).put("mime", "image/jpeg")
            .put("image", Base64.encodeToString(image, Base64.NO_WRAP));
    }

    private JSObject transition(String operation, String... ids) {
        return request(operation).put("ids", new JSArray(java.util.Arrays.asList(ids)));
    }

    private int count(boolean trash) throws Exception {
        return execute(request("list").put("trash", trash)).getJSONArray("ids").length();
    }

    @Test public void largeOriginalSurvivesReopenAndWebViewDeletion() throws Exception {
        byte[] image = new byte[3 * 1024 * 1024 + 17];
        new java.util.Random(17).nextBytes(image);
        execute(photo("large", image));
        close();
        File webview = new File(context.getDataDir(), "app_webview");
        deleteTree(webview);
        plugin = open();
        assertEquals(1, count(false));
        JSObject stored = execute(request("read").put("id", "large"));
        assertArrayEquals(image, Base64.decode(stored.getString("image"), Base64.DEFAULT));
        assertEquals("2026-10-15T03:10:22.000Z", stored.getJSONObject("record").getString("timeValueISO"));
    }

    private void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists()) assertTrue(file.delete());
    }

    @Test public void metadataEditsDoNotChangeOriginalBytes() throws Exception {
        byte[] image = {1, 2, 3, 4};
        execute(photo("edit", image));
        execute(request("update").put("id", "edit").put("updates", new JSObject()
            .put("remark", "edited").put("locationLatitude", 13.85).put("timeValueISO", "2026-10-15T03:14:59.000Z")));
        JSObject stored = execute(request("read").put("id", "edit"));
        assertArrayEquals(image, Base64.decode(stored.getString("image"), Base64.DEFAULT));
        assertEquals("edited", stored.getJSONObject("record").getString("remark"));
        assertEquals(13.85, stored.getJSONObject("record").getDouble("locationLatitude"), 0.00001);
    }

    @Test public void oldTrashNeverExpiresAndRestoreMakesPhotoEditable() throws Exception {
        for (String id : new String[]{"active", "expired", "recent", "boundary", "restored"}) execute(photo(id, new byte[]{1}));
        execute(transition("trash", "expired", "restored").put("deletedAtISO", "2026-09-01T00:00:00.000Z"));
        execute(transition("trash", "recent").put("deletedAtISO", "2026-10-15T00:00:00.000Z"));
        execute(transition("trash", "boundary").put("deletedAtISO", "2026-09-15T00:00:00.000Z"));
        execute(transition("restore", "restored"));
        try {
            execute(request("purge").put("cutoff", "2099-01-01T00:00:00.000Z"));
            fail("Automatic purge must no longer be available");
        } catch (IllegalArgumentException expected) {
            // Even a stale caller cannot invoke automatic age-based deletion.
        }
        assertEquals(2, count(false));
        assertEquals(3, count(true));
        close();
        plugin = open();
        assertEquals(3, count(true));
        execute(request("update").put("id", "restored").put("updates", new JSObject().put("remark", "restored edit")));
        execute(transition("deleteTrash", "active", "recent"));
        assertEquals(2, count(false));
        assertEquals(2, count(true));
    }

    @Test public void orderSurvivesRestartAndRestoredOrNewPhotosAppend() throws Exception {
        for (String id : new String[]{"a", "b", "c"}) execute(photo(id, new byte[]{1, 2}));
        execute(transition("reorder", "c", "a", "b"));
        close();
        plugin = open();
        assertEquals("[\"c\",\"a\",\"b\"]", execute(request("list")).getJSONArray("ids").toString());
        execute(transition("trash", "a").put("deletedAtISO", "2020-01-01T00:00:00.000Z"));
        execute(transition("restore", "a"));
        execute(photo("d", new byte[]{3}));
        assertEquals("[\"c\",\"b\",\"a\",\"d\"]", execute(request("list")).getJSONArray("ids").toString());
        try {
            execute(transition("reorder", "c", "c"));
            fail("Duplicate IDs must not corrupt the saved order");
        } catch (IllegalArgumentException expected) {
            assertEquals(4, count(false));
        }
        execute(transition("reorder", "b", "c", "a"));
        assertEquals("[\"b\",\"c\",\"a\",\"d\"]", execute(request("list")).getJSONArray("ids").toString());
    }

    @Test public void failedBulkOperationRollsBackEveryPhoto() throws Exception {
        execute(photo("first", new byte[]{9}));
        try {
            execute(transition("trash", "first", "missing").put("deletedAtISO", "2026-10-15T00:00:00.000Z"));
            fail("Missing photo should reject the transaction");
        } catch (IllegalArgumentException expected) {
            assertEquals(1, count(false));
            assertEquals(0, count(true));
        }
        try {
            execute(photo("empty", new byte[0]));
            fail("Empty image should never be committed");
        } catch (IllegalArgumentException expected) {
            assertEquals(1, count(false));
        }
    }

    @Test public void interruptedMigrationCanRetryWithoutOverwritingEdits() throws Exception {
        assertFalse(execute(request("status")).getBoolean("migrated"));
        execute(photo("legacy", new byte[]{5}).put("operation", "import"));
        execute(request("update").put("id", "legacy").put("updates", new JSObject().put("remark", "newer edit")));
        close();
        plugin = open();
        execute(photo("legacy", new byte[]{6}).put("operation", "import"));
        assertEquals(1, count(false));
        JSObject stored = execute(request("read").put("id", "legacy"));
        assertEquals("newer edit", stored.getJSONObject("record").getString("remark"));
        assertArrayEquals(new byte[]{5}, Base64.decode(stored.getString("image"), Base64.DEFAULT));
        execute(request("finishMigration"));
        close();
        plugin = open();
        assertTrue(execute(request("status")).getBoolean("migrated"));
    }

    @Test public void damagedDatabaseIsReportedAndPreservedInsteadOfReset() throws Exception {
        execute(photo("preserve", new byte[]{7}));
        close();
        File database = context.getDatabasePath("timestamp-library.db");
        try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(database, "rw")) {
            file.write(new byte[100]);
        }
        byte[] before = java.nio.file.Files.readAllBytes(database.toPath());
        plugin = open();
        try {
            execute(request("status"));
            fail("A corrupt library must not be silently replaced with an empty one");
        } catch (android.database.sqlite.SQLiteException expected) {
            assertArrayEquals(before, java.nio.file.Files.readAllBytes(database.toPath()));
        }
    }

    public static class FixtureCallback {
        final CountDownLatch done = new CountDownLatch(1);
        String error;
        @JavascriptInterface public void finish(String message) { error = message; done.countDown(); }
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] result = new String[1];
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result[0] = value;
            done.countDown();
        }));
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return result[0];
    }

    @Test public void appMigratesRealIndexedDbAndKeepsLibraryAfterItsRemoval() throws Exception {
        FixtureCallback callback = new FixtureCallback();
        WebView[] fixture = new WebView[1];
        // Dexie represents schema version 2 as native IndexedDB version 20.
        String seed = "(async()=>{try{const db=await new Promise((ok,no)=>{const r=indexedDB.open('timestamp-photos',20);"
            + "r.onupgradeneeded=()=>{const p=r.result.createObjectStore('photos',{keyPath:'id'});p.createIndex('createdAtISO','createdAtISO');"
            + "const t=r.result.createObjectStore('trash',{keyPath:'id'});t.createIndex('deletedAtISO','deletedAtISO');};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});"
            + "const tx=db.transaction(['photos','trash'],'readwrite');tx.objectStore('photos').clear();tx.objectStore('trash').clear();"
            + "const p={id:'webview-original',baseBlob:new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'}),width:1,height:1,"
            + "createdAtISO:new Date().toISOString(),timeMode:'custom',timeValueISO:'2026-10-15T03:15:59.000Z',sourceName:'camera',fromFrontMirror:false,remark:'migration'};"
            + "tx.objectStore('photos').put(p);tx.objectStore('trash').put({...p,id:'webview-trash',deletedAtISO:new Date().toISOString()});"
            + "await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});db.close();Fixture.finish('');"
            + "}catch(e){Fixture.finish(String(e));}})();";
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            fixture[0] = new WebView(context);
            fixture[0].getSettings().setJavaScriptEnabled(true);
            fixture[0].getSettings().setDomStorageEnabled(true);
            fixture[0].addJavascriptInterface(callback, "Fixture");
            fixture[0].setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) { view.evaluateJavascript(seed, null); }
            });
            fixture[0].loadDataWithBaseURL("https://localhost/", "<html><body>migration fixture</body></html>", "text/html", "UTF-8", null);
        });
        assertTrue("IndexedDB seed timed out", callback.done.await(30, TimeUnit.SECONDS));
        assertEquals("", callback.error);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> fixture[0].destroy());

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            long deadline = System.currentTimeMillis() + 30000;
            while (!execute(request("status")).getBoolean("migrated") && System.currentTimeMillis() < deadline) {
                Thread.sleep(100);
            }
            assertTrue("React library initialization must migrate IndexedDB", execute(request("status")).getBoolean("migrated"));
            evaluate(scenario, "document.querySelector('[title=\"ถังขยะ\"]').click()");
            while (!"1".equals(evaluate(scenario, "document.querySelectorAll('.trash-item').length")) && System.currentTimeMillis() < deadline) {
                Thread.sleep(100);
            }
            assertEquals("1", evaluate(scenario, "document.querySelectorAll('.trash-item').length"));
        }
        assertEquals(1, count(false));
        assertEquals(1, count(true));
        assertEquals("migration", execute(request("read").put("id", "webview-original")).getJSONObject("record").getString("remark"));

        FixtureCallback removed = new FixtureCallback();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            fixture[0] = new WebView(context);
            fixture[0].getSettings().setJavaScriptEnabled(true);
            fixture[0].addJavascriptInterface(removed, "Fixture");
            fixture[0].setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript("const r=indexedDB.deleteDatabase('timestamp-photos');r.onsuccess=()=>Fixture.finish('');r.onerror=()=>Fixture.finish(String(r.error));", null);
                }
            });
            fixture[0].loadDataWithBaseURL("https://localhost/", "<html></html>", "text/html", "UTF-8", null);
        });
        assertTrue("IndexedDB deletion timed out", removed.done.await(30, TimeUnit.SECONDS));
        assertEquals("", removed.error);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> fixture[0].destroy());
        close();
        plugin = open();
        assertTrue(execute(request("status")).getBoolean("migrated"));
        assertEquals(1, count(false));
        assertEquals(1, count(true));
        assertEquals("2026-10-15T03:15:59.000Z", execute(request("read").put("id", "webview-original")).getJSONObject("record").getString("timeValueISO"));
    }
}
