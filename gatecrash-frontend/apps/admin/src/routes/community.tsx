import {
  PAGE_DEFAULTS,
  POST_BODY_MAX,
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
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RichTextEditor } from '@/features/community/rich-text-editor';
import { RichTextView } from '@/features/community/rich-text-view';
import { applyFieldErrors, errorMessage, toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

const TITLE_MAX = 200;

/**
 * Community — FRONTEND.md §8.6.
 *
 * Posts are rich text: a Quill editor with headings, emphasis, lists, alignment, links, inline
 * images and YouTube/Vimeo video. The server sanitises the HTML against an allowlist before
 * storing it, and the feed sanitises again before rendering (`RichTextView`). Any client that
 * shows the feed — the mobile app included, when it is built — must render it as HTML.
 *
 * Images picked in the editor travel inline as data URIs, because there is no upload endpoint
 * yet (§15.1). The optional cover image stays a paste-a-URL field for the same reason.
 */
/** `readOnly` is the resident's view: the same feed, no compose or delete. */
export function CommunityRoute({ readOnly = false }: { readOnly?: boolean }) {
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
        eyebrow={t('pageEyebrow.community')}
        title={t('community.title')}
        description={t('community.subtitle')}
        actions={
          readOnly ? null : (
            <Button onClick={() => setComposing(true)}>
              <Plus aria-hidden />
              {t('community.compose')}
            </Button>
          )
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
            action={
              readOnly ? undefined : <Button onClick={() => setComposing(true)}>{t('community.compose')}</Button>
            }
          />
        </Card>
      ) : null}

      <div className="stagger space-y-4">
        {posts.map((post) => (
          <Card key={post.id} className="lift">
            <CardContent className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl text-text">{post.title}</h2>
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
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.delete')}
                    onClick={() => setDeleting(post)}
                  >
                    <Trash2 className="text-danger" />
                  </Button>
                )}
              </div>

              {post.imageUrl ? (
                <img
                  src={post.imageUrl}
                  alt=""
                  className="max-h-72 w-full rounded-md border border-border object-cover"
                />
              ) : null}

              <RichTextView html={post.body} />
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
  const [bodyTextLength, setBodyTextLength] = useState(0);
  const imageUrl = form.watch('imageUrl') ?? '';
  const pinned = form.watch('pinned');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        title: values.title.trim(),
        body: values.body,
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

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-text">
              {t('community.postBody')}
              <span className="ml-0.5 text-danger">*</span>
            </p>
            <RichTextEditor
              ariaLabel={t('community.postBody')}
              placeholder={t('community.editor.placeholder')}
              invalid={Boolean(form.formState.errors.body)}
              onChange={({ html, textLength }) => {
                setBodyTextLength(textLength);
                form.setValue('body', html, {
                  shouldValidate: form.formState.isSubmitted,
                  shouldDirty: true,
                });
              }}
            />
            {form.formState.errors.body ? (
              <p role="alert" className="text-xs text-danger">
                {form.formState.errors.body.type === 'too_big'
                  ? t('community.editor.tooLarge', {
                      mb: Math.round(POST_BODY_MAX / 1_000_000),
                    })
                  : t('community.editor.required')}
              </p>
            ) : (
              <p className="text-xs text-text-muted">
                {t('community.editor.characters', { count: bodyTextLength })}
              </p>
            )}
          </div>

          <Field
            label={t('community.coverImage')}
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
