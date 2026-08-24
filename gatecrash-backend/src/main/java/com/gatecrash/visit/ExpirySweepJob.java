package com.gatecrash.visit;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.config.AppProperties;
import com.gatecrash.pass.PreApprovalRepository;
import com.gatecrash.user.RefreshTokenService;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The sweeps that keep stale state from accumulating.
 *
 * <p>The pending-visit sweep is the one that matters operationally: without it, a resident who never
 * answers leaves the guard's tablet spinning indefinitely and the visitor standing at the gate. The
 * job flips those visits to {@code EXPIRED} and pushes an event to the gate so the screen resolves.
 *
 * <p>All three are idempotent -- they only ever move rows that still match their predicate -- so a
 * duplicate run or a retry after a crash is harmless.
 */
@Component
@RequiredArgsConstructor
public class ExpirySweepJob {

    private static final Logger log = LoggerFactory.getLogger(ExpirySweepJob.class);

    private final VisitorLogRepository visits;
    private final PreApprovalRepository passes;
    private final RefreshTokenService refreshTokens;
    private final VisitNotifier notifier;
    private final AuditService audit;
    private final AfterCommitExecutor afterCommit;
    private final AppProperties properties;

    @Scheduled(cron = "0 * * * * *")
    @SchedulerLock(name = "expirePendingVisits", lockAtMostFor = "PT2M", lockAtLeastFor = "PT10S")
    @Transactional
    public void expirePendingVisits() {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime cutoff = now.minusMinutes(properties.visit().pendingTtlMinutes());

        // Ids and gate details are captured first: after the bulk update these rows no longer match
        // the predicate, and each gate still needs an event to unstick its screen.
        List<UUID> expiring = visits.findPendingIdsOlderThan(cutoff);
        if (expiring.isEmpty()) {
            return;
        }
        List<GateNotification> notifications = visits.findAllById(expiring).stream()
                .map(visit -> new GateNotification(visit.getId(), visit.getGate().getId(),
                        visit.getVisitorName()))
                .toList();

        int updated = visits.expirePendingOlderThan(cutoff, now);
        if (updated > 0) {
            audit.recordSystem(AuditAction.VISIT_EXPIRED, "visitor_log", null,
                    AuditService.detail("count", updated, "cutoff", cutoff.toString()));
        }
        log.info("Expired {} pending visit(s) older than {}", updated, cutoff);

        // Only announce what actually committed.
        afterCommit.execute(() -> notifications.forEach(notification -> notifier.visitExpired(
                notification.visitId(), notification.gateId(), notification.visitorName())));
    }

    @Scheduled(cron = "0 */5 * * * *")
    @SchedulerLock(name = "expirePasses", lockAtMostFor = "PT4M", lockAtLeastFor = "PT10S")
    @Transactional
    public void expirePasses() {
        int expired = passes.markExpired(OffsetDateTime.now());
        if (expired > 0) {
            log.info("Expired {} pass(es) past their validity window", expired);
            audit.recordSystem(AuditAction.PASS_EXPIRED, "pre_approval", null,
                    AuditService.detail("count", expired));
        }
    }

    /**
     * Housekeeping. Expired refresh tokens carry no security value once past their expiry -- they are
     * already unusable -- and the table would otherwise grow without bound. A grace period is kept so
     * reuse detection still has something to match against for recently expired chains.
     */
    @Scheduled(cron = "0 30 3 * * *")
    @SchedulerLock(name = "purgeExpiredRefreshTokens", lockAtMostFor = "PT10M")
    public void purgeExpiredRefreshTokens() {
        int purged = refreshTokens.purgeExpired(OffsetDateTime.now().minusDays(7));
        if (purged > 0) {
            log.info("Purged {} expired refresh token(s)", purged);
        }
    }

    /** What a gate needs to resolve one expired visit on screen. */
    public record GateNotification(UUID visitId, UUID gateId, String visitorName) {
    }
}
