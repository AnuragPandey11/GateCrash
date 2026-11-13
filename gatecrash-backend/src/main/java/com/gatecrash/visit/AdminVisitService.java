package com.gatecrash.visit;

import com.gatecrash.common.PageResponse;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.visit.dto.VisitDtos.OccupancyResponse;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Admin reporting over the visitor log.
 *
 * <p>Filters are composed with Criteria so absent ones are omitted from the SQL entirely, rather than
 * appearing as {@code :param is null or ...} branches -- which Postgres cannot type-infer against the
 * native enum columns, and which defeat index selection even when it can.
 *
 * <p>The township predicate is not one of those optional filters. It is added first and
 * unconditionally, so there is no combination of query parameters -- including a {@code gateId} or
 * {@code flatId} borrowed from another tenant -- that widens this report beyond one township.
 */
@Service
@RequiredArgsConstructor
public class AdminVisitService {

    private final VisitorLogRepository visits;
    private final VisitMapper mapper;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public OccupancyResponse inside() {
        List<VisitResponse> current = visits.findByTownship_IdAndStatusOrderByCheckedInAtDesc(
                        TenantContext.requireTownshipId(), VisitStatus.CHECKED_IN)
                .stream()
                .map(mapper::toResponse)
                .toList();
        return new OccupancyResponse(current.size(), current);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<VisitResponse> search(VisitStatus status, VisitorType visitorType,
                                              Boolean meetSalesAgent, UUID gateId, UUID flatId,
                                              OffsetDateTime from, OffsetDateTime to,
                                              Pageable pageable) {
        UUID townshipId = TenantContext.requireTownshipId();
        Specification<VisitorLog> specification = (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(builder.equal(root.get("township").get("id"), townshipId));
            if (status != null) {
                predicates.add(builder.equal(root.get("status"), status));
            }
            if (visitorType != null) {
                predicates.add(builder.equal(root.get("visitorType"), visitorType));
            }
            if (meetSalesAgent != null) {
                predicates.add(builder.equal(root.get("meetSalesAgent"), meetSalesAgent));
            }
            if (gateId != null) {
                predicates.add(builder.equal(root.get("gate").get("id"), gateId));
            }
            if (flatId != null) {
                predicates.add(builder.equal(root.get("targetUnit").get("id"), flatId));
            }
            if (from != null) {
                predicates.add(builder.greaterThanOrEqualTo(root.get("createdAt"), from));
            }
            if (to != null) {
                predicates.add(builder.lessThanOrEqualTo(root.get("createdAt"), to));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
        return PageResponse.of(visits.findAll(specification, pageable), mapper::toResponse);
    }
}
