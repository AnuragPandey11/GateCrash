package com.gatecrash.notification;

import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.notification.dto.NotificationDtos.AudienceRule;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Compiles an {@link AudienceRule} into the exact set of user ids it targets.
 *
 * <p>Every mode is its own parameterised repository query. Nothing is assembled from strings, so a
 * crafted rule cannot influence the shape of the SQL -- the only thing the client controls is the
 * <em>values</em> bound to it, and those are typed as enums and UUIDs before they get here.
 *
 * <p>Empty selector lists are rejected rather than silently treated as "match nothing" or, far worse,
 * "match everything": {@code ROLES} with no roles collapsing into an unfiltered query would broadcast
 * to the entire township. Preview and send call the same method, so what the admin is shown is
 * exactly what is about to be sent.
 */
@Component
@RequiredArgsConstructor
public class AudienceResolver {

    private final AppUserRepository users;

    @Transactional(readOnly = true)
    public List<UUID> resolve(AudienceRule rule) {
        if (rule == null || rule.mode() == null) {
            throw new BusinessValidationException("AUDIENCE_REQUIRED", "An audience rule is required.");
        }

        return switch (rule.mode()) {
            case ALL -> users.findActiveUserIds();
            case ALL_EXCEPT -> users.findActiveUserIdsExcludingRoles(requireRoles(rule));
            case ROLES -> users.findActiveUserIdsByRoles(requireRoles(rule));
            case FLATS -> users.findActiveUserIdsByFlatIds(requireIds(rule.flatIds(), "flatIds"));
            case BLOCKS -> users.findActiveUserIdsByBlockIds(requireIds(rule.blockIds(), "blockIds"));
        };
    }

    private List<UserRole> requireRoles(AudienceRule rule) {
        List<UserRole> roles = rule.roles();
        if (roles == null || roles.isEmpty()) {
            throw new BusinessValidationException("ROLES_REQUIRED",
                    "roles must be provided for mode " + rule.mode() + ".");
        }
        return roles.stream().distinct().toList();
    }

    private List<UUID> requireIds(List<UUID> ids, String fieldName) {
        if (ids == null || ids.isEmpty()) {
            throw new BusinessValidationException("IDS_REQUIRED", fieldName + " must not be empty.");
        }
        return ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
    }
}
