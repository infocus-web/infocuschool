import React from 'react';

interface WatermarkOverlayProps {
  visible?: boolean;
  text?: string;
  density?: 'normal' | 'dense';
  opacity?: number;
  /** Marca de agua más chica y liviana (usada en la vista ampliada de la foto) */
  compact?: boolean;
}

export default function WatermarkOverlay({
  visible = true,
  text = 'MUESTRA RETRATO ESCOLAR · NO COPIAR ·',
  density = 'dense',
  opacity = 0.72,
  compact = false,
}: WatermarkOverlayProps) {
  if (!visible) return null;

  // Generates repeated diagonal watermark rows matching the exact InFocus Schools official sample
  const rowCount = density === 'dense' ? 16 : 10;
  const repeatPerLine = 10;

  return (
    <div
      className="absolute inset-0 select-none overflow-hidden z-20 flex items-center justify-center cursor-default"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        pointerEvents: 'auto', // Blocks direct right click on the image below
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      aria-hidden="true"
    >
      <div
        className="w-[280%] h-[280%] flex flex-col justify-between -rotate-30 select-none pointer-events-none"
        style={{ opacity }}
      >
        {Array.from({ length: rowCount }).map((_, rIdx) => (
          <div
            key={rIdx}
            className={`flex justify-around items-center whitespace-nowrap font-black uppercase text-white tracking-widest ${
              compact ? 'text-[8px] sm:text-[9px]' : 'text-[13px] sm:text-[15px]'
            }`}
            style={{
              textShadow:
                '0 1px 3px rgba(0, 0, 0, 0.95), 0 0 3px rgba(0, 0, 0, 0.9), 0 2px 5px rgba(0,0,0,0.85)',
              transform: rIdx % 2 === 0 ? 'translateX(-50px)' : 'translateX(50px)',
            }}
          >
            {Array.from({ length: repeatPerLine }).map((_, cIdx) => (
              <span key={cIdx} className="mx-3 inline-block font-extrabold">
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
