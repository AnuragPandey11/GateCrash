package com.gatecrash.security;

import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.user.UserRole;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.UUID;

/**
 * Accessors for the authenticated principal.
 *
 * <p>Services call these instead of accepting a user id as a method argument: an id taken from the
 * request body is attacker-controlled, an id taken from the {@code SecurityContext} is not. This is
 * the single rule that keeps horizontal privilege escalation off the table.
 */
public final class SecurityUtils {

    private SecurityUtils() {
    }

    public static AppUserDetails currentUser() {
        AppUserDetails user = currentUserOrNull();
        if (user == null) {
            throw new ForbiddenException("NOT_AUTHENTICATED", "No authenticated principal.");
        }
        return user;
    }

    public static AppUserDetails currentUserOrNull() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        Object principal = authentication.getPrincipal();
        return principal instanceof AppUserDetails details ? details : null;
    }

    public static UUID currentUserId() {
        return currentUser().getId();
    }

    public static UUID currentUserIdOrNull() {
        AppUserDetails user = currentUserOrNull();
        return user == null ? null : user.getId();
    }

    public static UserRole currentRole() {
        return currentUser().getRole();
    }

    public static boolean hasRole(UserRole role) {
        AppUserDetails user = currentUserOrNull();
        return user != null && user.getRole() == role;
    }

    /** Ownership assertion helper; the message never reveals whose the resource actually is. */
    public static void requireSelf(UUID ownerId, String what) {
        if (ownerId == null || !ownerId.equals(currentUserId())) {
            throw new ForbiddenException("You are not the owner of this " + what + ".");
        }
    }
}
