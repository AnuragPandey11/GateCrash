package com.gatecrash.support;

import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.JwtService;
import com.gatecrash.user.AppUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Mints real access tokens for test users.
 *
 * <p>Tests authenticate with a genuine signed token rather than {@code @WithMockUser}, so
 * {@code JwtAuthFilter}, the token-version revocation check and the forced-reset gate all execute
 * exactly as they would in production. A mocked principal would skip all three.
 */
@Component
@RequiredArgsConstructor
public class TestAuth {

    private final JwtService jwtService;

    public String bearer(AppUser user) {
        return "Bearer " + jwtService.generateAccessToken(AppUserDetails.from(user));
    }
}
