package com.gatecrash.community;

import com.gatecrash.common.PageResponse;
import com.gatecrash.community.dto.CommunityDtos.CreatePostRequest;
import com.gatecrash.community.dto.CommunityDtos.PostResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/community/posts")
@RequiredArgsConstructor
@Tag(name = "Community feed")
public class CommunityController {

    private final CommunityService community;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Publish a milestone or announcement")
    public PostResponse create(@Valid @RequestBody CreatePostRequest request) {
        return community.create(request);
    }

    @GetMapping
    @Operation(summary = "Paginated feed, pinned posts first")
    public PageResponse<PostResponse> feed(@PageableDefault(size = 20) Pageable pageable) {
        return community.feed(pageable);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove a post")
    public void delete(@PathVariable UUID id) {
        community.delete(id);
    }
}
