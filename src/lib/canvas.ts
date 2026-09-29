import type { OverlayFontFamily, Photo, Settings, TimestampFormat } from '../types';
import { formatDMS, formatTimestamp } from './format';

const OVERLAY_FONT_STACKS: Record<OverlayFontFamily, string> = {
    'android-ui': '"Roboto", "Timestamp Noto Sans Thai UI", "Noto Sans Thai UI", sans-serif',
    'noto-thai-ui': '"Timestamp Noto Sans Thai UI", "Noto Sans Thai UI", sans-serif',
    'noto-thai-looped-ui': '"Timestamp Noto Sans Thai Looped UI", "Noto Sans Thai Looped UI", sans-serif',
    'system-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

function getOverlayFontStack(fontFamily: OverlayFontFamily): string {
    return OVERLAY_FONT_STACKS[fontFamily] ?? OVERLAY_FONT_STACKS['android-ui'];
}

function getBundledFontFamily(fontFamily: OverlayFontFamily): string | null {
    switch (fontFamily) {
        case 'android-ui':
        case 'noto-thai-ui':
            return 'Timestamp Noto Sans Thai UI';
        case 'noto-thai-looped-ui':
            return 'Timestamp Noto Sans Thai Looped UI';
        default:
            return null;
    }
}

async function ensureOverlayFontReady(
    fontSize: number,
    fontFamily: OverlayFontFamily,
    fontWeight: number
): Promise<void> {
    if (!document.fonts?.load) return;

    const bundledFontFamily = getBundledFontFamily(fontFamily);
    if (!bundledFontFamily) return;

    try {
        await document.fonts.load(`${fontWeight} ${Math.max(1, Math.round(fontSize))}px "${bundledFontFamily}"`);
        await document.fonts.ready;
    } catch {
        // Canvas will fall back to the remaining font stack if the bundled font cannot load.
    }
}

// Calculate crop region for object-fit: cover
export function calculateCoverCrop(
    videoW: number,
    videoH: number,
    vfW: number,
    vfH: number
): { sx: number; sy: number; sw: number; sh: number } {
    const videoRatio = videoW / videoH;
    const vfRatio = vfW / vfH;

    let sw: number, sh: number;

    if (videoRatio > vfRatio) {
        // Video is wider, crop sides
        sh = videoH;
        sw = videoH * vfRatio;
    } else {
        // Video is taller, crop top/bottom
        sw = videoW;
        sh = videoW / vfRatio;
    }

    const sx = (videoW - sw) / 2;
    const sy = (videoH - sh) / 2;

    return { sx, sy, sw, sh };
}

// Build overlay text lines
export function buildOverlayLines(
    timeValueISO: string,
    format: TimestampFormat,
    locationEnabled: boolean,
    showLatLng: boolean,
    showAddress: boolean,
    lat: number | null,
    lng: number | null,
    address: string | null
): string[] {
    const date = new Date(timeValueISO);
    const formatted = formatTimestamp(date, format);

    const lines: string[] = [
        `Network: ${formatted}`,
        `Local: ${formatted}`,
    ];

    if (locationEnabled) {
        if (showLatLng && lat !== null && lng !== null) {
            lines.push(format === 'sample-overlay' ? formatDMS(lat, lng) : `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        }
        if (showAddress && address) {
            // Split long addresses
            if (address.length > 50) {
                const mid = address.lastIndexOf(' ', 50);
                if (mid > 20) {
                    lines.push(address.substring(0, mid));
                    lines.push(address.substring(mid + 1));
                } else {
                    lines.push(address);
                }
            } else {
                lines.push(address);
            }
        }
    }

    return lines;
}

// Render overlay text onto canvas
export function renderOverlay(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    lines: string[],
    position: 'TR' | 'TC' | 'TL' | 'BR' | 'BC' | 'BL',
    padding: number,
    fontSize: number,
    fontFamily: OverlayFontFamily,
    fontWeight: number,
    strokeWidth: number,
    fontHeightScale: number
): void {
    ctx.save();

    // Font setup
    ctx.font = `${fontWeight} ${fontSize}px ${getOverlayFontStack(fontFamily)}`;

    // Calculate text dimensions
    const heightScale = Math.max(0.5, fontHeightScale);
    const lineHeight = fontSize * 1.3 * heightScale;
    const textHeight = lines.length * lineHeight;

    // Position calculation
    const isRight = position.includes('R');
    const isCenter = position.includes('C');
    const isBottom = position.includes('B');

    ctx.textAlign = isCenter ? 'center' : isRight ? 'right' : 'left';
    ctx.textBaseline = 'top';

    const textX = isCenter ? canvasW / 2 : isRight ? canvasW - padding : padding;
    const startY = isBottom ? canvasH - padding - textHeight : padding;

    // Shadow settings
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = Math.max(1, strokeWidth * 1.2);
    ctx.shadowOffsetX = Math.max(0.5, strokeWidth * 0.55);
    ctx.shadowOffsetY = Math.max(0.5, strokeWidth * 0.55);

    lines.forEach((line, i) => {
        const lineY = startY + i * lineHeight;

        // Stroke (outline)
        if (strokeWidth > 0) {
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = strokeWidth;
            ctx.lineJoin = 'round';
            ctx.save();
            ctx.translate(textX, lineY);
            ctx.scale(1, heightScale);
            ctx.strokeText(line, 0, 0);
            ctx.restore();
        }

        // Fill (white text)
        ctx.fillStyle = '#FFFFFF';
        ctx.save();
        ctx.translate(textX, lineY);
        ctx.scale(1, heightScale);
        ctx.fillText(line, 0, 0);
        ctx.restore();
    });

    ctx.restore();
}

// Calculate font size
export function calculateFontSize(
    outputW: number,
    outputH: number,
    fontMode: 'auto' | 'fixed',
    autoScale: number,
    fixedPx: number
): number {
    if (fontMode === 'fixed') {
        return fixedPx;
    }
    // Auto: base on smaller dimension
    const base = Math.min(outputW, outputH) * 0.028;
    return Math.round(base * autoScale);
}

// Render photo to canvas with overlay
export async function renderPhotoToCanvas(
    photo: Photo,
    settings: Settings,
    maxPreviewSize?: number
): Promise<HTMLCanvasElement> {
    // Create image from blob
    const img = await createImageBitmap(photo.baseBlob);

    let outputW: number, outputH: number;

    if (settings.outputMode === 'original') {
        outputW = photo.width;
        outputH = photo.height;
    } else {
        outputW = settings.presetSize.w;
        outputH = settings.presetSize.h;
    }

    // Scale for preview if needed
    let scale = 1;
    if (maxPreviewSize) {
        const maxDim = Math.max(outputW, outputH);
        if (maxDim > maxPreviewSize) {
            scale = maxPreviewSize / maxDim;
        }
    }

    const canvasW = Math.round(outputW * scale);
    const canvasH = Math.round(outputH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // Fill black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw image
    if (settings.outputMode === 'original') {
        // Original: draw full image
        if (photo.fromFrontMirror) {
            ctx.save();
            ctx.translate(canvasW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, canvasW, canvasH);
            ctx.restore();
        } else {
            ctx.drawImage(img, 0, 0, canvasW, canvasH);
        }
    } else {
        // Preset: contain or cover
        const imgRatio = img.width / img.height;
        const canvasRatio = canvasW / canvasH;

        let drawW: number, drawH: number, drawX: number, drawY: number;
        let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;

        if (settings.fitMode === 'contain') {
            // Contain: fit inside, may have letterbox
            if (imgRatio > canvasRatio) {
                drawW = canvasW;
                drawH = canvasW / imgRatio;
            } else {
                drawH = canvasH;
                drawW = canvasH * imgRatio;
            }
            drawX = (canvasW - drawW) / 2;
            drawY = (canvasH - drawH) / 2;
        } else {
            // Cover: fill canvas, may crop
            if (imgRatio > canvasRatio) {
                // Image wider, crop sides
                srcH = img.height;
                srcW = img.height * canvasRatio;
                srcX = (img.width - srcW) / 2;
            } else {
                // Image taller, crop top/bottom
                srcW = img.width;
                srcH = img.width / canvasRatio;
                srcY = (img.height - srcH) / 2;
            }
            drawX = 0;
            drawY = 0;
            drawW = canvasW;
            drawH = canvasH;
        }

        if (photo.fromFrontMirror) {
            ctx.save();
            ctx.translate(canvasW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, srcX, srcY, srcW, srcH, canvasW - drawX - drawW, drawY, drawW, drawH);
            ctx.restore();
        } else {
            ctx.drawImage(img, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
        }
    }

    // Build overlay lines
    const lines = buildOverlayLines(
        photo.timeValueISO,
        settings.timestampFormat,
        settings.locationEnabled,
        settings.showLatLng,
        settings.showAddress,
        photo.locationLatitude ?? settings.latitude,
        photo.locationLongitude ?? settings.longitude,
        photo.locationAddress ?? settings.cachedAddress
    );

    // Calculate font size based on output size (not preview size)
    const fontSize = calculateFontSize(
        outputW,
        outputH,
        settings.fontMode,
        settings.fontAutoScale,
        settings.fontFixedPx
    ) * scale;

    await ensureOverlayFontReady(fontSize, settings.overlayFontFamily, settings.overlayFontWeight);

    // Render overlay
    renderOverlay(
        ctx,
        canvasW,
        canvasH,
        lines,
        settings.overlayPosition,
        settings.overlayPadding * scale,
        fontSize,
        settings.overlayFontFamily,
        settings.overlayFontWeight,
        settings.overlayStrokeWidth * scale,
        settings.overlayFontHeightScale
    );

    return canvas;
}

// Export photo to blob
export async function renderPhotoToBlob(
    photo: Photo,
    settings: Settings,
    format: 'jpeg' | 'png',
    quality: number
): Promise<Blob> {
    const canvas = await renderPhotoToCanvas(photo, settings);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to create blob'));
            },
            format === 'jpeg' ? 'image/jpeg' : 'image/png',
            format === 'jpeg' ? quality : undefined
        );
    });
}

// Process imported image (strip EXIF, fix orientation)
export async function processImportedImage(file: File): Promise<{
    blob: Blob;
    width: number;
    height: number;
}> {
    const img = await createImageBitmap(file);

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to process image'))),
            'image/jpeg',
            0.92
        );
    });

    return { blob, width: img.width, height: img.height };
}

// Capture frame from video
export function captureFromVideo(
    video: HTMLVideoElement,
    vfWidth: number,
    vfHeight: number,
    isFrontCamera: boolean
): { blob: Promise<Blob>; width: number; height: number } {
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;

    // Calculate crop to match viewfinder
    const { sx, sy, sw, sh } = calculateCoverCrop(videoW, videoH, vfWidth, vfHeight);

    // Output at video's natural resolution for that crop
    const outW = Math.round(sw);
    const outH = Math.round(sh);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d')!;

    if (isFrontCamera) {
        // Mirror for front camera
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);

    const blobPromise = new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to capture'))),
            'image/jpeg',
            0.92
        );
    });

    return { blob: blobPromise, width: outW, height: outH };
}
