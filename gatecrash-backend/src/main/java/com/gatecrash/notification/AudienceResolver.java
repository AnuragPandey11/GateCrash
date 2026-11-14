package com.gatecrash.notification;

import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.tenant.TenantContext;
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
 *
 * <p>Every mode is additionally anchored on the current township, including {@code ALL}. That is the
 * difference between "everyone here" and "everyone on the platform", and it is not a difference any
 * amount of care at the call site should be relied on to preserve -- so it lives in the queries
 * themselves. A {@code FLATS} or {@code BLOCKS} rule naming another township's ids resolves to no
 * users at all, and is then rejected as an empty audience rather than delivering anywhere.
 *
 * <p>{@code NODES} is the general form: any mix of nodes at any level, each meaning "everyone
 * beneath it". It is what the console's building, floor and unit drill-down sends, so "Tower A,
 * floor 3 of Tower B, and flats C-101 and C-104" is one rule and one query rather than three.
 *
 * <p>{@code BLOCKS} outgrew its name in V4 and now means "everyone anywhere beneath these nodes",
 * at any depth: name a tower and it reaches every flat in it, name a phase and it reaches the whole
 * phase. The wire name is kept because clients send it; the resolver no longer assumes the thing
 * named is one hop above a unit, because in a villa community or a phased township it is not.
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

        UUID townshipId = TenantContext.requireTownshipId();
        return switch (rule.mode()) {
            case ALL -> users.findActiveUserIds(townshipId);
            case ALL_EXCEPT -> users.findActiveUserIdsExcludingRoles(townshipId, requireRoles(rule));
            case ROLES -> users.findActiveUserIdsByRoles(townshipId, requireRoles(rule));
            case FLATS -> users.findActiveUserIdsByUnitIds(townshipId,
                    requireIds(rule.flatIds(), "flatIds"));
            case BLOCKS -> users.findActiveUserIdsUnderNodes(townshipId,
                    requireIds(rule.blockIds(), "blockIds"));
            // Same subtree query as BLOCKS: a unit's own path is a prefix of itself, so naming a unit
            // reaches that unit, naming a floor reaches every unit on it, and so on up the tree.
            case NODES -> users.findActiveUserIdsUnderNodes(townshipId,
                    requireIds(rule.nodeIds(), "nodeIds"));
            case SALES_TEAM -> users.findActiveSalesUserIds(townshipId);
            case USERS -> users.findActiveUserIdsAmong(townshipId, requireIds(rule.userIds(), "userIds"));
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
