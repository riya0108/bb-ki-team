import { useRef } from 'react';

interface ResizeHandleProps {
  // Called with the new size (px) as the pointer moves; the caller owns clamping
  // and storing it — this component only reports raw pointer movement.
  onResize: (deltaY: number) => void;
}

// A thin drag handle between two stacked panels. Deliberately dumb: it reports
// pointer movement deltas and lets the parent decide what "resize" means (which
// panel grows, which shrinks, and the min/max clamp) rather than owning any size
// state itself — same handle works for "drag up to grow the panel below" (the
// draft/chat split in App.tsx) without hardcoding that direction here.
export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const lastYRef = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    lastYRef.current = e.clientY;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaY = moveEvent.clientY - lastYRef.current;
      lastYRef.current = moveEvent.clientY;
      onResize(deltaY);
    }
    function onPointerUp(upEvent: PointerEvent) {
      el.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  return (
    <div className="resize-handle-h" onPointerDown={onPointerDown} role="separator" aria-orientation="horizontal" />
  );
}
