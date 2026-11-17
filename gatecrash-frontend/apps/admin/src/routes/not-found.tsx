import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center animate-enter">
      <p className="serif-accent text-[6rem] leading-none text-text">404</p>
      <h1 className="font-display text-2xl text-text">{t('errors.notFound.title')}</h1>
      <p className="max-w-sm text-sm text-text-muted">{t('errors.notFound.body')}</p>
      <Button asChild variant="secondary">
        {/* `/` redirects to the signed-in role's own home. */}
        <Link to="/">{t('errors.notFound.home')}</Link>
      </Button>
    </div>
  );
}
