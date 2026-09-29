import { useCallback, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { captureFromVideo, processImportedImage } from '../lib/canvas';
import { generateId } from '../lib/format';
import { log } from '../lib/logger';
import type { PhotoRecord } from '../types';

export function useCapture() {
    const { state, dispatch, addPhoto, showToast } = useApp();
    const lastVfDimensions = useRef({ width: 0, height: 0 });
    const captureInFlightRef = useRef(false);
    const [isCapturing, setIsCapturing] = useState(false);

    // Update viewfinder dimensions (called from Stage)
    const updateViewfinderDimensions = useCallback((width: number, height: number) => {
        lastVfDimensions.current = { width, height };
    }, []);

    // Capture from camera
    const capturePhoto = useCallback(
        async (video: HTMLVideoElement) => {
            if (captureInFlightRef.current) return;
            captureInFlightRef.current = true;
            setIsCapturing(true);
            navigator.vibrate?.(35);
            const { width: vfWidth, height: vfHeight } = lastVfDimensions.current;

            // Fallback to video dimensions if viewfinder not set
            const actualVfW = vfWidth || video.clientWidth;
            const actualVfH = vfHeight || video.clientHeight;

            const isFrontCamera = state.facingMode === 'user';

            try {
                const { blob, width, height } = captureFromVideo(
                    video,
                    actualVfW,
                    actualVfH,
                    isFrontCamera
                );

                const baseBlob = await blob;
                const now = new Date().toISOString();

                const record: PhotoRecord = {
                    id: generateId(),
                    baseBlob,
                    width,
                    height,
                    createdAtISO: now,
                    timeMode: state.settings.globalTimeMode,
                    timeValueISO:
                        state.settings.globalTimeMode === 'now'
                            ? now
                            : state.settings.globalCustomTime,
                    sourceName: 'camera',
                    fromFrontMirror: isFrontCamera,
                };

                await addPhoto(record);
                // showToast('ถ่ายรูปแล้ว', 'success'); // Removed as per user request
            } catch (e) {
                log(`Capture failed: ${e}`, 'error');
                showToast('ถ่ายรูปไม่สำเร็จ', 'error');
            } finally {
                captureInFlightRef.current = false;
                setIsCapturing(false);
            }
        },
        [state.facingMode, state.settings, addPhoto, showToast]
    );

    // Import from files
    const importPhotos = useCallback(
        async (files: FileList | File[]) => {
            const fileArray = Array.from(files);
            log(`Importing ${fileArray.length} files`);

            let successCount = 0;
            let completedCount = 0;
            dispatch({ type: 'SET_IMPORT_PROGRESS', payload: { current: 0, total: fileArray.length } });

            const processFile = async (file: File) => {
                if (!file.type.startsWith('image/')) {
                    log(`Skipping non-image: ${file.name}`, 'warn');
                    completedCount++;
                    dispatch({ type: 'SET_IMPORT_PROGRESS', payload: { current: completedCount, total: fileArray.length } });
                    return;
                }

                try {
                    const { blob, width, height } = await processImportedImage(file);
                    const now = new Date().toISOString();

                    const record: PhotoRecord = {
                        id: generateId(),
                        baseBlob: blob,
                        width,
                        height,
                        createdAtISO: now,
                        timeMode: state.settings.globalTimeMode,
                        timeValueISO:
                            state.settings.globalTimeMode === 'now'
                                ? now
                                : state.settings.globalCustomTime,
                        sourceName: file.name,
                        fromFrontMirror: false,
                    };

                    await addPhoto(record);
                    successCount++;
                } catch (e) {
                    log(`Import failed for ${file.name}: ${e}`, 'error');
                } finally {
                    completedCount++;
                    dispatch({ type: 'SET_IMPORT_PROGRESS', payload: { current: completedCount, total: fileArray.length } });
                }
            };

            let nextIndex = 0;
            const worker = async () => {
                while (nextIndex < fileArray.length) {
                    const file = fileArray[nextIndex++];
                    await processFile(file);
                }
            };
            await Promise.all(Array.from({ length: Math.min(2, fileArray.length) }, worker));
            dispatch({ type: 'SET_IMPORT_PROGRESS', payload: null });

            if (successCount > 0) {
                showToast(`นำเข้า ${successCount} รูปแล้ว`, 'success');
            } else {
                showToast('นำเข้ารูปไม่สำเร็จ', 'error');
            }
        },
        [state.settings, dispatch, addPhoto, showToast]
    );

    return {
        capturePhoto,
        importPhotos,
        updateViewfinderDimensions,
        isCapturing,
    };
}
