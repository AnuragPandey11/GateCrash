package com.gatecrash.community;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface CommunityPostRepository extends JpaRepository<CommunityPost, UUID> {

    /** Pinned announcements float to the top, then newest first. */
    Page<CommunityPost> findAllByOrderByPinnedDescPublishedAtDesc(Pageable pageable);
}
