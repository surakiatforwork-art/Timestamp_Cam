import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { vibrateForTick } from '../../lib/deviceFeedback';

interface Props {
    label: string;
    values: number[];
    selected: number;
    format: (value: number) => string;
    onChange: (value: number) => void;
    cyclic?: boolean;
}
const STEP = 42;
const DEAD_ZONE = 8;
const mod = (n: number, length: number) => ((n % length) + length) % length;

export default function PremiumWheel({ label, values, selected, format, onChange, cyclic = false }: Props) {
    const initial = Math.max(0, values.indexOf(selected));
    const [position, setPosition] = useState(initial);
    const current = useRef(initial);
    const animation = useRef(0);
    const pointer = useRef<{ id: number; y: number; last: number; time: number; base: number; speed: number; moved: boolean } | null>(null);
    const wheelTimer = useRef<ReturnType<typeof setTimeout>>();
    const latest = useRef({ values, selected, onChange, cyclic });
    latest.current = { values, selected, onChange, cyclic };
    const lastTick = useRef(0);
    const previousIndex = useRef(initial);
    const clamp = (p: number) => cyclic ? p : Math.max(0, Math.min(values.length - 1, p));
    function draw(p: number, haptic = false) {
        const next = clamp(p);
        const index = Math.round(next);
        current.current = next;
        setPosition(next);
        if (index !== previousIndex.current) {
            previousIndex.current = index;
            if (haptic && performance.now() - lastTick.current > 45) {
                lastTick.current = performance.now();
                vibrateForTick();
            }
        }
    }
    function commit(p: number) {
        const { values: list, cyclic: loop, onChange: change } = latest.current;
        const index = loop ? mod(Math.round(p), list.length) : Math.max(0, Math.min(list.length - 1, Math.round(p)));
        current.current = index;
        previousIndex.current = index;
        setPosition(index);
        if (list[index] !== latest.current.selected) change(list[index]);
    }
    function stop() {
        cancelAnimationFrame(animation.current);
        animation.current = 0;
        clearTimeout(wheelTimer.current);
        wheelTimer.current = undefined;
    }
    function settle(speed = 0) {
        stop();
        const start = current.current;
        const target = Math.round(clamp(start + Math.max(-12, Math.min(12, speed * 180))));
        const distance = Math.abs(target - start);
        if (distance < .002) { commit(target); return; }
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(600, 150 + distance * 34);
        if (!duration) { commit(target); return; }
        const began = performance.now();
        function frame(now: number) {
            const t = Math.min(1, (now - began) / duration);
            draw(start + (target - start) * (1 - Math.pow(1 - t, 3)), true);
            if (t < 1) animation.current = requestAnimationFrame(frame);
            else { animation.current = 0; commit(target); }
        }
        animation.current = requestAnimationFrame(frame);
    }
    useLayoutEffect(() => {
        if (!pointer.current && !animation.current) {
            const i = Math.max(0, values.indexOf(selected));
            current.current = i; previousIndex.current = i; setPosition(i);
        }
    }, [selected, values.length]);
    useEffect(() => () => { cancelAnimationFrame(animation.current); clearTimeout(wheelTimer.current); }, []);
    // Flush all moving wheels before the dialog confirms. No stale draft can be saved.
    useEffect(() => {
        const flush = () => { stop(); pointer.current = null; commit(current.current); };
        window.addEventListener('timestamp-wheel-flush', flush);
        return () => window.removeEventListener('timestamp-wheel-flush', flush);
    }, []);
    const center = Math.round(position);
    const rows = Array.from({ length: 9 }, (_, i) => center + i - 4);
    return <div className="wheel-column">
        <span>{label}</span>
        <div className="wheel-scroll premium-wheel" role="spinbutton" tabIndex={0} aria-label={label}
            aria-valuemin={values[0]} aria-valuemax={values[values.length - 1]}
            aria-valuenow={values[cyclic ? mod(center, values.length) : Math.max(0, Math.min(values.length - 1, center))]}
            onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                const moving = !!animation.current || Math.abs(current.current - Math.round(current.current)) > .002;
                stop();
                if (moving) commit(current.current);
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = { id: event.pointerId, y: event.clientY, last: event.clientY, time: performance.now(), base: current.current, speed: 0, moved: false };
            }}
            onPointerMove={event => {
                const p = pointer.current;
                if (!p || p.id !== event.pointerId) return;
                const now = performance.now(), distance = p.y - event.clientY;
                if (!p.moved && Math.abs(distance) < DEAD_ZONE) return;
                if (!p.moved) { p.moved = true; p.y -= Math.sign(distance) * DEAD_ZONE; }
                const speed = (p.last - event.clientY) / STEP / Math.max(1, now - p.time);
                p.speed = p.speed * .3 + speed * .7;
                p.last = event.clientY; p.time = now;
                draw(p.base + (p.y - event.clientY) / STEP, true);
            }}
            onPointerUp={event => {
                const p = pointer.current;
                if (!p || p.id !== event.pointerId) return;
                pointer.current = null;
                if (p.moved) settle(performance.now() - p.time < 90 ? p.speed : 0);
            }}
            onPointerCancel={() => { pointer.current = null; settle(); }}
            onLostPointerCapture={() => { if (pointer.current) { pointer.current = null; settle(); } }}
            onWheel={event => {
                stop();
                const delta = event.deltaMode === 1 ? event.deltaY : event.deltaY / STEP;
                draw(current.current + Math.max(-4, Math.min(4, delta)), true);
                wheelTimer.current = setTimeout(() => settle(), 100);
            }}
            onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); stop();
                const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'PageUp' ? -5 : 5;
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : current.current + delta;
                commit(clamp(target));
            }}>
            <div className="wheel-selection-band" aria-hidden="true" />
            {rows.map(index => {
                if (!cyclic && (index < 0 || index >= values.length)) return null;
                const offset = index - position;
                const angle = offset * .43;
                if (Math.abs(angle) > 1.54) return null;
                const item = values[mod(index, values.length)];
                return <div key={index} className={'premium-wheel-item' + (Math.abs(offset) < .5 ? ' selected' : '')}
                    aria-hidden="true" style={{ transform: 'translateY(-50%) translateY(' + (Math.sin(angle) * 100) + 'px) rotateX(' + (-angle * 180 / Math.PI) + 'deg)', opacity: Math.max(.12, 1 - Math.abs(offset) * .28) }}>
                    {format(item)}
                </div>;
            })}
        </div>
    </div>;
}
