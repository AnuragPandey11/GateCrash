package com.gatecrash.common.audit;

import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.security.SecurityUtils;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Writes the audit trail. Every state transition in the system funnels through here.
 *
 * <p>Two propagation modes on purpose:
 * <ul>
 *   <li>{@link #record} joins the caller's transaction, so an audited transition and its audit row
 *       commit or roll back together -- the trail can never claim something that did not happen.</li>
 *   <li>{@link #recordIsolated} runs in its own transaction, for security events (failed logins,
 *       refresh-token reuse) that must survive the rollback of the operation that failed.</li>
 * </ul>
 *
 * <p>Every row is stamped with the tenant it happened in, taken from {@link TenantContext} rather
 * than from a parameter. Passing it in would mean each of the forty-odd call sites is a chance to
 * pass the wrong one, or to forget; taking it from the context means the trail is scoped by the same
 * value the operation itself was scoped by, or it is not written at all.
 */
@Service
@RequiredArgsConstructor
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    /**
     * Defence in depth against a caller accidentally passing a secret into the detail map. The audit
     * table is broadly readable by operators, so anything that smells like a credential is dropped.
     */
    private static final String[] REDACTED_KEY_FRAGMENTS =
            {"password", "pin", "token", "secret", "hash", "credential", "authorization"};

    private final AuditLogRepository repository;

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String action, String entity, UUID entityId, Map<String, Object> detail) {
        persist(SecurityUtils.currentUserIdOrNull(), action, entity, entityId, detail,
                TenantContext.currentOrNull());
    }

    /**
     * For a super admin acting <em>on</em> a township rather than inside one -- creating it, or
     * archiving it -- where there is no tenant context to inherit but the row still belongs in that
     * township's history.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public void recordForTownship(UUID townshipId, String action, String entity, UUID entityId,
                                  Map<String, Object> detail) {
        persist(SecurityUtils.currentUserIdOrNull(), action, entity, entityId, detail, townshipId);
    }

    /** For flows where the actor is known but no {@code SecurityContext} is established yet (login). */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIsolated(UUID actorId, String action, String entity, UUID entityId,
                               Map<String, Object> detail) {
        persist(actorId, action, entity, entityId, detail, TenantContext.currentOrNull());
    }

    /**
     * Isolated variant with an explicit tenant, for the login path: a failed sign-in must be recorded
     * against the township whose code was typed, and no context exists before authentication.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIsolated(UUID actorId, UUID townshipId, String action, String entity,
                               UUID entityId, Map<String, Object> detail) {
        persist(actorId, action, entity, entityId, detail, townshipId);
    }

    /** Scheduled jobs and other unattended work: {@code actor_id} stays null. */
    @Transactional(propagation = Propagation.REQUIRED)
    public void recordSystem(String action, String entity, UUID entityId, Map<String, Object> detail) {
        persist(null, action, entity, entityId, detail, TenantContext.currentOrNull());
    }

    /** Scheduled sweeps that run per township and know which one they are working on. */
    @Transactional(propagation = Propagation.REQUIRED)
    public void recordSystem(UUID townshipId, String action, String entity, UUID entityId,
                             Map<String, Object> detail) {
        persist(null, action, entity, entityId, detail, townshipId);
    }

    private void persist(UUID actorId, String action, String entity, UUID entityId,
                         Map<String, Object> detail, UUID townshipId) {
        AuditLog row = new AuditLog();
        row.setActorId(actorId);
        row.setTownshipId(townshipId);
        row.setAction(action);
        row.setEntity(entity);
        row.setEntityId(entityId);
        row.setDetail(sanitize(detail));
        repository.save(row);
    }

    private Map<String, Object> sanitize(Map<String, Object> detail) {
        if (detail == null || detail.isEmpty()) {
            return null;
        }
        Map<String, Object> safe = new LinkedHashMap<>(detail.size());
        detail.forEach((key, value) -> {
            if (key == null) {
                return;
            }
            String lower = key.toLowerCase(Locale.ROOT);
            for (String fragment : REDACTED_KEY_FRAGMENTS) {
                if (lower.contains(fragment)) {
                    log.warn("Refusing to audit potentially sensitive key '{}'", key);
                    safe.put(key, "[REDACTED]");
                    return;
                }
            }
            safe.put(key, value);
        });
        return safe;
    }

    /** Small builder so call sites stay readable without importing Map.of overloads everywhere. */
    public static Map<String, Object> detail(Object... keyValuePairs) {
        if (keyValuePairs.length % 2 != 0) {
            throw new IllegalArgumentException("detail() requires an even number of arguments");
        }
        Map<String, Object> map = new HashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            Object value = keyValuePairs[i + 1];
            // UUIDs and enums have no JSON representation Jackson would round-trip usefully here.
            map.put(String.valueOf(keyValuePairs[i]),
                    (value instanceof UUID || value instanceof Enum<?>) ? String.valueOf(value) : value);
        }
        return map;
    }
}
