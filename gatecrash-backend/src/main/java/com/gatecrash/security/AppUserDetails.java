package com.gatecrash.security;

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

    public AppUserDetails(UUID id, String loginId, String passwordHash, UserRole role, boolean active,
                          boolean mustResetPassword, UUID flatId, int tokenVersion) {
        this.id = id;
        this.loginId = loginId;
        this.passwordHash = passwordHash;
        this.role = role;
        this.active = active;
        this.mustResetPassword = mustResetPassword;
        this.flatId = flatId;
        this.tokenVersion = tokenVersion;
    }

    public static AppUserDetails from(AppUser user) {
        return new AppUserDetails(user.getId(), user.getLoginId(), user.getPasswordHash(), user.getRole(),
                user.isActive(), user.isMustResetPassword(), user.getFlatId(), user.getTokenVersion());
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
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

    @Override
    public String toString() {
        // Never let a principal print its hash into a log line.
        return "AppUserDetails[id=" + id + ", role=" + role + "]";
    }
}
