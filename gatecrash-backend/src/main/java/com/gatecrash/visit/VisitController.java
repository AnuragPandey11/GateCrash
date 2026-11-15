package com.gatecrash.visit;

import com.gatecrash.config.AppProperties;
import com.gatecrash.common.PageResponse;
import com.gatecrash.visit.dto.VisitDtos.CheckOutRequest;
import com.gatecrash.visit.dto.VisitDtos.CollectParcelRequest;
import com.gatecrash.visit.dto.VisitDtos.CollectionCodeResponse;
import com.gatecrash.visit.dto.VisitDtos.CreateVisitRequest;
import com.gatecrash.visit.dto.VisitDtos.ExtendStayRequest;
import com.gatecrash.visit.dto.VisitDtos.VisitDecisionRequest;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Thin by design: validate the payload shape, delegate, return the DTO. Every authorization decision
 * lives on the {@link VisitService} method so there is exactly one place to audit it.
 */
@RestController
@RequestMapping("/api/v1/visits")
@RequiredArgsConstructor
@Validated
@Tag(name = "Visits")
public class VisitController {

    private final VisitService visits;
    private final AppProperties properties;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Guard logs a walk-in; routes to the flat's residents or a sales agent")
    public VisitResponse create(@Valid @RequestBody CreateVisitRequest request) {
        return visits.createVisit(request);
    }

    @PatchMapping("/{id}/decision")
    @Operation(summary = "Approver accepts or rejects a pending visit")
    public VisitResponse decide(@PathVariable UUID id, @Valid @RequestBody VisitDecisionRequest request) {
        return visits.decide(id, request.decision(), request.expectedDurationMinutes());
    }

    @PatchMapping("/{id}/check-in")
    @Operation(summary = "Guard records physical entry")
    public VisitResponse checkIn(@PathVariable UUID id) {
        return visits.checkIn(id);
    }

    @PatchMapping("/{id}/check-out")
    @Operation(summary = "Guard records exit")
    public VisitResponse checkOut(@PathVariable UUID id,
                                  @RequestBody(required = false) CheckOutRequest request) {
        return visits.checkOut(id, request == null ? null : request.gateId());
    }

    @GetMapping("/mine")
    @Operation(summary = "The caller's visit history: their household's (resident) or their own (sales)")
    public PageResponse<VisitResponse> mine(
            @PageableDefault(size = 20) Pageable pageable) {
        return visits.historyForCurrentUser(pageable);
    }

    @PatchMapping("/{id}/stay")
    @Operation(summary = "Host extends an approved or checked-in visitor's stay; clears an overstay alert")
    public VisitResponse extendStay(@PathVariable UUID id, @Valid @RequestBody ExtendStayRequest request) {
        return visits.extendStay(id, request.extendMinutes());
    }

    @PostMapping("/{id}/collection-code")
    @Operation(summary = "Resident gets a fresh collection code for a parcel left at the gate")
    public CollectionCodeResponse collectionCode(@PathVariable UUID id) {
        return visits.reissueCollectionCode(id);
    }

    @PostMapping("/{id}/collect")
    @Operation(summary = "Guard hands over a parcel against the resident's collection code")
    public VisitResponse collect(@PathVariable UUID id, @Valid @RequestBody CollectParcelRequest request) {
        return visits.collectParcel(id, request.code());
    }

    @GetMapping("/pending")
    @Operation(summary = "The caller's open approval requests")
    public List<VisitResponse> myPending() {
        return visits.pendingForCurrentUser();
    }

    @GetMapping("/gate/{gateId}")
    @Operation(summary = "Recent activity at a gate")
    public List<VisitResponse> byGate(
            @PathVariable UUID gateId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
        return visits.recentForGate(gateId, Math.min(limit, properties.visit().gateFeedMaxSize()));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Fetch one visit; reconciliation path when the WebSocket drops")
    public VisitResponse one(@PathVariable UUID id) {
        return visits.get(id);
    }
}
