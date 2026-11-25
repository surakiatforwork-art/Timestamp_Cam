import { useLayoutEffect, useRef } from 'react';

type Handler = { priority: number; handle: () => boolean };
const handlers = new Set<Handler>();

// Each layer handles Back in order, independently of component mount order.
export function handleBack(): boolean {
    for (const entry of [...handlers].sort((a,b)=>b.priority-a.priority)) {
        if (entry.handle()) return true;
    }
    return false;
}

export function useBackHandler(priority: number, handler: () => boolean) {
    const latest = useRef(handler);
    useLayoutEffect(() => { latest.current = handler; });
    useLayoutEffect(() => {
        const entry = {priority, handle:()=>latest.current()};
        handlers.add(entry);
        return () => { handlers.delete(entry); };
    }, [priority]);
}
