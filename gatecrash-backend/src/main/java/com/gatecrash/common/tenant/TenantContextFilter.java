package com.gatecrash.common.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.common.ApiError;
import com.gatecrash.common.CorrelationIdFilter;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.user.UserRole;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;

/**
 * Establishes {@link TenantContext} for the request, and is the only place a tenant id is ever
 * decided.
 *
 * <p>Two sources, and the difference between them is the point:
 *
 * <ul>
 *   <li><b>Ordinary accounts</b> get the township stamped on their own row. It is not negotiable and
 *       not overridable -- a resident sending {@code X-Township-Id} for a township they do not belong
 *       to is refused outright rather than quietly ignored, because a client that sends it either has
 *       a bug worth surfacing or is probing the boundary.</li>
 *   <li><b>{@code SUPER_ADMIN}</b> belongs to no township, so it names the one it wants to act inside
 *       on each request. The header is resolved against the township table here, once, so every
 *       service downstream can treat {@link TenantContext#requireTownshipId()} as a real, existing,
 *       non-archived tenant rather than re-validating a caller-supplied id.</li>
 * </ul>
 *
 * <p>The context is cleared in a {@code finally} block. Request threads are pooled, and a leaked
 * {@code ThreadLocal} would hand the next request the previous caller's tenant -- the exact failure
 * this whole mechanism exists to prevent.
 */
// Instantiated by SecurityConfig rather than component-scanned, for the reason on JwtAuthFilter:
// Boot would otherwise also register it as a plain servlet filter outside the security chain, where
// it would run before authentication and see no principal at all.
@RequiredArgsConstructor
public class TenantContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(TenantContextFilter.class);

    /** How a super admin names the township to act inside. */
    public static final String TOWNSHIP_HEADER = "X-Township-Id";

    /** Correlates every log line of a request with the tenant it touched. */
    public static final String MDC_TOWNSHIP = "townshipId";

    private final TownshipRepository townships;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        AppUserDetails caller = SecurityUtils.currentUserOrNull();
        if (caller == null) {
            // Anonymous (login, refresh, docs, the STOMP handshake): nothing to scope yet.
            chain.doFilter(request, response);
            return;
        }

        UUID townshipId;
        try {
            townshipId = caller.getRole() == UserRole.SUPER_ADMIN
                    ? resolveRequestedTownship(request)
                    : ownTownship(caller, request);
        } catch (TenantResolutionFailure failure) {
            reject(response, request, failure);
            return;
        }

        try {
            if (townshipId != null) {
                TenantContext.set(townshipId);
                MDC.put(MDC_TOWNSHIP, townshipId.toString());
            }
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
            MDC.remove(MDC_TOWNSHIP);
        }
    }

    /**
     * A super admin's chosen tenant. Absent is legal -- the platform endpoints under
     * {@code /api/v1/super} need no tenant, and {@link TenantContext#requireTownshipId()} produces a
     * precise error for the ones that do.
     */
    private UUID resolveRequestedTownship(HttpServletRequest request) {
        String raw = request.getHeader(TOWNSHIP_HEADER);
        if (raw == null || raw.isBlank()) {
            return null;
        }

        UUID requested;
        try {
            requested = UUID.fromString(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new TenantResolutionFailure(HttpStatus.BAD_REQUEST, "INVALID_TOWNSHIP_HEADER",
                    TOWNSHIP_HEADER + " must be a township id (UUID).");
        }

        Township township = townships.findById(requested)
                .orElseThrow(() -> new TenantResolutionFailure(HttpStatus.NOT_FOUND,
                        "TOWNSHIP_NOT_FOUND", "No township with that id."));

        // SUSPENDED stays reachable for a super admin on purpose: suspension is usually the state a
        // township is in *because* somebody needs to go in and fix something. ARCHIVED does not --
        // a retired township is a historical record, and writing into one would corrupt it.
        if (township.getStatus() == com.gatecrash.township.TownshipStatus.ARCHIVED) {
            throw new TenantResolutionFailure(HttpStatus.CONFLICT, "TOWNSHIP_ARCHIVED",
                    "That township is archived. Restore it before acting inside it.");
        }

        log.debug("Super admin acting inside township {}", requested);
        return requested;
    }

    /** An ordinary account's own township, with any attempt to override it refused. */
    private UUID ownTownship(AppUserDetails caller, HttpServletRequest request) {
        UUID own = caller.getTownshipId();
        String raw = request.getHeader(TOWNSHIP_HEADER);

        if (raw != null && !raw.isBlank()
                && !Optional.ofNullable(own).map(UUID::toString).orElse("").equalsIgnoreCase(raw.trim())) {
            log.warn("User {} sent {}={} but belongs to township {}",
                    caller.getId(), TOWNSHIP_HEADER, raw, own);
            throw new TenantResolutionFailure(HttpStatus.FORBIDDEN, "TOWNSHIP_MISMATCH",
                    "You may only act inside your own township.");
        }
        if (own == null) {
            // super_admin_is_tenantless makes this unreachable for a well-formed row.
            throw new TenantResolutionFailure(HttpStatus.FORBIDDEN, "NO_TOWNSHIP",
                    "This account is not attached to a township.");
        }
        return own;
    }

    private void reject(HttpServletResponse response, HttpServletRequest request,
                        TenantResolutionFailure failure) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(failure.status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        ApiError body = ApiError.of(failure.status.value(), failure.status.getReasonPhrase(),
                failure.code, failure.getMessage(), request.getRequestURI(),
                CorrelationIdFilter.current());
        objectMapper.writeValue(response.getOutputStream(), body);
    }

    /**
     * Filters run outside {@code GlobalExceptionHandler}, so the failure is carried locally and
     * rendered by {@link #reject} in the same shape every other API error uses.
     */
    private static final class TenantResolutionFailure extends RuntimeException {

        private final transient HttpStatus status;
        private final String code;

        private TenantResolutionFailure(HttpStatus status, String code, String message) {
            super(message, null, false, false);
            this.status = status;
            this.code = code;
        }
    }
}
