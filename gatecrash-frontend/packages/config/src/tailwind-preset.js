/**
 * Shared Tailwind preset — FRONTEND.md §10.1.
 *
 * Consumed by `apps/admin` (Tailwind) and, when mobile lands, by `apps/mobile` (NativeWind).
 * Colours resolve through the CSS variables in `tokens.css`, so dark mode is a class swap on
 * <html> rather than a second palette compiled into every utility.
 */

/** @param {string} v */
const token = (v) => `hsl(var(${v}) / <alpha-value>)`;

/** The one easing curve the product moves on: quick to start, long soft landing. */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: token('--gc-bg'),
        surface: {
          DEFAULT: token('--gc-surface'),
          raised: token('--gc-surface-raised'),
        },
        border: token('--gc-border'),
        ring: token('--gc-ring'),
        scrim: token('--gc-scrim'),
        text: {
          DEFAULT: token('--gc-text'),
          muted: token('--gc-text-muted'),
          inverse: token('--gc-text-inverse'),
        },
        primary: {
          DEFAULT: token('--gc-primary'),
          fg: token('--gc-primary-fg'),
        },
        accent: {
          DEFAULT: token('--gc-accent'),
          fg: token('--gc-accent-fg'),
          soft: token('--gc-accent-soft'),
        },
        sidebar: {
          DEFAULT: token('--gc-sidebar'),
          fg: token('--gc-sidebar-fg'),
          muted: token('--gc-sidebar-muted'),
          border: token('--gc-sidebar-border'),
          hover: token('--gc-sidebar-hover'),
        },
        success: { DEFAULT: token('--gc-success'), fg: token('--gc-success-fg') },
        danger: { DEFAULT: token('--gc-danger'), fg: token('--gc-danger-fg') },
        warning: { DEFAULT: token('--gc-warning'), fg: token('--gc-warning-fg') },
        info: { DEFAULT: token('--gc-info'), fg: token('--gc-info-fg') },
        pending: { DEFAULT: token('--gc-pending'), fg: token('--gc-pending-fg') },
      },
      fontFamily: {
        // Oakshade's face: a neo-grotesque sans for everything, headings a weight heavier.
        //
        // The sans is Inter, self-hosted (no font CDN: the CSP is `default-src 'self'`). Until
        // `@fontsource-variable/inter` is installed, Manrope — already a dependency, same
        // proportions and x-height — stands in, so the stack degrades to it rather than to the OS.
        sans: [
          '"Inter Variable"',
          '"Manrope Variable"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        display: ['"Inter Variable"', '"Manrope Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: 'var(--gc-radius-sm)',
        md: 'var(--gc-radius-md)',
        lg: 'var(--gc-radius-lg)',
      },
      boxShadow: {
        soft: 'var(--gc-shadow-soft)',
        raised: 'var(--gc-shadow-raised)',
        overlay: 'var(--gc-shadow-overlay)',
      },
      fontSize: {
        // Type scale 12/14/16/20/24/32/48 (§10.1). Larger steps tighten slightly.
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.3rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        xl: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        '2xl': ['2rem', { lineHeight: '2.4rem', letterSpacing: '-0.025em' }],
        '3xl': ['3rem', { lineHeight: '3.1rem', letterSpacing: '-0.03em' }],
      },
      transitionTimingFunction: {
        'out-expo': EASE_OUT,
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        enter: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        'drawer-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'drawer-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'count-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 currentColor' },
          '70%': { boxShadow: '0 0 0 6px transparent' },
          '100%': { boxShadow: '0 0 0 0 transparent' },
        },
      },
      animation: {
        'fade-in': `fade-in 200ms ${EASE_OUT}`,
        'fade-out': `fade-out 150ms ease-in`,
        enter: `enter 260ms ${EASE_OUT} both`,
        'scale-in': `scale-in 260ms ${EASE_OUT}`,
        'pop-in': `pop-in 180ms ${EASE_OUT}`,
        'slide-in-right': `slide-in-right 360ms ${EASE_OUT}`,
        'drawer-in': `drawer-in 380ms ${EASE_OUT}`,
        'drawer-left': `drawer-left 320ms ${EASE_OUT}`,
        'count-pop': 'count-pop 420ms ease-out',
        shimmer: 'shimmer 1.8s linear infinite',
        drift: 'drift 18s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
      },
    },
  },
};
