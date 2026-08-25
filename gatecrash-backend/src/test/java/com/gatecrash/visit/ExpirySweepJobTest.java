package com.gatecrash.visit;

import com.gatecrash.pass.PassStatus;
import com.gatecrash.pass.PreApproval;
import com.gatecrash.pass.PreApprovalRepository;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Flat;
import com.gatecrash.township.Gate;
import com.gatecrash.user.AppUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The sweeps are invoked directly here: {@code @EnableScheduling} is switched off under the test
 * profile so a cron tick cannot fire mid-assertion.
 */
@DisplayName("Scheduled sweeps: stale visits and lapsed passes")
class ExpirySweepJobTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private ExpirySweepJob job;

    @Autowired
    private VisitorLogRepository visits;

    @Autowired
    private PreApprovalRepository passes;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private Gate gate;
    private Flat flat;
    private AppUser guard;
    private AppUser resident;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        gate = data.gate("Main Gate");
        guard = data.guard();
        resident = data.resident(flat);
    }

    @Test
    @DisplayName("a pending visit older than the TTL is expired")
    void stalePendingVisitIsExpired() {
        UUID staleId = pendingVisit(OffsetDateTime.now().minusMinutes(30));
        UUID freshId = pendingVisit(OffsetDateTime.now());

        job.expirePendingVisits();

        assertThat(visits.findById(staleId)).get()
                .extracting(VisitorLog::getStatus).isEqualTo(VisitStatus.EXPIRED);
        assertThat(visits.findById(freshId)).get()
                .extracting(VisitorLog::getStatus).isEqualTo(VisitStatus.PENDING);
    }

    @Test
    @DisplayName("the sweep is idempotent: a second run changes nothing")
    void sweepIsIdempotent() {
        UUID staleId = pendingVisit(OffsetDateTime.now().minusMinutes(30));

        job.expirePendingVisits();
        OffsetDateTime firstDecidedAt = visits.findById(staleId).orElseThrow().getDecidedAt();

        job.expirePendingVisits();

        assertThat(visits.findById(staleId).orElseThrow().getDecidedAt()).isEqualTo(firstDecidedAt);
    }

    @Test
    @DisplayName("an already-approved visit is never swept")
    void approvedVisitIsNotSwept() {
        UUID visitId = pendingVisit(OffsetDateTime.now().minusMinutes(30));
        jdbcTemplate.update("UPDATE visitor_log SET status = 'APPROVED' WHERE id = ?", visitId);

        job.expirePendingVisits();

        assertThat(visits.findById(visitId)).get()
                .extracting(VisitorLog::getStatus).isEqualTo(VisitStatus.APPROVED);
    }

    @Test
    @DisplayName("an active pass past its window is expired")
    void lapsedPassIsExpired() {
        UUID lapsedId = pass(OffsetDateTime.now().minusHours(1));
        UUID liveId = pass(OffsetDateTime.now().plusHours(1));

        job.expirePasses();

        assertThat(passes.findById(lapsedId)).get()
                .extracting(PreApproval::getStatus).isEqualTo(PassStatus.EXPIRED);
        assertThat(passes.findById(liveId)).get()
                .extracting(PreApproval::getStatus).isEqualTo(PassStatus.ACTIVE);
    }

    /** Inserted through JDBC so {@code created_at} can be backdated past the @CreationTimestamp. */
    private UUID pendingVisit(OffsetDateTime createdAt) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO visitor_log (id, township_id, gate_id, logged_by, visitor_name,
                                         visitor_type, approver_id, approver_kind, target_flat_id,
                                         status, created_at, updated_at, version)
                VALUES (?, ?, ?, ?, ?, 'GUEST'::visitor_type, ?, 'RESIDENT'::approver_kind, ?,
                        'PENDING'::visit_status, ?, ?, 0)
                """,
                id, gate.getTownshipId(), gate.getId(), guard.getId(), "Stale Visitor",
                resident.getId(), flat.getId(),
                java.sql.Timestamp.from(createdAt.toInstant()),
                java.sql.Timestamp.from(createdAt.toInstant()));
        return id;
    }

    private UUID pass(OffsetDateTime validUntil) {
        PreApproval pass = new PreApproval();
        pass.setTownship(resident.getTownship());
        pass.setCreatedBy(resident);
        pass.setApproverKind(ApproverKind.RESIDENT);
        pass.setVisitorType(VisitorType.GUEST);
        pass.setPinHash("$2a$10$abcdefghijklmnopqrstuv");
        pass.setPinLookup("lookup-" + UUID.randomUUID());
        pass.setStatus(PassStatus.ACTIVE);
        pass.setValidFrom(validUntil.minusHours(4));
        pass.setValidUntil(validUntil);
        pass.setMaxUses(1);
        return passes.save(pass).getId();
    }
}
