package com.gatecrash.security;

import java.security.Principal;

/**
 * The identity attached to a STOMP session.
 *
 * <p>{@link #getName()} returns the user id, because that is the key Spring's user-destination
 * resolver uses to route {@code /user/queue/**}. The full principal rides along so subscription
 * authorization can check the role without another database round trip on every frame.
 */
public record StompPrincipal(AppUserDetails user) implements Principal {

    @Override
    public String getName() {
        return user.getId().toString();
    }
}
