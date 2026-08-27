package com.gatecrash.township;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.township.dto.TownshipDtos.CreateGateRequest;
import com.gatecrash.township.dto.TownshipDtos.GateResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Township gates -- always those of {@link TenantContext}'s township.
 *
 * <p>Blocks and flats used to live here too. They became the property tree in V4, because a fixed
 * block-then-flat pair could only describe one shape of real-estate project; see
 * {@link com.gatecrash.property.PropertyService}. Gates stayed: a gate is a gate whether the
 * project sells villas or offices.
 *
 * <p>Every read and every write in here is anchored on the current tenant, and the point lookups
 * ({@link #requireGate}) resolve by {@code (id, townshipId)} rather than by id
 * alone. That is not belt-and-braces: a gate id is a UUID in a request body, and finding the row it
 * names is a different question from being entitled to it. Resolving the pair means a caller from
 * another township gets a 404 -- the same answer they would get for an id that does not exist, which
 * is the answer that tells them nothing.
 *
 * <p>Deletion is only ever allowed while nothing references the row. Gates are pointed at by every
 * historical visitor log, so a cascading delete would tear holes in the access-control record.
 * Structures that are genuinely retired stay in place.
 */
@Service
@RequiredArgsConstructor
public class TownshipService {

    private final TownshipRepository townships;
    private final GateRepository gates;
    private final AuditService audit;

    // ----- gates ------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public GateResponse createGate(CreateGateRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        String name = request.name().trim();
        if (gates.existsByTownship_IdAndNameIgnoreCase(townshipId, name)) {
            throw new ConflictException("GATE_EXISTS", "A gate with that name already exists.");
        }
        Gate gate = new Gate();
        gate.setTownship(currentTownship());
        gate.setName(name);
        gates.save(gate);
        audit.record(AuditAction.GATE_CREATED, "gate", gate.getId(), AuditService.detail("name", name));
        return toResponse(gate);
    }

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<GateResponse> listGates() {
        return gates.findByTownship_IdOrderByNameAsc(TenantContext.requireTownshipId()).stream()
                .map(this::toResponse)
                .toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteGate(UUID gateId) {
        Gate gate = requireGate(gateId);
        gates.delete(gate);
        audit.record(AuditAction.GATE_DELETED, "gate", gateId, null);
    }

    // ----- internal lookups used by other services --------------------------------------------

    /**
     * A managed reference to the current tenant, for stamping onto a row being created. A reference
     * rather than a fetch: the row only needs the foreign key, and the township itself was already
     * validated by {@code TenantContextFilter} before the request reached any service.
     */
    @Transactional(readOnly = true)
    public Township currentTownship() {
        return townships.getReferenceById(TenantContext.requireTownshipId());
    }

    @Transactional(readOnly = true)
    public Gate requireGate(UUID gateId) {
        return gates.findByIdAndTownship_Id(gateId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Gate", gateId));
    }


    private GateResponse toResponse(Gate gate) {
        return new GateResponse(gate.getId(), gate.getName(), gate.getCreatedAt());
    }
}
