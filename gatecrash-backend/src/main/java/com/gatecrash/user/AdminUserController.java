package com.gatecrash.user;

import com.gatecrash.common.PageResponse;
import com.gatecrash.user.dto.UserDtos.CreateUserRequest;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import com.gatecrash.user.dto.UserDtos.ResetPasswordResponse;
import com.gatecrash.user.dto.UserDtos.UpdateUserRequest;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Admin account management. Authorization lives on the service methods, not here -- a controller
 * annotation is easy to forget when a second caller appears.
 */
@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
@Validated
@Tag(name = "Admin - Users")
public class AdminUserController {

    private final UserProvisioningService provisioning;
    private final UserService userService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Provision an account; returns the generated password exactly once")
    public CreatedUserResponse create(@Valid @RequestBody CreateUserRequest request) {
        return provisioning.createUser(request);
    }

    @PostMapping("/{id}/reset-password")
    @Operation(summary = "Issue a new generated password and end every session for the account")
    public ResetPasswordResponse resetPassword(@PathVariable UUID id) {
        return provisioning.resetPassword(id);
    }

    @GetMapping
    @Operation(summary = "List accounts")
    public PageResponse<UserResponse> list(
            @RequestParam(required = false) UserRole role,
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) UUID flatId,
            @RequestParam(required = false) @Size(max = 100) String search,
            @PageableDefault(size = 25, sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        return userService.list(role, active, flatId, search, pageable);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Fetch one account")
    public UserResponse get(@PathVariable UUID id) {
        return userService.get(id);
    }

    @PatchMapping("/{id}")
    @Operation(summary = "Update contact details")
    public UserResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateUserRequest request) {
        return userService.update(id, request);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Deactivate an account (soft delete; history is preserved)")
    public UserResponse deactivate(@PathVariable UUID id) {
        return userService.setActive(id, false);
    }

    @PostMapping("/{id}/activate")
    @Operation(summary = "Reactivate a deactivated account")
    public UserResponse activate(@PathVariable UUID id) {
        return userService.setActive(id, true);
    }
}
