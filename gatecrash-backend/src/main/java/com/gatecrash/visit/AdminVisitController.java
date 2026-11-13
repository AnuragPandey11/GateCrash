package com.gatecrash.visit;

import com.gatecrash.common.PageResponse;
import com.gatecrash.visit.dto.VisitDtos.OccupancyResponse;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@Tag(name = "Admin - Visits")
public class AdminVisitController {

    private final AdminVisitService adminVisits;

    @GetMapping("/inside")
    @Operation(summary = "Live occupancy: everyone currently checked in")
    public OccupancyResponse inside() {
        return adminVisits.inside();
    }

    @GetMapping("/visits")
    @Operation(summary = "Filterable visitor log")
    public PageResponse<VisitResponse> search(
            @RequestParam(required = false) VisitStatus status,
            @RequestParam(required = false) VisitorType visitorType,
            @RequestParam(required = false) Boolean meetSalesAgent,
            @RequestParam(required = false) UUID gateId,
            @RequestParam(required = false) UUID flatId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @PageableDefault(size = 50, sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        return adminVisits.search(status, visitorType, meetSalesAgent, gateId, flatId, from, to, pageable);
    }
}
