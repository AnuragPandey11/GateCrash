package com.gatecrash.community;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.OffsetDateTime;
import java.util.UUID;

/** A township announcement or construction milestone, authored by an admin. */
@Entity
@Table(name = "community_post")
@Getter
@Setter
@NoArgsConstructor
public class CommunityPost {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** The tenant whose feed this post appears in. See the note on {@code Notification}. */
    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body", nullable = false)
    private String body;

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "is_pinned", nullable = false)
    private boolean pinned = false;

    @Column(name = "published_at", nullable = false)
    private OffsetDateTime publishedAt = OffsetDateTime.now();

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
