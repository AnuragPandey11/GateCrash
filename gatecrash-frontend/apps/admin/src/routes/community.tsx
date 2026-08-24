import {
  PAGE_DEFAULTS,
  createPostRequestSchema,
  useCommunityFeed,
  useCreatePost,
  useDeletePost,
  type CreatePostRequest,
  type PageArgs,
  type PostResponse,
} from '@gatecrash/api';
import { formatDateTime } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MessageSquare, Pin, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CharCount, Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { applyFieldErrors, errorMessage, toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

const TITLE_MAX = 200;
const BODY_MAX = 10_000;

/**
 * Community — FRONTEND.md §8.6.
 *
 * Plain textarea, **not** a rich-text editor: the mobile feed renders plain text, so anything
 * fancier here would produce markup residents see as literal characters.
 *
 * `imageUrl` is a paste-a-URL field with an https check and a live preview, clearly labelled as
 * such. There is no upload endpoint (§15.1) and building an uploader against one that does not
 * exist would ship a button that cannot work.
 */
export function CommunityRoute() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageArgs>({ page: 1, size: PAGE_DEFAULTS.community });
  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState<PostResponse | null>(null);

  const { data, isPending, isError, error, refetch } = useCommunityFeed(page);
  const remove = useDeletePost();

  // Pinned first in the UI. The server sorts by `publishedAt`, so the ordering the mobile feed
  // shows is reproduced here rather than assumed.
  const posts = [...(data?.content ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('community.deleted'));
      setDeleting(null);
    } catch (err) {
      setDeleting(null);
      toastError(err, t);
    }
  };

  return (
    <>
      <PageHeader
        title={t('community.title')}
        description={t('community.subtitle')}
        actions={
          <Button onClick={() => setComposing(true)}>
            <Plus aria-hidden />
            {t('community.compose')}
          </Button>
        }
      />

      {isPending ? <LoadingState /> : null}
      {isError && !data ? (
        <ErrorState message={errorMessage(error, t)} onRetry={() => void refetch()} />
      ) : null}

      {data && posts.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquare}
            title={t('community.empty')}
            action={<Button onClick={() => setComposing(true)}>{t('community.compose')}</Button>}
          />
        </Card>
      ) : null}

      <div className="space-y-3">
        {posts.map((post) => (
          <Card key={post.id}>
            <CardContent className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium text-text">{post.title}</h2>
                    {post.pinned ? (
                      <Badge tone="primary" icon={<Pin className="size-3" aria-hidden />}>
                        {t('community.pinnedBadge')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-text-muted">
                    {t('community.by', { author: post.authorName })}
                    <span className="px-1">·</span>
                    {formatDateTime(post.publishedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.delete')}
                  onClick={() => setDeleting(post)}
                >
                  <Trash2 className="text-danger" />
                </Button>
              </div>

              {/* `whitespace-pre-wrap` so the line breaks an admin typed survive, matching how
                  the mobile feed renders the same text. */}
              <p className="whitespace-pre-wrap text-sm text-text">{post.body}</p>

              {post.imageUrl ? (
                <img
                  src={post.imageUrl}
                  alt=""
                  className="max-h-72 rounded-md border border-border object-cover"
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {data ? (
        <Pagination
          page={data}
          onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))}
          className="pt-2"
        />
      ) : null}

      <ComposeDialog open={composing} onOpenChange={setComposing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t('community.deleteTitle', { title: deleting.title }) : ''}
        description={t('community.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function ComposeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const create = useCreatePost();
  const [imageBroken, setImageBroken] = useState(false);

  const form = useForm<CreatePostRequest>({
    resolver: zodResolver(createPostRequestSchema),
    defaultValues: { title: '', body: '', imageUrl: '', pinned: false },
  });

  const title = form.watch('title') ?? '';
  const body = form.watch('body') ?? '';
  const imageUrl = form.watch('imageUrl') ?? '';
  const pinned = form.watch('pinned');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        title: values.title.trim(),
        body: values.body.trim(),
        // An empty string would fail the server's `SafeUrl` check; absent is what "no image" means.
        imageUrl: values.imageUrl?.trim() || undefined,
        pinned: values.pinned,
      });
      toast.success(t('community.published'));
      form.reset();
      onOpenChange(false);
    } catch (error) {
      const applied = applyFieldErrors(
        error,
        (name, err) => form.setError(name as keyof CreatePostRequest, err),
        ['title', 'body', 'imageUrl'],
      );
      if (!applied) toastError(error, t);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('community.compose')}</DialogTitle>
          <DialogDescription>{t('community.bodyHint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field
            label={t('community.postTitle')}
            error={form.formState.errors.title?.message}
            hint={<CharCount value={title} max={TITLE_MAX} />}
            required
          >
            {(props) => <Input {...props} {...form.register('title')} maxLength={TITLE_MAX} />}
          </Field>

          <Field
            label={t('community.postBody')}
            error={form.formState.errors.body?.message}
            hint={<CharCount value={body} max={BODY_MAX} />}
            required
          >
            {(props) => (
              <Textarea {...props} {...form.register('body')} rows={8} maxLength={BODY_MAX} />
            )}
          </Field>

          <Field
            label={t('community.imageUrl')}
            hint={t('community.imageUrlHint')}
            error={form.formState.errors.imageUrl?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('imageUrl', {
                  onChange: () => setImageBroken(false),
                })}
                type="url"
                placeholder="https://…"
              />
            )}
          </Field>

          {imageUrl && !form.formState.errors.imageUrl ? (
            imageBroken ? (
              <p className="text-sm text-warning">{t('community.imagePreviewFailed')}</p>
            ) : (
              <img
                src={imageUrl}
                alt=""
                onError={() => setImageBroken(true)}
                className="max-h-48 rounded-md border border-border object-cover"
              />
            )
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => form.setValue('pinned', e.target.checked)}
              className="size-4 rounded border-border"
            />
            {t('community.pinned')}
          </label>

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {create.isPending ? t('community.publishing') : t('community.publish')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
