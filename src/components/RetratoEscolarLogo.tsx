import React from 'react';

interface RetratoEscolarLogoProps {
  className?: string;
  variant?: 'full' | 'compact' | 'icon-only';
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * ViewfinderFocusIcon
 * Exact vector replica of the student portrait inside the viewfinder focus frame.
 */
export function ViewfinderFocusIcon({
  className = 'w-10 h-10',
  theme = 'light',
}: {
  className?: string;
  theme?: 'light' | 'dark';
}) {
  const navyColor = theme === 'dark' ? '#FFFFFF' : '#0B1727';
  const faceFill = theme === 'dark' ? '#0B1727' : '#FFFFFF';
  const shirtWhite = '#FFFFFF';
  const orangeColor = '#F59E0B'; // Vibrant amber-orange as in the official branding

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Viewfinder 4 Corner Brackets */}
      {/* Top-Left */}
      <path
        d="M 12 32 V 20 C 12 15.5 15.5 12 20 12 H 32"
        stroke={orangeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top-Right */}
      <path
        d="M 68 12 H 80 C 84.5 12 88 15.5 88 20 V 32"
        stroke={orangeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-Left */}
      <path
        d="M 12 68 V 80 C 12 84.5 15.5 88 20 88 H 32"
        stroke={orangeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-Right */}
      <path
        d="M 68 88 H 80 C 84.5 88 88 84.5 88 80 V 68"
        stroke={orangeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Focus Dot (Top Right inside frame) */}
      <circle cx="75" cy="24" r="4.5" fill={orangeColor} />

      {/* Student Silhouette Group */}
      <g>
        {/* Shoulders / Blazer */}
        <path
          d="M 21 82 C 22 73 28 66 38 64 L 44 68 L 50 72 L 56 68 L 62 64 C 72 66 78 73 79 82 C 77 84 72 85 50 85 C 28 85 23 84 21 82 Z"
          fill={navyColor}
        />

        {/* White Shirt Collar Opening */}
        <polygon
          points="41,64 50,75 59,64 54,62 50,65 46,62"
          fill={shirtWhite}
        />

        {/* Navy Necktie Knot & Body */}
        <polygon points="48.5,67 51.5,67 52.5,70 47.5,70" fill={navyColor} />
        <polygon points="47.5,70 52.5,70 51.5,80 50,82 48.5,80" fill={navyColor} />

        {/* Neck */}
        <path
          d="M 44 54 H 56 V 64 C 53 66 47 66 44 64 V 54 Z"
          fill={faceFill}
          stroke={navyColor}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />

        {/* Ears */}
        <path
          d="M 33 42 C 30 42 30 49 33 49"
          stroke={navyColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M 67 42 C 70 42 70 49 67 49"
          stroke={navyColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Face Silhouette (Chin and cheeks) */}
        <path
          d="M 34 38 C 34 50 40 57 50 57 C 60 57 66 50 66 38"
          fill={faceFill}
          stroke={navyColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Hair (Parted stylish modern school haircut) */}
        <path
          d="M 33 39 C 32 30 36 21 50 21 C 64 21 68 30 67 39 C 65 37 62 33 58 35 C 53 38 49 31 43 32 C 38 33 35 36 33 39 Z"
          fill={navyColor}
        />
      </g>
    </svg>
  );
}

/**
 * RetratoEscolarLogo
 * The primary official brand logo for Retrato Escolar (.COM.AR).
 */
export default function RetratoEscolarLogo({
  className = '',
  variant = 'full',
  theme = 'light',
  size = 'md',
}: RetratoEscolarLogoProps) {
  // Scaling presets
  const sizeMap = {
    sm: {
      icon: 'w-8 h-8',
      title: 'text-lg',
      badge: 'text-[9px] px-1.5 py-0.5',
      subtitle: 'text-[10px]',
      gap: 'gap-2.5',
    },
    md: {
      icon: 'w-10 h-10 sm:w-11 sm:h-11',
      title: 'text-xl sm:text-2xl',
      badge: 'text-[10px] sm:text-[11px] px-2 py-0.5',
      subtitle: 'text-[11px] sm:text-xs',
      gap: 'gap-3',
    },
    lg: {
      icon: 'w-12 h-12 sm:w-14 sm:h-14',
      title: 'text-2xl sm:text-3xl',
      badge: 'text-xs px-2.5 py-0.5',
      subtitle: 'text-xs sm:text-sm',
      gap: 'gap-3.5',
    },
    xl: {
      icon: 'w-16 h-16 sm:w-20 sm:h-20',
      title: 'text-3xl sm:text-4xl',
      badge: 'text-sm px-3 py-1',
      subtitle: 'text-sm sm:text-base',
      gap: 'gap-4',
    },
  }[size];

  const textColorNavy = theme === 'dark' ? 'text-white' : 'text-[#0B1727]';
  const subtitleColor = theme === 'dark' ? 'text-slate-300' : 'text-slate-600';

  if (variant === 'icon-only') {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        <ViewfinderFocusIcon className={sizeMap.icon} theme={theme} />
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center ${sizeMap.gap} ${className} select-none`}>
      {/* Brand Icon */}
      <div className="shrink-0 transition-transform group-hover:scale-105 duration-200">
        <ViewfinderFocusIcon className={sizeMap.icon} theme={theme} />
      </div>

      {/* Brand Typography */}
      <div className="flex flex-col text-left">
        {/* Main Name + .COM.AR Pill */}
        <div className="flex items-center gap-1.5 sm:gap-2 leading-none">
          <span className={`font-black tracking-tight ${sizeMap.title} ${textColorNavy} font-['Outfit']`}>
            Retrato<span className="text-[#F59E0B]">Escolar</span>
          </span>

          {/* .COM.AR Bordered Pill Badge matching exact branding */}
          <span
            className={`font-extrabold uppercase tracking-wider rounded-lg sm:rounded-xl border-2 border-[#F59E0B] text-[#F59E0B] leading-none ${sizeMap.badge}`}
          >
            .COM.AR
          </span>
        </div>

        {/* Subtitle / Tagline */}
        {variant === 'full' && (
          <span
            className={`font-medium tracking-normal mt-0.5 sm:mt-1 leading-tight ${sizeMap.subtitle} ${subtitleColor}`}
          >
            Portal de fotos escolares
          </span>
        )}
      </div>
    </div>
  );
}
