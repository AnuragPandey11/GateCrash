package com.gatecrash.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.common.ApiError;
import com.gatecrash.common.CorrelationIdFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;

/**
 * Closes the gap between "logged in with the admin-issued password" and "chose their own password".
 *
 * <p>Accounts are provisioned with a generated password that is handed over out-of-band, so it has
 * necessarily been seen by at least one other person. Until the user replaces it, the session is
 * confined to the endpoints needed to do exactly that. Without this, {@code must_reset_password}
 * would be a client-side suggestion the mobile app could simply skip.
 */
// Instantiated by SecurityConfig, not component-scanned -- see the note on JwtAuthFilter.
@RequiredArgsConstructor
public class PasswordResetEnforcementFilter extends OncePerRequestFilter {

    /** The only endpoints reachable while a password reset is outstanding. */
    private static final Set<String> ALLOWED_PATHS = Set.of(
            "/api/v1/auth/password",
            "/api/v1/auth/logout",
            "/api/v1/auth/refresh",
            "/api/v1/auth/me");

    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        AppUserDetails user = SecurityUtils.currentUserOrNull();
        if (user == null || !user.isMustResetPassword() || ALLOWED_PATHS.contains(request.getRequestURI())) {
            chain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiError body = ApiError.of(HttpStatus.FORBIDDEN.value(), HttpStatus.FORBIDDEN.getReasonPhrase(),
                "PASSWORD_RESET_REQUIRED",
                "You must change your password before using the application.",
                request.getRequestURI(), CorrelationIdFilter.current());
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
