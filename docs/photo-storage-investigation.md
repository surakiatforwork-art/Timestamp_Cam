# Photo loss investigation (2026-10-15)

Update 2026-10-29 (v1.4.0): the implementation below describes the initial fix.
Age-based trash deletion has since been removed from both native and browser
storage. Old trash now triggers a reminder and remains until explicitly deleted
by the user. Startup loads active originals first; trash migration and hydration
run in the background with progress shown in the trash dialog. Card order is
persisted transactionally and restored photos append to the active library.
Validation for v1.4.0: 8 Android instrumentation cases and 9 desktop/mobile UI
cases passed, including pointer/touch/keyboard ordering, edge scrolling, old-trash
preservation, startup progress, and deletion during background trash loading.

## Evidence and limits

The supplied device snapshot contains an IndexedDB database named
`timestamp-photos` with only a 2,420-byte log containing schema metadata. There
are no photo records or associated image blobs left in that snapshot. The
WebView QuotaManager lists the `https://localhost/` default bucket with
`persistent=0` and `durability=0`. Settings in Local Storage remain present.

The original capture path converts the camera's video frame to a Blob and saves
that Blob only in IndexedDB. It does not save the camera original to an Android
file or native database. Gallery imports can leave independent Capacitor cache
files, which does not make that cache a backup of camera captures.

The 30-day expiry code selects only trash records by `deletedAtISO`. No scheduled
expiry of active photos, application-data clearing, or IndexedDB database deletion
was found in the current application source. The download path does not delete
photos. A failure opening storage previously logged an error and displayed an
empty library, with no visible error or retry option.

**Confirmed defect:** a WebView database was the sole durable copy of camera
originals and trash, and loading failures appeared to users as an empty library.

**Unconfirmed trigger:** the snapshot cannot identify who removed the IndexedDB
content. WebView quota eviction, storage cleanup, and database damage remain
possible explanations, not proven causes. The observation after approximately
one month does not prove that the trash retention routine deleted active photos.
Historical deletion/eviction logs were not available.

## Implemented correction

- Android uses `databases/timestamp-library.db` via a native Capacitor plugin,
  independently of WebView's origin, quota, IndexedDB and cache directories.
- Original bytes are divided into 256 KiB rows to avoid Android CursorWindow's
  per-row limit. Original bytes and card metadata commit together in a transaction
  with SQLite synchronous writes enabled. The card is added only after commit.
- Metadata edits do not rewrite original bytes. Trash moves, restores and bulk
  operations are transactional. Permanent removal and expiry require trash state;
  active photos cannot be removed through those operations.
- Existing active and trashed photos are copied one at a time from IndexedDB.
  Migration is marked complete only after every copy succeeds. Retrying skips
  existing native IDs. The old database is left intact and settings are unchanged.
- Once migration finishes, the native library opens without consulting IndexedDB.
- A loading/error dialog blocks the library while initialization is incomplete.
  Read failures offer retry instead of silently displaying an empty writable list.
- A custom corruption handler preserves the database and reports the error.
  Android's default destructive corruption recovery is not used for this library.
- The last 1,000 successful storage mutations are recorded in `storage_events`.
- Browser builds continue to use IndexedDB, with a best-effort persistent-storage
  request. They do not receive the native Android storage guarantees.

This does not recreate files already lost. Native app-private data is still removed
by uninstalling or clearing app data; off-device backup is a separate requirement.
No source was pushed or release published as part of this correction.

## Validation

`npm run build` and Android `:app:assembleDebug` must pass. Instrumentation tests
in `PhotoStorageTest` cover large originals, reopen, WebView deletion, metadata
edits, retention boundaries, restoration, transaction rollback, empty-image
rejection, repeat migration, preservation of damaged databases, and the real
React/IndexedDB-to-native migration path.

Verified on 2026-10-15: TypeScript/Vite production build and Android debug APK
build passed; all 7 instrumentation tests passed on a dedicated Android 16
emulator (0 failures). The migration fixture uses native IndexedDB version 20,
which is how Dexie represents its schema version 2. The actual recovery device
was disconnected and was not used for these tests. ESLint could not run because
the repository has no ESLint 9 flat configuration file.

Run on an emulator, never on the user's recovery device: the test fixture resets
its target application's test library.

```powershell
$env:ANDROID_SERIAL = 'emulator-5556'
.\gradlew.bat :app:connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.example.timestamp.PhotoStorageTest'
```

## References

- https://developer.android.com/training/data-storage/app-specific
- https://developer.chrome.com/docs/web-platform/storage-buckets
