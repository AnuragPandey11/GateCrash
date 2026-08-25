package com.gatecrash.common.tenant;

import com.gatecrash.common.exception.BusinessValidationException;

import java.util.UUID;
import java.util.function.Supplier;

/**
 * The township the current request is acting inside.
 *
 * <p>Every tenant-scoped query in the system narrows by this value, so where it comes from is the
 * whole of the isolation guarantee. It is never read from a request body or a path variable: for an
 * ordinary account it is copied from the authenticated principal, and for a {@code SUPER_ADMIN} it
 * comes from the {@code X-Township-Id} header, which {@link TenantContextFilter} validates against
 * the township table before anything downstream sees it. A tenant id a caller can assert freely is
 * not a tenant boundary.
 *
 * <p>Held in a {@link ThreadLocal} rather than passed as an argument for the same reason
 * {@code SecurityUtils} is: threading it through every signature guarantees that the one call site
 * somebody forgets is a silent cross-tenant read, whereas a missing context here is a loud 400.
 * {@link TenantContextFilter} clears it in a {@code finally} block so a pooled request thread can
 * never inherit the previous request's tenant.
 */
public final class TenantContext {

    private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    static void set(UUID townshipId) {
        CURRENT.set(townshipId);
    }

    static void clear() {
        CURRENT.remove();
    }

    /**
     * Runs {@code work} with an explicit tenant, restoring whatever was in place afterwards. For
     * background jobs and after-commit dispatch, which run on threads no request filter ever touched.
     */
    public static void runAs(UUID townshipId, Runnable work) {
        UUID previous = CURRENT.get();
        CURRENT.set(townshipId);
        try {
            work.run();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }

    /** {@link #runAs} for work that produces a value -- provisioning a township's first admin. */
    public static <T> T callAs(UUID townshipId, Supplier<T> work) {
        UUID previous = CURRENT.get();
        CURRENT.set(townshipId);
        try {
            return work.get();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }

    public static UUID currentOrNull() {
        return CURRENT.get();
    }

    /**
     * The tenant this request is scoped to.
     *
     * @throws BusinessValidationException if there is none -- which in practice means a super admin
     *     called a township-scoped endpoint without naming the township to act in. That is a client
     *     error worth stating plainly, not something to guess a default for: picking a township on
     *     the caller's behalf is how an announcement lands in the wrong one.
     */
    public static UUID requireTownshipId() {
        UUID townshipId = CURRENT.get();
        if (townshipId == null) {
            throw new BusinessValidationException("TOWNSHIP_CONTEXT_REQUIRED",
                    "This endpoint acts inside a township. Send the township's id in the "
                            + TenantContextFilter.TOWNSHIP_HEADER + " header.");
        }
        return townshipId;
    }

    /** Ownership assertion for a row already loaded by id. */
    public static void requireSameTownship(UUID rowTownshipId, String what) {
        if (rowTownshipId == null || !rowTownshipId.equals(requireTownshipId())) {
            throw new com.gatecrash.common.exception.NotFoundException(
                    what + " was not found in this township.");
        }
    }
}
