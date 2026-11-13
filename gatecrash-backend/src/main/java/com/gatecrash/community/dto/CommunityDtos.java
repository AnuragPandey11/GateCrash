package com.gatecrash.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class CommunityDtos {

    private CommunityDtos() {
    }

    public record CreatePostRequest(
            @NotBlank @Size(max = 200) String title,
            /**
             * Rich-text HTML from the editor, sanitised server-side before storage. The bound is
             * generous because a picked image arrives inline as a data URI until there is an
             * upload endpoint.
             */
            @NotBlank @Size(max = 3_000_000) String body,
            /** Validated as an https URL before it is stored -- see SafeUrl. */
            @Size(max = 2048) String imageUrl,
            boolean pinned) {
    }

    public record PostResponse(
            UUID id,
            String title,
            String body,
            String imageUrl,
            boolean pinned,
            String authorName,
            OffsetDateTime publishedAt) {
    }
}
