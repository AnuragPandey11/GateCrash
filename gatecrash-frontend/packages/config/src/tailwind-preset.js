/**
 * Shared Tailwind preset — FRONTEND.md §10.1.
 *
 * Consumed by `apps/admin` (Tailwind) and, when mobile lands, by `apps/mobile` (NativeWind).
 * Colours resolve through the CSS variables in `tokens.css`, so dark mode is a class swap on
 * <html> rather than a second palette compiled into every utility.
 */

/** @param {string} v */
const token = (v) => `hsl(var(${v}) / <alpha-value>)`;

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
        text: {
          DEFAULT: token('--gc-text'),
          muted: token('--gc-text-muted'),
          inverse: token('--gc-text-inverse'),
        },
        primary: {
          DEFAULT: token('--gc-primary'),
          fg: token('--gc-primary-fg'),
        },
        success: { DEFAULT: token('--gc-success'), fg: token('--gc-success-fg') },
        danger: { DEFAULT: token('--gc-danger'), fg: token('--gc-danger-fg') },
        warning: { DEFAULT: token('--gc-warning'), fg: token('--gc-warning-fg') },
        info: { DEFAULT: token('--gc-info'), fg: token('--gc-info-fg') },
        pending: { DEFAULT: token('--gc-pending'), fg: token('--gc-pending-fg') },
      },
      borderRadius: {
        sm: 'var(--gc-radius-sm)',
        md: 'var(--gc-radius-md)',
        lg: 'var(--gc-radius-lg)',
      },
      fontSize: {
        // Type scale 12/14/16/20/24/32/48 (§10.1)
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
        '2xl': ['2rem', { lineHeight: '2.375rem' }],
        '3xl': ['3rem', { lineHeight: '3.25rem' }],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'count-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'count-pop': 'count-pop 420ms ease-out',
      },
    },
  },
};
