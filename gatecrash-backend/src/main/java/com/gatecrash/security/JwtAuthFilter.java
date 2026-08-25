package com.gatecrash.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.common.ApiError;
import com.gatecrash.common.CorrelationIdFilter;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Authenticates the bearer token on every request.
 *
 * <p>Signature validity alone is not enough to trust a token. After the cryptographic check the
 * filter reloads the account and rejects the request if the account has been deactivated, or if the
 * token's {@code tokenVersion} is behind the account's current one -- which is how a password change,
 * a forced logout or a deactivation takes effect immediately instead of after the 30-minute TTL.
 *
 * <p>That costs one primary-key read per request. It is a deliberate trade: for a system that
 * controls physical access to a township, "revoked means revoked now" is worth more than saving an
 * indexed lookup. If this ever becomes hot, cache it with a TTL shorter than the token TTL.
 */
// Deliberately not a @Component: Boot would auto-register it as a plain servlet filter running
// ahead of (and in addition to) the Spring Security chain. SecurityConfig instantiates it instead.
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final AppUserDetailsService userDetailsService;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            // Anonymous: the authorization rules decide whether that is acceptable for this path.
            chain.doFilter(request, response);
            return;
        }

        String token = header.substring(BEARER_PREFIX.length()).trim();
        try {
            JwtService.AccessToken claims = jwtService.parseAccessToken(token);
            // Resolved by subject, not by login id: the subject is the immutable identity.
            AppUserDetails user = userDetailsService.loadById(claims.userId());

            if (!user.isEnabled()) {
                reject(response, request, "ACCOUNT_DISABLED", "This account is inactive.");
                return;
            }
            if (user.getTokenVersion() != claims.tokenVersion()) {
                reject(response, request, "TOKEN_REVOKED", "Session has been invalidated. Sign in again.");
                return;
            }
            // Suspending or archiving a township takes effect on the very next request, not when the
            // access token happens to expire. The lifecycle change also bumps every member's token
            // version, so this is the structural backstop behind that, not the only control.
            if (!user.isTownshipUsable()) {
                reject(response, request, "TOWNSHIP_INACTIVE",
                        "This township is not currently active. Contact your administrator.");
                return;
            }

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities());
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            MDC.put(CorrelationIdFilter.MDC_USER, user.getId().toString());

            chain.doFilter(request, response);
        } catch (ExpiredJwtException ex) {
            reject(response, request, "TOKEN_EXPIRED", "Access token has expired.");
        } catch (UsernameNotFoundException ex) {
            // Signed token for an account that has since been deleted.
            reject(response, request, "INVALID_TOKEN", "Access token is invalid.");
        } catch (JwtException | IllegalArgumentException ex) {
            log.debug("Rejected bearer token on {}: {}", request.getRequestURI(), ex.getMessage());
            reject(response, request, "INVALID_TOKEN", "Access token is invalid.");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private void reject(HttpServletResponse response, HttpServletRequest request, String code, String message)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE,
                "Bearer error=\"invalid_token\", error_description=\"" + code + "\"");
        ApiError body = ApiError.of(HttpStatus.UNAUTHORIZED.value(), HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                code, message, request.getRequestURI(), CorrelationIdFilter.current());
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
