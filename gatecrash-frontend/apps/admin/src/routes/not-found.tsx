import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <h1 className="text-lg font-semibold text-text">{t('errors.notFound.title')}</h1>
      <p className="max-w-sm text-sm text-text-muted">{t('errors.notFound.body')}</p>
      <Button asChild variant="secondary">
        <Link to="/occupancy">{t('errors.notFound.home')}</Link>
      </Button>
    </div>
  );
}
