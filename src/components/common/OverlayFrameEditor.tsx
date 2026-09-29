import { useRef } from 'react';
import type { OverlayFrame } from '../../types';

type FrameKind = 'time' | 'location';
type DragMode = 'move' | 'resize';

interface OverlayFrameEditorProps {
    timeFrame: OverlayFrame;
    locationFrame: OverlayFrame;
    aspectRatio: number;
    onChange: (kind: FrameKind, frame: OverlayFrame) => void;
}

const MIN_SIZE = 0.08;

export default function OverlayFrameEditor({ timeFrame, locationFrame, aspectRatio, onChange }: OverlayFrameEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const interaction = useRef<{ kind: FrameKind; mode: DragMode; startX: number; startY: number; frame: OverlayFrame } | null>(null);

    const begin = (event: React.PointerEvent<HTMLElement>, kind: FrameKind, mode: DragMode) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const frame = kind === 'time' ? timeFrame : locationFrame;
        interaction.current = { kind, mode, startX: event.clientX, startY: event.clientY, frame };
    };

    const move = (event: React.PointerEvent<HTMLDivElement>) => {
        const active = interaction.current;
        const bounds = editorRef.current?.getBoundingClientRect();
        if (!active || !bounds) return;

        const deltaX = (event.clientX - active.startX) / bounds.width;
        const deltaY = (event.clientY - active.startY) / bounds.height;
        let next: OverlayFrame;

        if (active.mode === 'move') {
            next = {
                ...active.frame,
                x: Math.max(0, Math.min(1 - active.frame.width, active.frame.x + deltaX)),
                y: Math.max(0, Math.min(1 - active.frame.height, active.frame.y + deltaY)),
            };
        } else {
            const width = Math.max(MIN_SIZE, Math.min(1 - active.frame.x, active.frame.width + deltaX));
            const height = Math.max(MIN_SIZE, Math.min(1 - active.frame.y, active.frame.height + deltaY));
            next = { ...active.frame, width, height };
        }
        onChange(active.kind, next);
    };

    const frameStyle = (frame: OverlayFrame) => ({
        left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.width * 100}%`, height: `${frame.height * 100}%`,
    });

    return (
        <div
            className="overlay-frame-editor"
            ref={editorRef}
            style={{ aspectRatio: String(aspectRatio) }}
            onPointerMove={move}
            onPointerUp={() => { interaction.current = null; }}
            onPointerCancel={() => { interaction.current = null; }}
        >
            <div className="overlay-frame time-frame" style={frameStyle(timeFrame)} onPointerDown={(event) => begin(event, 'time', 'move')}>
                <span>เวลา</span>
                <i onPointerDown={(event) => begin(event, 'time', 'resize')} />
            </div>
            <div className="overlay-frame location-frame" style={frameStyle(locationFrame)} onPointerDown={(event) => begin(event, 'location', 'move')}>
                <span>ตำแหน่ง</span>
                <i onPointerDown={(event) => begin(event, 'location', 'resize')} />
            </div>
        </div>
    );
}
