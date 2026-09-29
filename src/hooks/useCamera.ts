import { useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { log } from '../lib/logger';
import { Camera } from '@capacitor/camera';

export function useCamera() {
    const { state, dispatch, showToast, videoRef } = useApp();
    const streamRef = useRef<MediaStream | null>(null);
    const shouldRefreshOnResumeRef = useRef(false);
    const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { cameraOn, facingMode, torchOn, cameraStatus } = state;

    // Request camera permission using Capacitor
    const requestCameraPermission = useCallback(async (): Promise<boolean> => {
        try {
            const status = await Camera.checkPermissions();

            if (status.camera === 'granted') {
                return true;
            }

            if (status.camera === 'prompt' || status.camera === 'prompt-with-rationale') {
                const result = await Camera.requestPermissions({ permissions: ['camera'] });
                return result.camera === 'granted';
            }

            // Permission denied
            return false;
        } catch (e) {
            log(`Permission check failed: ${e}`, 'error');
            // Fallback: try to use camera anyway
            return true;
        }
    }, []);

    // Start camera
    const startCamera = useCallback(async () => {
        if (!videoRef.current) return;

        dispatch({ type: 'SET_CAMERA_STATUS', payload: 'starting' });
        log(`Starting camera: ${facingMode}`);

        try {
            // Request permission first via Capacitor
            const hasPermission = await requestCameraPermission();
            if (!hasPermission) {
                dispatch({ type: 'SET_CAMERA_STATUS', payload: 'denied' });
                showToast('กรุณาอนุญาตการใช้กล้องในการตั้งค่า', 'error');
                return;
            }

            // Stop existing stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });

            streamRef.current = stream;
            videoRef.current.srcObject = stream;
            try {
                await videoRef.current.play();
            } catch (playErr) {
                // Ignore "interrupted by a new load request" error which is common when switching cameras or strict mode
                const msg = (playErr as Error).message || '';
                if (!msg.includes('interrupted by a new load request')) {
                    log(`Video play warning: ${msg}`, 'warn');
                }
            }

            // Check for torch capability
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities?.() as { torch?: boolean } | undefined;
            const hasTorch = capabilities?.torch === true;
            dispatch({ type: 'SET_HAS_TORCH', payload: hasTorch });

            // Check for multiple cameras
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === 'videoinput');
            dispatch({ type: 'SET_HAS_MULTIPLE_CAMERAS', payload: videoInputs.length > 1 });

            dispatch({ type: 'SET_CAMERA_STATUS', payload: 'ready' });
            log('Camera ready');
        } catch (e) {
            const err = e as Error;
            log(`Camera error: ${err.message}`, 'error');

            if (err.name === 'NotAllowedError') {
                dispatch({ type: 'SET_CAMERA_STATUS', payload: 'denied' });
                showToast('กรุณาอนุญาตการใช้กล้อง', 'error');
            } else {
                dispatch({ type: 'SET_CAMERA_STATUS', payload: 'error' });
                showToast('เปิดกล้องไม่สำเร็จ: ' + err.message, 'error');
            }
        }
    }, [facingMode, dispatch, showToast, requestCameraPermission]);

    // Stop camera
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        dispatch({ type: 'SET_CAMERA_STATUS', payload: 'off' });
        dispatch({ type: 'SET_TORCH_ON', payload: false });
        log('Camera stopped');
    }, [dispatch]);

    // Toggle camera on/off
    useEffect(() => {
        if (cameraOn) {
            startCamera();
        } else {
            stopCamera();
        }

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }
        };
    }, [cameraOn, startCamera, stopCamera]);

    // Android can suspend a WebView's camera track while leaving its last frame on-screen.
    // Tear down that stale stream and reacquire it after the activity returns to foreground.
    useEffect(() => {
        const markSuspended = () => {
            if (!cameraOn) return;
            shouldRefreshOnResumeRef.current = true;
            stopCamera();
        };
        const refreshAfterResume = () => {
            if (!cameraOn || !shouldRefreshOnResumeRef.current) return;
            shouldRefreshOnResumeRef.current = false;
            if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
            resumeTimerRef.current = setTimeout(() => {
                startCamera();
            }, 250);
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') markSuspended();
            else refreshAfterResume();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('native-app-pause', markSuspended);
        window.addEventListener('native-app-resume', refreshAfterResume);
        window.addEventListener('pageshow', refreshAfterResume);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('native-app-pause', markSuspended);
            window.removeEventListener('native-app-resume', refreshAfterResume);
            window.removeEventListener('pageshow', refreshAfterResume);
            if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
        };
    }, [cameraOn, startCamera, stopCamera]);

    // Switch facing mode
    const switchCamera = useCallback(() => {
        const newMode = facingMode === 'environment' ? 'user' : 'environment';
        dispatch({ type: 'SET_FACING_MODE', payload: newMode });
        dispatch({ type: 'SET_TORCH_ON', payload: false });
    }, [facingMode, dispatch]);

    // Toggle torch
    const toggleTorch = useCallback(async () => {
        if (!streamRef.current) return;

        const track = streamRef.current.getVideoTracks()[0];
        if (!track) return;

        const newTorchState = !torchOn;

        try {
            await track.applyConstraints({
                advanced: [{ torch: newTorchState } as MediaTrackConstraintSet],
            });
            dispatch({ type: 'SET_TORCH_ON', payload: newTorchState });
            log(`Torch ${newTorchState ? 'on' : 'off'}`);
        } catch (e) {
            log(`Torch toggle failed: ${e}`, 'error');
            showToast('ไม่สามารถเปิด/ปิดแฟลชได้', 'error');
        }
    }, [torchOn, dispatch, showToast]);

    // Toggle camera on/off
    const toggleCameraOn = useCallback(() => {
        dispatch({ type: 'SET_CAMERA_ON', payload: !cameraOn });
    }, [cameraOn, dispatch]);

    return {
        videoRef,
        cameraOn,
        cameraStatus,
        facingMode,
        torchOn,
        hasMultipleCameras: state.hasMultipleCameras,
        hasTorch: state.hasTorch,
        toggleCameraOn,
        switchCamera,
        toggleTorch,
        startCamera,
        stopCamera,
    };
}
