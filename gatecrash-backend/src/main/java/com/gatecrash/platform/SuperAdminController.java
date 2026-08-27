package com.gatecrash.platform;

import com.gatecrash.common.PageResponse;
import com.gatecrash.platform.dto.PlatformDtos.ArchiveTownshipRequest;
import com.gatecrash.platform.dto.PlatformDtos.CreateSuperAdminRequest;
import com.gatecrash.platform.dto.PlatformDtos.CreateTownshipRequest;
import com.gatecrash.platform.dto.PlatformDtos.CreatedTownshipResponse;
import com.gatecrash.platform.dto.PlatformDtos.SuperAdminResponse;
import com.gatecrash.platform.dto.PlatformDtos.TownshipAdminRequest;
import com.gatecrash.platform.dto.PlatformDtos.TownshipResponse;
import com.gatecrash.platform.dto.PlatformDtos.UpdateTownshipRequest;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import com.gatecrash.user.dto.UserDtos.ResetPasswordResponse;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import com.gatecrash.property.PropertyService;
import com.gatecrash.property.dto.PropertyDtos.PropertyTypeOption;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The platform surface. Everything under {@code /api/v1/super} is {@code SUPER_ADMIN} only -- once in
 * {@code SecurityConfig} as a URL rule so a newly added endpoint is closed by default, and again on
 * each service method, which is the check that actually decides.
 *
 * <p>These endpoints act <em>on</em> townships. To act <em>inside</em> one, a super admin calls the
 * ordinary {@code /api/v1/admin/**} endpoints with an {@code X-Township-Id} header naming the
 * township -- see {@code TenantContextFilter}.
 */
@RestController
@RequestMapping("/api/v1/super")
@RequiredArgsConstructor
@Tag(name = "Super Admin - Platform")
public class SuperAdminController {

    private final TownshipLifecycleService lifecycle;
    private final SuperAdminService superAdmins;
    private final PropertyService property;

    // ----- onboarding reference data ----------------------------------------------------------

    /**
     * The project types a township can be onboarded as, with the level set each one seeds.
     *
     * <p>Deliberately duplicated from {@code /admin/property/types} rather than shared: that one is
     * tenant-scoped and a super admin onboarding a *new* developer has no township to name yet, so
     * calling it would be a {@code 422 TOWNSHIP_CONTEXT_REQUIRED} on the first screen of the flow.
     * Static reference data either way.
     */
    @GetMapping("/property-types")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Operation(summary = "Project types available when onboarding a township")
    public List<PropertyTypeOption> propertyTypes() {
        return property.catalogue();
    }

    // ----- townships --------------------------------------------------------------------------

    @PostMapping("/townships")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Onboard a township and its first admin; "
            + "returns the admin's generated password exactly once")
    public CreatedTownshipResponse createTownship(@Valid @RequestBody CreateTownshipRequest request) {
        return lifecycle.create(request);
    }

    @GetMapping("/townships")
    @Operation(summary = "List townships (archived ones are hidden unless asked for)")
    public PageResponse<TownshipResponse> listTownships(
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @PageableDefault(size = 25, sort = "name", direction = Sort.Direction.ASC) Pageable pageable) {
        return lifecycle.list(includeArchived, pageable);
    }

    @GetMapping("/townships/{id}")
    @Operation(summary = "Fetch one township with its headline counts")
    public TownshipResponse getTownship(@PathVariable UUID id) {
        return lifecycle.get(id);
    }

    @PatchMapping("/townships/{id}")
    @Operation(summary = "Update a township's name and contact details (the code is immutable)")
    public TownshipResponse updateTownship(@PathVariable UUID id,
                                           @Valid @RequestBody UpdateTownshipRequest request) {
        return lifecycle.update(id, request);
    }

    @PostMapping("/townships/{id}/suspend")
    @Operation(summary = "Suspend a township: nobody in it can sign in, nothing is torn down")
    public TownshipResponse suspendTownship(@PathVariable UUID id) {
        return lifecycle.suspend(id);
    }

    @DeleteMapping("/townships/{id}")
    @Operation(summary = "Archive a township (soft delete). Requires the township's code as "
            + "confirmation; history is preserved and the action is reversible via /restore")
    public TownshipResponse archiveTownship(@PathVariable UUID id,
                                            @Valid @RequestBody ArchiveTownshipRequest request) {
        return lifecycle.archive(id, request);
    }

    @PostMapping("/townships/{id}/restore")
    @Operation(summary = "Return a suspended or archived township to service")
    public TownshipResponse restoreTownship(@PathVariable UUID id) {
        return lifecycle.restore(id);
    }

    // ----- township administrators ----------------------------------------------------------

    @GetMapping("/townships/{id}/admins")
    @Operation(summary = "List a township's administrators")
    public List<UserResponse> listTownshipAdmins(@PathVariable UUID id) {
        return superAdmins.listTownshipAdmins(id);
    }

    @PostMapping("/townships/{id}/admins")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Appoint an additional administrator for a township")
    public CreatedUserResponse addTownshipAdmin(@PathVariable UUID id,
                                                @Valid @RequestBody TownshipAdminRequest request) {
        return lifecycle.addAdmin(id, request);
    }

    @DeleteMapping("/townships/{id}/admins/{userId}")
    @Operation(summary = "Remove a township administrator (deactivates; the last one is refused)")
    public UserResponse removeTownshipAdmin(@PathVariable UUID id, @PathVariable UUID userId) {
        return superAdmins.removeTownshipAdmin(id, userId);
    }

    @PostMapping("/townships/{id}/admins/{userId}/reset-password")
    @Operation(summary = "Reissue a township administrator's password and end their sessions")
    public ResetPasswordResponse resetTownshipAdminPassword(@PathVariable UUID id,
                                                            @PathVariable UUID userId) {
        return superAdmins.resetTownshipAdminPassword(id, userId);
    }

    // ----- super admins -----------------------------------------------------------------------

    @GetMapping("/admins")
    @Operation(summary = "List platform super admins")
    public List<SuperAdminResponse> listSuperAdmins() {
        return superAdmins.listSuperAdmins();
    }

    @PostMapping("/admins")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Provision a peer super admin; returns the generated password exactly once")
    public CreatedUserResponse createSuperAdmin(@Valid @RequestBody CreateSuperAdminRequest request) {
        return superAdmins.createSuperAdmin(request);
    }

    @DeleteMapping("/admins/{userId}")
    @Operation(summary = "Deactivate a super admin (never yourself, never the last one)")
    public SuperAdminResponse deactivateSuperAdmin(@PathVariable UUID userId) {
        return superAdmins.setSuperAdminActive(userId, false);
    }

    @PostMapping("/admins/{userId}/activate")
    @Operation(summary = "Reactivate a deactivated super admin")
    public SuperAdminResponse activateSuperAdmin(@PathVariable UUID userId) {
        return superAdmins.setSuperAdminActive(userId, true);
    }

    @PostMapping("/admins/{userId}/reset-password")
    @Operation(summary = "Reissue a super admin's password and end their sessions")
    public ResetPasswordResponse resetSuperAdminPassword(@PathVariable UUID userId) {
        return superAdmins.resetSuperAdminPassword(userId);
    }
}
