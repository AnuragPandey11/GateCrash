package com.gatecrash.security;

import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipStatus;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.UserRole;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The authenticated principal. Deliberately a value object holding only what authorization needs --
 * it must not hold a JPA entity, because it is cached in the {@code SecurityContext} for the life of
 * the request (and in the WebSocket session for the life of the connection), where a detached entity
 * would be a lazy-loading hazard and a stale-data trap.
 *
 * <p>{@code passwordHash} is present only so {@code DaoAuthenticationProvider}-style flows can verify
 * it; it is never serialised.
 *
 * <p>{@code townshipId} is the tenant the account belongs to, and is null exactly when the role is
 * {@code SUPER_ADMIN}. {@code TenantContextFilter} copies it into {@code TenantContext} for every
 * ordinary request, which is what makes tenant scoping something a service cannot forget to opt into.
 */
public class AppUserDetails implements UserDetails {

    private final UUID id;
    private final String loginId;
    private final transient String passwordHash;
    private final UserRole role;
    private final boolean active;
    private final boolean mustResetPassword;
    private final UUID flatId;
    private final int tokenVersion;
    private final UUID townshipId;
    private final TownshipStatus townshipStatus;

    public AppUserDetails(UUID id, String loginId, String passwordHash, UserRole role, boolean active,
                          boolean mustResetPassword, UUID flatId, int tokenVersion, UUID townshipId,
                          TownshipStatus townshipStatus) {
        this.id = id;
        this.loginId = loginId;
        this.passwordHash = passwordHash;
        this.role = role;
        this.active = active;
        this.mustResetPassword = mustResetPassword;
        this.flatId = flatId;
        this.tokenVersion = tokenVersion;
        this.townshipId = townshipId;
        this.townshipStatus = townshipStatus;
    }

    public static AppUserDetails from(AppUser user) {
        Township township = user.getTownship();
        return new AppUserDetails(user.getId(), user.getLoginId(), user.getPasswordHash(), user.getRole(),
                user.isActive(), user.isMustResetPassword(), user.getFlatId(), user.getTokenVersion(),
                township == null ? null : township.getId(),
                township == null ? null : township.getStatus());
    }

    /**
     * A super admin is granted {@code ROLE_ADMIN} alongside {@code ROLE_SUPER_ADMIN}.
     *
     * <p>This is what gives it full operational reach inside whichever township it names, without
     * every one of the several dozen {@code hasRole('ADMIN')} annotations in the codebase having to
     * be widened -- and, more importantly, without the next admin endpoint somebody adds silently
     * excluding the platform operator because they copied an annotation that only listed ADMIN.
     *
     * <p>It deliberately does <em>not</em> confer GUARD, RESIDENT or SALES. Those roles are the
     * physical parties to a visit -- the person at the gate, the household deciding to let someone
     * in -- and a platform operator standing in for them would make the audit trail a fiction.
     */
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        if (role == UserRole.SUPER_ADMIN) {
            return List.of(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN"),
                    new SimpleGrantedAuthority("ROLE_ADMIN"));
        }
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return loginId;
    }

    @Override
    public boolean isAccountNonExpired() {
        return active;
    }

    @Override
    public boolean isAccountNonLocked() {
        return active;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }

    public UUID getId() {
        return id;
    }

    public UserRole getRole() {
        return role;
    }

    public boolean isMustResetPassword() {
        return mustResetPassword;
    }

    public UUID getFlatId() {
        return flatId;
    }

    public int getTokenVersion() {
        return tokenVersion;
    }

    /** Null for {@code SUPER_ADMIN}, non-null for every other role. */
    public UUID getTownshipId() {
        return townshipId;
    }

    public TownshipStatus getTownshipStatus() {
        return townshipStatus;
    }

    /**
     * True when the account's township is in a state that permits it to be used at all. A super admin
     * has no township, so it is never blocked by one -- suspending a township must not lock out the
     * person who has to go in and unsuspend it.
     */
    public boolean isTownshipUsable() {
        return role == UserRole.SUPER_ADMIN
                || (townshipStatus != null && townshipStatus.allowsAccess());
    }

    @Override
    public String toString() {
        // Never let a principal print its hash into a log line.
        return "AppUserDetails[id=" + id + ", role=" + role + ", township=" + townshipId + "]";
    }
}
