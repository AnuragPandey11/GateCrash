package com.gatecrash.property;

import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.property.dto.PropertyDtos.OccupancySummaryResponse;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;

/**
 * Answers the three different questions that were all previously called "occupancy".
 *
 * <p>Until V4 the only thing in the system carrying the word was {@code GET /admin/inside}, which
 * counts {@code visitor_log} rows in {@code CHECKED_IN} -- visitors physically on the premises right
 * now. That is a live security number and a useful one, but it is not what a real-estate developer
 * means by occupancy, and nothing answered what they do mean: how much of the project is lived in.
 *
 * <p>Three numbers, kept deliberately distinct rather than collapsed into one headline:
 * <ul>
 *   <li><b>Unit occupancy</b> -- occupied units over total units. The developer's metric.</li>
 *   <li><b>Resident headcount</b> -- people living here, from each unit's declared occupancy, which
 *       includes the family members who have no app account. Counting {@code app_user} rows instead
 *       reports a four-person household as one, because typically only the owner has a login.</li>
 *   <li><b>Visitors inside</b> -- the existing live gate count, unchanged.</li>
 * </ul>
 *
 * <p>Registered accounts are reported alongside the headcount rather than instead of it, because the
 * gap between the two is itself the interesting figure: it is how many residents cannot yet be
 * notified of anything.
 */
@Service
@RequiredArgsConstructor
public class OccupancyService {

    private final PropertyNodeRepository nodes;
    private final AppUserRepository users;
    private final VisitorLogRepository visits;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public OccupancySummaryResponse summary() {
        UUID townshipId = TenantContext.requireTownshipId();

        long totalUnits = nodes.countByTownship_IdAndKind(townshipId, PropertyNodeKind.UNIT);
        long occupiedUnits = nodes.countOccupiedUnits(townshipId);

        return new OccupancySummaryResponse(
                totalUnits,
                occupiedUnits,
                totalUnits - occupiedUnits,
                rate(occupiedUnits, totalUnits),
                nodes.sumDeclaredOccupancy(townshipId, PropertyNodeKind.UNIT),
                users.countByTownship_IdAndRoleAndActiveTrue(townshipId, UserRole.RESIDENT),
                visits.countByTownship_IdAndStatus(townshipId, VisitStatus.CHECKED_IN));
    }

    /** A township with no units yet is 0% occupied, not a division by zero. */
    private double rate(long occupied, long total) {
        if (total <= 0) {
            return 0d;
        }
        return BigDecimal.valueOf(occupied)
                .divide(BigDecimal.valueOf(total), 4, RoundingMode.HALF_UP)
                .doubleValue();
    }
}
