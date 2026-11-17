import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/**
 * The GateCrash brand, as an Oakshade AI product.
 *
 * GateCrash's own mark is an arched gate whose bars end in circuit nodes — the same
 * trace-and-node line the Oakshade oak uses for its roots, so the two read as one family. The
 * Oakshade mark itself appears only as the endorsement ("An Oakshade AI company"), never in
 * place of GateCrash's own.
 */

/** The gate mark alone, drawn in `currentColor`. */
export function GateCrashMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M4.5 21V10.5a7.5 7.5 0 0 1 15 0V21" />
      <path d="M8.75 21v-8M12 21v-10.5M15.25 21v-8" />
      <path d="M2.5 21h19" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.75" cy="12.5" r="1.5" />
        <circle cx="12" cy="10" r="1.5" />
        <circle cx="15.25" cy="12.5" r="1.5" />
      </g>
    </svg>
  );
}

const TILE_SIZE = {
  sm: 'size-7 rounded-[9px] [&>svg]:size-[1.1rem]',
  md: 'size-9 rounded-[11px] [&>svg]:size-[1.35rem]',
  lg: 'size-11 rounded-[13px] [&>svg]:size-[1.6rem]',
} as const;

/**
 * The mark on its tile: ink with a white gate on paper, and — `inverse` — white with an ink gate
 * on the ink panel, the way Oakshade flips its own sections.
 */
export function BrandTile({
  size = 'md',
  inverse = false,
  className,
}: {
  size?: keyof typeof TILE_SIZE;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center',
        inverse ? 'bg-sidebar-fg text-sidebar' : 'bg-primary text-primary-fg',
        TILE_SIZE[size],
        className,
      )}
    >
      <GateCrashMark />
    </span>
  );
}

/**
 * The Oakshade oak. Ink artwork; `inverse` turns it white for the ink panel, and on paper it
 * follows the theme so it is never black-on-black.
 */
export function OakshadeMark({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand/oakshade-mark.png`}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('shrink-0 select-none object-contain', inverse ? 'invert' : 'dark:invert', className)}
    />
  );
}

/** "An Oakshade AI company", with the oak. */
export function OakshadeEndorsement({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <OakshadeMark inverse={inverse} className="size-4" />
      <span>{t('brand.endorsement')}</span>
    </span>
  );
}
