package com.gatecrash.community;

import com.gatecrash.common.PageResponse;
import com.gatecrash.common.SafeUrl;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.community.dto.CommunityDtos.CreatePostRequest;
import com.gatecrash.community.dto.CommunityDtos.PostResponse;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The community feed.
 *
 * <p>Read access excludes guards: the feed is for people who live and sell in the township, and a
 * shared tablet at the gate is the last place resident-facing announcements should be visible.
 *
 * <p>Post bodies are stored verbatim, HTML and all. Escaping belongs at the point of rendering, not
 * of storage -- sanitising here would corrupt legitimate text and still leave a client that renders
 * raw HTML vulnerable. The image URL is the one field the server can meaningfully constrain, and it
 * is restricted to https.
 */
@Service
@RequiredArgsConstructor
public class CommunityService {

    private final CommunityPostRepository posts;
    private final AppUserRepository users;
    private final AuditService audit;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PostResponse create(CreatePostRequest request) {
        UUID authorId = SecurityUtils.currentUserId();

        CommunityPost post = new CommunityPost();
        post.setAuthorId(authorId);
        post.setTitle(request.title().trim());
        post.setBody(request.body().trim());
        post.setImageUrl(SafeUrl.validateHttps(request.imageUrl(), "imageUrl"));
        post.setPinned(request.pinned());
        post.setPublishedAt(OffsetDateTime.now());
        posts.save(post);

        audit.record(AuditAction.POST_CREATED, "community_post", post.getId(),
                AuditService.detail("title", post.getTitle()));

        String authorName = users.findById(authorId).map(AppUser::getFullName).orElse(null);
        return toResponse(post, authorName);
    }

    @PreAuthorize("hasAnyRole('ADMIN','RESIDENT','SALES')")
    @Transactional(readOnly = true)
    public PageResponse<PostResponse> feed(Pageable pageable) {
        Page<CommunityPost> page = posts.findAllByOrderByPinnedDescPublishedAtDesc(pageable);

        // Resolve author names for the page in one query rather than one per post.
        List<UUID> authorIds = page.getContent().stream().map(CommunityPost::getAuthorId).distinct().toList();
        Map<UUID, String> names = users.findAllById(authorIds).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getFullName, (a, b) -> a));

        return PageResponse.of(page, post -> toResponse(post, names.get(post.getAuthorId())));
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void delete(UUID postId) {
        CommunityPost post = posts.findById(postId)
                .orElseThrow(() -> NotFoundException.of("Post", postId));
        posts.delete(post);
        audit.record(AuditAction.POST_DELETED, "community_post", postId, null);
    }

    private PostResponse toResponse(CommunityPost post, String authorName) {
        return new PostResponse(post.getId(), post.getTitle(), post.getBody(), post.getImageUrl(),
                post.isPinned(), authorName, post.getPublishedAt());
    }
}
